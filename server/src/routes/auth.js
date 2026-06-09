import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

import db from "../config/database.js";
import env from "../config/env.js";
import { authenticate, authorize } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import rateLimit from "express-rate-limit";
import {
  loginSchema,
  registerSchema,
  changePasswordSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  adminResetPasswordSchema,
  sendOTPSchema,
  confirmOTPSchema,
} from "../validators/authSchema.js";
import { sendPasswordResetEmail, sendDealerWelcomeEmail, sendReuploadConfirmationEmail, sendQuotationReuploadConfirmationEmail, sendAdminPasswordResetEmail, sendEmailOTPEmail } from "../services/emailService.js";
import { broadcastToRole } from "../utils/sseManager.js";

const router = Router();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Strict rate limiter for re-upload verify endpoint.
// Prevents brute-force attacks against the dealer's registration password.
// 10 attempts per 15 minutes per IP — sufficient for legitimate use (one attempt),
// strict enough to make brute-force computationally infeasible.
const reuploadVerifyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,
  message: { success: false, error: "Too many verification attempts. Please try again after 15 minutes." },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true, // Only count failed attempts against the limit
});

// A bcrypt hash of a dummy password used for constant-time comparison
// when a user is not found. This prevents timing-based email enumeration.
// Pre-generated once at startup — never changes, never logged.
const DUMMY_HASH = await bcrypt.hash("dummy_constant_time_prevention_do_not_use", 10);

// ─── POST /api/auth/login ────────────────────────────────
// Public — Authenticate user and return JWT token
router.post("/login", validate(loginSchema), async (req, res, next) => {
  try {
    const { email, password, role } = req.body;
    const clientIp = req.ip || req.socket?.remoteAddress || "unknown";

    // ── Per-account lockout check ────────────────────────────────────────────
    // Count ONLY failures that occurred AFTER the last successful login.
    // This means one successful login resets the counter — a dealer who
    // mistyped 8 times but eventually got in will NOT be locked on their
    // next visit. Without this, failures accumulate across sessions.
    const lockoutWindow = new Date(Date.now() - 30 * 60 * 1000);
    const attemptResult = await db.query(
      `SELECT COUNT(*) AS fail_count
       FROM login_attempts
       WHERE email = ?
         AND succeeded = 0
         AND attempted_at >= ?
         AND attempted_at > COALESCE(
           (SELECT MAX(attempted_at) FROM login_attempts
            WHERE email = ? AND succeeded = 1),
           '1970-01-01'
         )`,
      [email, lockoutWindow, email]
    );
    const failCount = attemptResult.rows[0]?.fail_count ?? 0;
    if (failCount >= 10) {
      console.warn(`[SECURITY] Account locked due to too many failed attempts: ${email} from IP ${clientIp}`);
      return res.status(429).json({
        success: false,
        error: "Too many failed login attempts. Please try again in 30 minutes or reset your password.",
      });
    }

    // Find user by email
    const result = await db.query(
      "SELECT id, name, email, password_hash, role, mobile, location, company_name, is_active, created_at FROM users WHERE email = ?",
      [email]
    );

    const user = result.rows[0] || null;

    // ── Constant-time password comparison ────────────────────────────────────
    // ALWAYS run bcrypt.compare — even if the user was not found.
    // This prevents timing-based email enumeration where a faster response
    // (user not found, no bcrypt work) would reveal whether the email exists.
    // When user is not found, we compare against DUMMY_HASH (always fails).
    const hashToCompare = user ? user.password_hash : DUMMY_HASH;
    const isPasswordValid = await bcrypt.compare(password, hashToCompare);

    // ── Unified failure path ─────────────────────────────────────────────────
    // Any failure (user not found, wrong role, inactive, wrong password) returns
    // the SAME error message and is logged as a failed attempt. This prevents
    // error-message enumeration ("user not found" vs "wrong password" etc.).
    const isValidRole = user && user.role === role;
    const isActive = user && user.is_active;

    if (!user || !isPasswordValid || !isValidRole || !isActive) {
      // Log the failed attempt for account lockout tracking.
      // Fire-and-forget: never block the response on this insert.
      db.query(
        "INSERT INTO login_attempts (email, ip_address, succeeded) VALUES (?, ?, 0)",
        [email, clientIp]
      ).catch(err => console.error(`[LoginAttempts] Failed to log attempt for ${email}:`, err.message));

      // Return a deactivated account message only after verifying the password
      // is correct (prevents revealing account existence without authentication).
      if (user && isPasswordValid && isValidRole && !isActive) {
        return res.status(403).json({
          success: false,
          error: "Account has been deactivated. Contact admin.",
        });
      }

      return res.status(401).json({
        success: false,
        error: "Invalid email or password.",
      });
    }

    // ── Successful login ─────────────────────────────────────────────────────
    // Log success and generate JWT.
    db.query(
      "INSERT INTO login_attempts (email, ip_address, succeeded) VALUES (?, ?, 1)",
      [email, clientIp]
    ).catch(err => console.error(`[LoginAttempts] Failed to log success for ${email}:`, err.message));

    // Track last_login_at — used in admin Dealers list for support workflows (IMP-6).
    // Fire-and-forget: never block the login response on this update.
    db.query(
      "UPDATE users SET last_login_at = NOW() WHERE id = ?",
      [user.id]
    ).catch(err => console.error(`[Login] Failed to update last_login_at for user ${user.id}:`, err.message));

    // Generate JWT token
    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role },
      env.jwt.secret,
      { expiresIn: env.jwt.expiresIn }
    );

    res.json({
      success: true,
      message: "Login successful",
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        mobile: user.mobile,
        location: user.location,
        company_name: user.company_name,
        created_at: user.created_at,
      },
    });
  } catch (err) {
    next(err);
  }
});

// Helper to save base64 verification documents
const saveBase64File = async (fileObj, entityType, entityId, docType, dbClient = db, latitude = null, longitude = null) => {
  if (!fileObj || !fileObj.data) return null;

  // Resolve upload directory from env config (honours UPLOAD_DIR in production)
  const uploadsBase = path.isAbsolute(env.upload.dir)
    ? env.upload.dir
    : path.resolve(__dirname, "../..", env.upload.dir);
  
  const folderName = entityType === "quotation" ? "quotations" : "dealer_registrations";
  const uploadsDir = path.join(uploadsBase, folderName);
  await fs.mkdir(uploadsDir, { recursive: true });

  // Extract content and extension
  const matches = fileObj.data.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
  if (!matches || matches.length !== 3) {
    throw new Error("Invalid base64 data format");
  }

  // Cross-validate: MIME type in data URI must match declared file type
  const dataUriMime = matches[1];
  if (fileObj.type && dataUriMime !== fileObj.type) {
    throw new Error(`File type mismatch: declared '${fileObj.type}' but data contains '${dataUriMime}'.`);
  }

  const base64Data = matches[2];
  const buffer = Buffer.from(base64Data, "base64");

  // ── Magic-byte verification ──────────────────────────────────────────────
  // Verify the decoded buffer actually starts with the expected magic signature
  // for the declared MIME type. This guards against disguised uploads where a
  // malicious file is wrapped in a valid-looking base64 data URI with a correct
  // MIME prefix but crafted binary content. Mirrors the check in uploads.js.
  const MAGIC_SIGNATURES = new Map([
    ["image/jpeg",      [[0xFF, 0xD8, 0xFF]]],
    ["image/png",       [[0x89, 0x50, 0x4E, 0x47]]],
    ["image/webp",      [[0x52, 0x49, 0x46, 0x46]]], // "RIFF"
    ["application/pdf", [[0x25, 0x50, 0x44, 0x46]]], // "%PDF"
  ]);
  const signatures = MAGIC_SIGNATURES.get(dataUriMime);
  if (!signatures) {
    throw new Error(`Unsupported file type: '${dataUriMime}'.`);
  }
  const isValidMagic = signatures.some(sig =>
    sig.every((byte, i) => buffer[i] === byte)
  );
  if (!isValidMagic) {
    throw new Error(
      `File content does not match its declared type ('${dataUriMime}'). The file may be corrupted or disguised.`
    );
  }

  // Derive extension from the actual MIME in the data URI
  const mimeToExt = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "application/pdf": ".pdf",
  };
  const extension = mimeToExt[dataUriMime] || path.extname(fileObj.name) || ".bin";
  const filename = `${docType}_${entityId}_${Date.now()}${extension}`;
  const filePath = path.join(uploadsDir, filename);

  // Write file to disk
  await fs.writeFile(filePath, buffer);

  // Store relative path
  const relativePath = `${folderName}/${filename}`;

  // Insert document record into database
  // MySQL does not support RETURNING — we insert then fetch by LAST_INSERT_ID()
  const insertResult = await dbClient.query(
    `INSERT INTO documents (entity_type, entity_id, doc_type, file_path, original_name, mime_type, file_size_bytes, uploaded_by, public_token, latitude, longitude)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      entityType,
      entityId,
      docType,
      relativePath,
      fileObj.name,
      fileObj.type,
      fileObj.size,
      null, // uploaded_by is null since they are not logged in yet
      crypto.randomUUID(),
      latitude ? parseFloat(latitude) : null,
      longitude ? parseFloat(longitude) : null,
    ]
  );

  // Fetch the inserted document
  const docResult = await dbClient.query(
    "SELECT id, entity_type, entity_id, doc_type, original_name, mime_type, file_size_bytes, uploaded_at, public_token, latitude, longitude FROM documents WHERE id = ?",
    [insertResult.insertId]
  );

  return docResult.rows[0];
};

// ─── POST /api/auth/register ─────────────────────────────
// Public — Submit dealer registration application
router.post("/register", validate(registerSchema), async (req, res, next) => {
  try {
    const { name, email, password, mobile, location, companyName, aadhaarPhoto, aadhaarFront, aadhaarBack, panPhoto, passportPhoto, agreementPhoto, emailVerifiedToken } = req.body;

    // ── Email verification token — REQUIRED server-side ─────────────────────
    // The emailVerifiedToken JWT must be present and valid.
    // Previously this was only enforced in the UI; a direct API call could bypass
    // email verification entirely. We now enforce it server-side:
    // - type must be "email_verified"
    // - email in token must match the registration email
    // - must not be expired
    // Registration is blocked if the token is missing or invalid.
    let emailVerified = 0;
    if (!emailVerifiedToken) {
      return res.status(400).json({
        success: false,
        error: "Email verification is required. Please verify your email address using the OTP before registering.",
      });
    }
    try {
      const decoded = jwt.verify(emailVerifiedToken, env.jwt.secret);
      if (decoded.type === "email_verified" && decoded.email === email) {
        emailVerified = 1;
      } else {
        return res.status(400).json({
          success: false,
          error: "Email verification token is invalid or was issued for a different email address.",
        });
      }
    } catch {
      // Expired or malformed token
      return res.status(400).json({
        success: false,
        error: "Email verification has expired. Please verify your email again.",
      });
    }

    // ── Aadhaar completeness check ──────────────────────────────────────────
    // Require EITHER a single PDF/scan (aadhaarPhoto) OR both front+back photos.
    // Partial two-photo uploads (only front or only back) are rejected here.
    const hasAadhaarPdf = !!aadhaarPhoto;
    const hasAadhaarPhotos = !!aadhaarFront && !!aadhaarBack;
    if (!hasAadhaarPdf && !hasAadhaarPhotos) {
      return res.status(400).json({
        success: false,
        error: aadhaarFront || aadhaarBack
          ? "Please upload both the front and back sides of your Aadhaar card."
          : "Aadhaar card is required. Please upload a PDF scan or both sides as photos.",
      });
    }

    // Check if email already exists in users table
    const existingUser = await db.query(
      "SELECT id FROM users WHERE email = ?",
      [email]
    );
    if (existingUser.rows.length > 0) {
      return res.status(409).json({
        success: false,
        error: "An account with this email already exists.",
      });
    }

    // Check if a pending or recently-rejected registration already exists
    // Rejected within 30 days: cannot re-apply (prevents spam applications)
    // Rejected more than 30 days ago: allowed to re-apply (second chance)
    const existingReg = await db.query(
      `SELECT id, status FROM dealer_registrations
       WHERE email = ?
         AND (
           status = 'Pending'
           OR (status = 'Rejected' AND submitted_at >= DATE_SUB(NOW(), INTERVAL 30 DAY))
         )`,
      [email]
    );
    if (existingReg.rows.length > 0) {
      const reg = existingReg.rows[0];
      const msg = reg.status === "Pending"
        ? "A registration application with this email is already pending review."
        : "Your previous application was recently rejected. Please wait 30 days before reapplying.";
      return res.status(409).json({ success: false, error: msg });
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, 10);

    // Insert registration application (includes email_verified status)
    const insertResult = await db.query(
      `INSERT INTO dealer_registrations (name, email, mobile, location, company_name, password_hash, email_verified)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [name, email, mobile, location, companyName || null, passwordHash, emailVerified]
    );

    const regId = insertResult.insertId;

    // Fetch inserted record
    const result = await db.query(
      "SELECT id, name, email, status, submitted_at FROM dealer_registrations WHERE id = ?",
      [regId]
    );

    // Save uploaded documents if provided.
    // ATOMICITY GUARD: if any document save fails (disk full, magic-byte failure, I/O error),
    // we delete the just-inserted registration row so the dealer gets a clean error
    // and can retry the entire registration. Without this, a partial failure would leave
    // a DB record with missing documents that admin cannot properly review.
    // Note: Any disk files written before the failure remain (filesystem is not transactional),
    // but they are non-functional without a DB record pointing to them.
    try {
      // Aadhaar: save as single PDF/scan OR as front + back photos (mutually exclusive)
      if (aadhaarPhoto) {
        await saveBase64File(aadhaarPhoto, "dealer_registration", regId, "aadhaar");
      } else {
        // Two-photo mode: both front and back are guaranteed present (validated above)
        await saveBase64File(aadhaarFront, "dealer_registration", regId, "aadhaar_front");
        await saveBase64File(aadhaarBack, "dealer_registration", regId, "aadhaar_back");
      }
      if (panPhoto) {
        await saveBase64File(panPhoto, "dealer_registration", regId, "pan");
      }
      if (passportPhoto) {
        await saveBase64File(passportPhoto, "dealer_registration", regId, "passport_photo");
      }
      if (agreementPhoto) {
        await saveBase64File(agreementPhoto, "dealer_registration", regId, "other");
      }
    } catch (docErr) {
      // Compensating delete: remove the registration row so the dealer can retry cleanly
      try {
        await db.query("DELETE FROM dealer_registrations WHERE id = ?", [regId]);
      } catch (deleteErr) {
        console.error(`[Registration] Failed to clean up registration ID ${regId} after document error:`, deleteErr.message);
      }
      console.error(`[Registration] Document save failed for reg ID ${regId}:`, docErr.message);
      return res.status(500).json({
        success: false,
        error: "Failed to process uploaded documents. Please check your files and try again.",
      });
    }

    // Fire-and-forget welcome email — must never block or fail the registration response
    sendDealerWelcomeEmail(email, name)
      .catch(err => console.error("[Email] Welcome email failed:", err.message));

    res.status(201).json({
      success: true,
      message: "Registration submitted successfully. Waiting for admin approval.",
      registration: result.rows[0],
    });

    // Notify all admin sessions that a new dealer registration arrived
    broadcastToRole("admin", "registration:new", {
      id: regId,
      name,
      email,
      created_at: new Date().toISOString(),
    });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/auth/verify-email/send-otp ────────────────
// Public — Generate and email a 6-digit OTP for email verification.
// Used during dealer registration to prove email ownership before form submit.
// Always returns 200 to prevent email enumeration (same pattern as forgot-password).
router.post("/verify-email/send-otp", validate(sendOTPSchema), async (req, res, next) => {
  try {
    const { email } = req.body;

    // ── Silently skip if email is already a registered active user ──────────
    // We still return 200 so we don't reveal that the email is taken at this stage.
    // The /register route will give the proper 409 error at submission time.
    const existingUser = await db.query(
      "SELECT id FROM users WHERE email = ? AND is_active = 1",
      [email]
    );
    if (existingUser.rows.length > 0) {
      console.log(`[OTP] Send attempt for already-registered email: ${email} (silent skip)`);
      return res.json({ success: true, message: "OTP sent to your email if eligible." });
    }

    // ── Per-email rate limit: max 5 OTP sends per hour ─────────────────────
    const recentCount = await db.query(
      `SELECT COUNT(*) AS cnt FROM email_otp_tokens
       WHERE email = ? AND created_at >= DATE_SUB(NOW(), INTERVAL 1 HOUR)`,
      [email]
    );
    if (recentCount.rows[0].cnt >= 5) {
      return res.status(429).json({
        success: false,
        error: "Too many OTP requests for this email. Please wait before trying again.",
      });
    }

    // ── Delete all previous OTPs for this email (only one active at a time) ─
    await db.query("DELETE FROM email_otp_tokens WHERE email = ?", [email]);

    // ── Generate a 6-digit OTP using cryptographically secure random ────────
    // crypto.randomInt(min, max) is exclusive of max, so 100000–999999 gives exactly 6 digits.
    const otp = crypto.randomInt(100000, 1000000).toString();
    const otpHash = crypto.createHash("sha256").update(otp).digest("hex");

    // ── Store hashed OTP with 10-minute expiry ──────────────────────────────
    await db.query(
      `INSERT INTO email_otp_tokens (email, otp_hash, expires_at)
       VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 10 MINUTE))`,
      [email, otpHash]
    );

    // ── Send OTP email — fire-and-forget so SMTP failure doesn't block ──────
    // If SMTP fails the OTP is still in DB and user can request another.
    sendEmailOTPEmail(email, otp)
      .catch(err => console.error(`[OTP] Email send failed for ${email}:`, err.message));

    console.log(`[OTP] Sent to: ${email}`);
    return res.json({ success: true, message: "OTP sent to your email if eligible." });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/auth/verify-email/confirm-otp ─────────────
// Public — Verify the OTP entered by the user.
// On success, returns a short-lived email_verified_token JWT (15 min).
// On wrong OTP, increments attempt counter. Locks OTP after 5 wrong attempts.
router.post("/verify-email/confirm-otp", validate(confirmOTPSchema), async (req, res, next) => {
  try {
    const { email, otp } = req.body;

    // ── Find the active OTP for this email ─────────────────────────────────
    const result = await db.query(
      `SELECT id, otp_hash, attempts
       FROM email_otp_tokens
       WHERE email = ? AND used = 0 AND expires_at > NOW()
       ORDER BY created_at DESC
       LIMIT 1`,
      [email]
    );

    if (result.rows.length === 0) {
      return res.status(400).json({
        success: false,
        error: "OTP has expired or is invalid. Please request a new one.",
      });
    }

    const record = result.rows[0];

    // ── Check if already locked (5+ failed attempts) ────────────────────────
    if (record.attempts >= 5) {
      // Mark as used to force a fresh OTP on next send
      await db.query("UPDATE email_otp_tokens SET used = 1 WHERE id = ?", [record.id]);
      return res.status(429).json({
        success: false,
        error: "Too many incorrect attempts. Please request a new OTP.",
        locked: true,
        remainingAttempts: 0,
      });
    }

    // ── Compare hashes ──────────────────────────────────────────────────────
    const incomingHash = crypto.createHash("sha256").update(otp).digest("hex");
    if (incomingHash !== record.otp_hash) {
      const newAttempts = record.attempts + 1;
      const remainingAttempts = 5 - newAttempts;

      if (remainingAttempts <= 0) {
        // Lock the OTP — user must request a new one
        await db.query(
          "UPDATE email_otp_tokens SET attempts = ?, used = 1 WHERE id = ?",
          [newAttempts, record.id]
        );
        return res.status(429).json({
          success: false,
          error: "OTP locked after too many incorrect attempts. Please request a new OTP.",
          locked: true,
          remainingAttempts: 0,
        });
      }

      // Increment attempt counter, keep OTP active
      await db.query(
        "UPDATE email_otp_tokens SET attempts = ? WHERE id = ?",
        [newAttempts, record.id]
      );
      return res.status(400).json({
        success: false,
        error: "Incorrect OTP.",
        locked: false,
        remainingAttempts,
      });
    }

    // ── OTP is correct — mark as used ──────────────────────────────────────
    await db.query("UPDATE email_otp_tokens SET used = 1 WHERE id = ?", [record.id]);

    // ── Issue email_verified_token JWT (15 minutes) ─────────────────────────
    // This token proves email ownership. Passed back to the register endpoint.
    // Payload: type, email (validated against registration body at register time).
    const emailVerifiedToken = jwt.sign(
      { type: "email_verified", email, sub: email },
      env.jwt.secret,
      { expiresIn: "15m" }
    );

    console.log(`[OTP] Email verified successfully for: ${email}`);
    return res.json({
      success: true,
      message: "Email verified successfully.",
      token: emailVerifiedToken,
    });
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/auth/me ────────────────────────────────────
// Authenticated — Get current user profile
router.get("/me", authenticate, async (req, res, next) => {
  try {
    const result = await db.query(
      "SELECT id, name, email, role, mobile, location, company_name, created_at FROM users WHERE id = ?",
      [req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: "User not found.",
      });
    }

    res.json({
      success: true,
      user: result.rows[0],
    });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/auth/change-password ──────────────────────
// Authenticated — Change own password
router.post("/change-password", authenticate, validate(changePasswordSchema), async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body;

    // Get current password hash
    const result = await db.query(
      "SELECT password_hash FROM users WHERE id = ?",
      [req.user.id]
    );

    const user = result.rows[0];

    // Edge case: user was deleted while still having a valid JWT
    if (!user) {
      return res.status(404).json({
        success: false,
        error: "Account not found. Please log in again.",
      });
    }

    // Verify current password
    const isValid = await bcrypt.compare(currentPassword, user.password_hash);
    if (!isValid) {
      return res.status(400).json({
        success: false,
        error: "Current password is incorrect.",
      });
    }

    // Hash new password and update — also bump password_changed_at to
    // immediately invalidate all existing tokens for this user.
    const newHash = await bcrypt.hash(newPassword, 10);
    await db.query(
      "UPDATE users SET password_hash = ?, password_changed_at = UTC_TIMESTAMP() WHERE id = ?",
      [newHash, req.user.id]
    );

    console.log(`[AUDIT] Password changed for user ID ${req.user.id} (${req.user.email}) at ${new Date().toISOString()}`);

    res.json({
      success: true,
      message: "Password changed successfully.",
    });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/auth/forgot-password ──────────────────────
// Public — Send password reset email
router.post("/forgot-password", validate(forgotPasswordSchema), async (req, res, next) => {
  try {
    const { email } = req.body;

    // Find user by email
    const result = await db.query(
      "SELECT id, name, email FROM users WHERE email = ? AND is_active = 1",
      [email]
    );

    // SECURITY: Always return success even if email not found
    // This prevents email enumeration attacks
    if (result.rows.length === 0) {
      return res.json({
        success: true,
        message: "If an account with this email exists, a password reset link has been sent.",
      });
    }

    const user = result.rows[0];

    // Invalidate any existing unused tokens for this user
    await db.query(
      "UPDATE password_reset_tokens SET used = 1 WHERE user_id = ? AND used = 0",
      [user.id]
    );

    // Generate a secure random token
    const resetToken = crypto.randomBytes(32).toString("hex");

    // Hash the token before storing (so DB compromise doesn't leak usable tokens)
    const tokenHash = crypto.createHash("sha256").update(resetToken).digest("hex");

    // Store hashed token with 1-hour expiry
    await db.query(
      `INSERT INTO password_reset_tokens (user_id, token, expires_at)
       VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 1 HOUR))`,
      [user.id, tokenHash]
    );

    // Send reset email — fire-and-forget so SMTP failures never:
    // 1) Return a 500 to the user (which leaks that the email exists), or
    // 2) Block the response while the email service is slow/unreachable.
    // Failures are logged server-side for ops visibility.
    sendPasswordResetEmail(user.email, user.name, resetToken)
      .catch(err => console.error(`[Email] Password reset email failed for ${user.email}:`, err.message));

    res.json({
      success: true,
      message: "If an account with this email exists, a password reset link has been sent.",
    });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/auth/reset-password ───────────────────────
// Public — Reset password using token from email
router.post("/reset-password", validate(resetPasswordSchema), async (req, res, next) => {
  try {
    const { token, newPassword } = req.body;

    // Hash the incoming token to compare against stored hash
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");

    // Find valid, unexpired, unused token
    const result = await db.query(
      `SELECT prt.id, prt.user_id, u.name, u.email
       FROM password_reset_tokens prt
       JOIN users u ON u.id = prt.user_id
       WHERE prt.token = ?
         AND prt.used = 0
         AND prt.expires_at > NOW()`,
      [tokenHash]
    );

    if (result.rows.length === 0) {
      return res.status(400).json({
        success: false,
        error: "Invalid or expired reset link. Please request a new password reset.",
      });
    }

    const resetRecord = result.rows[0];

    // Hash new password
    const newHash = await bcrypt.hash(newPassword, 10);

    // Use a transaction to update password and mark token as used
    const client = await db.getClient();
    try {
      await client.query("BEGIN");

      // Update password — also bump password_changed_at to invalidate
      // all existing tokens immediately after a successful reset.
      await client.query(
        "UPDATE users SET password_hash = ?, password_changed_at = UTC_TIMESTAMP() WHERE id = ?",
        [newHash, resetRecord.user_id]
      );

      // Mark token as used
      await client.query(
        "UPDATE password_reset_tokens SET used = 1 WHERE id = ?",
        [resetRecord.id]
      );

      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }

    res.json({
      success: true,
      message: "Password has been reset successfully. You can now login with your new password.",
    });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/auth/admin-reset-password/:userId ─────────
// Admin only — Force reset a dealer's password
// SECURITY: This endpoint sets a new password directly (bypasses current-password check).
// To prevent misuse:
//   - Admins cannot reset other admins' passwords
//   - Admins cannot reset their OWN password via this route (use /change-password instead)
//   - The new password is NEVER sent in plaintext via email — a secure reset link is sent instead
router.post(
  "/admin-reset-password/:userId",
  authenticate,
  authorize("admin"),
  validate(adminResetPasswordSchema),
  async (req, res, next) => {
    try {
      const userId = parseInt(req.params.userId, 10);
      const { newPassword } = req.body;

      if (isNaN(userId)) {
        return res.status(400).json({ success: false, error: "Invalid user ID." });
      }

      // Verify user exists
      const result = await db.query(
        "SELECT id, name, email, role FROM users WHERE id = ?",
        [userId]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({
          success: false,
          error: "User not found.",
        });
      }

      const targetUser = result.rows[0];

      // SECURITY: Admins cannot reset another admin's password.
      if (targetUser.role === "admin") {
        return res.status(403).json({
          success: false,
          error: "Cannot reset an admin account's password via this route. Use the standard Change Password option.",
        });
      }

      // Hash and update password — also bump password_changed_at to
      // immediately invalidate all existing sessions for the target user.
      const newHash = await bcrypt.hash(newPassword, 10);
      await db.query(
        "UPDATE users SET password_hash = ?, password_changed_at = UTC_TIMESTAMP() WHERE id = ?",
        [newHash, userId]
      );

      console.log(`[AUDIT] Admin password reset: admin ID ${req.user.id} (${req.user.email}) reset password for dealer ID ${userId} (${targetUser.email}) at ${new Date().toISOString()}`);

      res.json({
        success: true,
        message: `Password reset for ${targetUser.name} (${targetUser.email}).`,
      });

      // SECURITY FIX: Send a secure reset link instead of the plaintext password.
      // Sending a new password in plaintext email is a critical security vulnerability:
      //   - Email is not encrypted in transit by default
      //   - Email servers/clients/proxies may log content
      //   - The dealer can set their own new password via the reset link
      //
      // We invalidate any old reset tokens, create a new one, and email the link.
      // This is fire-and-forget: never block the admin response on email operations.
      (async () => {
        try {
          // Invalidate any existing unused reset tokens for this user
          await db.query(
            "UPDATE password_reset_tokens SET used = 1 WHERE user_id = ? AND used = 0",
            [targetUser.id]
          );
          // Generate a new secure reset token (64 hex chars = 256 bits entropy)
          const resetToken = crypto.randomBytes(32).toString("hex");
          const tokenHash = crypto.createHash("sha256").update(resetToken).digest("hex");
          await db.query(
            `INSERT INTO password_reset_tokens (user_id, token, expires_at)
             VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 24 HOUR))`,
            [targetUser.id, tokenHash]
          );
          // Send reset email — dealer sets their own new password
          await sendAdminPasswordResetEmail(targetUser.email, targetUser.name, resetToken);
        } catch (err) {
          console.error(`[EMAIL] Failed to send admin password reset notification to ${targetUser.email}:`, err.message);
        }
      })();
    } catch (err) {
      next(err);
    }
  }
);

// ─── GET /api/auth/reupload/probe ─────────────────────────────
// Public — Lightweight check whether a raw re-upload token is still valid.
// Returns 200 if the token is valid (unexpired, unused, registration still ReuploadRequested).
// Returns 400 if the token is expired, used, or not found.
// Does NOT require a password — this is intentionally safe because:
//   - It only reveals "valid vs. invalid", not any personal data.
//   - Tokens are 64-char hex (256-bit entropy) — not enumerable.
//   - The endpoint is covered by the general 200-req/15-min rate limiter.
// Used by DealerReuploadPage on mount to show the 'Link Expired' screen up-front.
router.get("/reupload/probe", async (req, res, next) => {
  try {
    const rawToken = req.query.token;

    if (!rawToken || typeof rawToken !== "string" || rawToken.length < 32) {
      return res.status(400).json({ success: false, valid: false, error: "Invalid token format." });
    }

    const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");

    const result = await db.query(
      `SELECT rt.id
       FROM dealer_reupload_tokens rt
       JOIN dealer_registrations dr ON dr.id = rt.registration_id
       WHERE rt.token = ?
         AND rt.used = 0
         AND rt.expires_at > NOW()
         AND dr.status = 'ReuploadRequested'`,
      [tokenHash]
    );

    if (result.rows.length === 0) {
      return res.status(400).json({
        success: false,
        valid: false,
        error: "This re-upload link is no longer valid.",
      });
    }

    return res.json({ success: true, valid: true });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/auth/reupload/verify ──────────────────────────
// Public — Verify re-upload token + dealer's registration password
// Returns a short-lived re-upload JWT on success
router.post("/reupload/verify", reuploadVerifyLimiter, async (req, res, next) => {
  try {
    const { token, password } = req.body;

    if (!token || !password) {
      return res.status(400).json({ success: false, error: "Token and password are required." });
    }

    // Hash the incoming token to compare against stored hash
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");

    // Find valid, unexpired, unused token + linked registration
    const result = await db.query(
      `SELECT rt.id AS token_id, rt.registration_id, rt.reason, rt.required_docs,
              dr.name, dr.email, dr.password_hash, dr.status
       FROM dealer_reupload_tokens rt
       JOIN dealer_registrations dr ON dr.id = rt.registration_id
       WHERE rt.token = ?
         AND rt.used = 0
         AND rt.expires_at > NOW()`,
      [tokenHash]
    );

    if (result.rows.length === 0) {
      return res.status(400).json({
        success: false,
        error: "This re-upload link is invalid, has already been used, or has expired. Please contact admin for a new link.",
      });
    }

    const record = result.rows[0];

    // Verify the registration is still in ReuploadRequested status
    if (record.status !== "ReuploadRequested") {
      return res.status(400).json({
        success: false,
        error: "This re-upload request is no longer valid. The registration status may have changed.",
      });
    }

    // Verify password against registration password_hash
    const isPasswordValid = await bcrypt.compare(password, record.password_hash);
    if (!isPasswordValid) {
      return res.status(401).json({
        success: false,
        error: "Incorrect password. Please enter the password you used when you registered.",
      });
    }

    // Issue a short-lived re-upload JWT (separate from main app JWT)
    const reuploadToken = jwt.sign(
      { type: "reupload", regId: record.registration_id, tokenId: record.token_id },
      env.jwt.secret,
      { expiresIn: "1h" }
    );

    const requiredDocs = record.required_docs
      ? record.required_docs.split(",").filter(Boolean)
      : [];

    res.json({
      success: true,
      reuploadToken,
      registration: {
        name: record.name,
        email: record.email,
        reason: record.reason,
        requiredDocs,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/auth/reupload/info ──────────────────────────────
// Protected (reupload JWT) — Get re-upload session info
router.get("/reupload/info", async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ success: false, error: "Re-upload token required." });
    }
    const reuploadToken = authHeader.split(" ")[1];

    let decoded;
    try {
      decoded = jwt.verify(reuploadToken, env.jwt.secret);
    } catch {
      return res.status(401).json({ success: false, error: "Invalid or expired re-upload session. Please use the link from your email again." });
    }

    if (decoded.type !== "reupload") {
      return res.status(401).json({ success: false, error: "Invalid token type." });
    }

    // Re-fetch token and registration to get current state
    const result = await db.query(
      `SELECT rt.reason, rt.required_docs, dr.name, dr.email
       FROM dealer_reupload_tokens rt
       JOIN dealer_registrations dr ON dr.id = rt.registration_id
       WHERE rt.id = ? AND rt.used = 0 AND rt.expires_at > NOW()`,
      [decoded.tokenId]
    );

    if (result.rows.length === 0) {
      return res.status(400).json({ success: false, error: "This re-upload session is no longer valid." });
    }

    const record = result.rows[0];
    const requiredDocs = record.required_docs ? record.required_docs.split(",").filter(Boolean) : [];

    res.json({
      success: true,
      registration: {
        name: record.name,
        email: record.email,
        reason: record.reason,
        requiredDocs,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/auth/reupload/submit ──────────────────────────
// Protected (reupload JWT) — Submit new documents
router.post("/reupload/submit", async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ success: false, error: "Re-upload token required." });
    }
    const reuploadToken = authHeader.split(" ")[1];

    let decoded;
    try {
      decoded = jwt.verify(reuploadToken, env.jwt.secret);
    } catch {
      return res.status(401).json({ success: false, error: "Invalid or expired re-upload session. Please use the link from your email again." });
    }

    if (decoded.type !== "reupload") {
      return res.status(401).json({ success: false, error: "Invalid token type." });
    }

    const { regId, tokenId } = decoded;
    const { aadhaarPhoto, aadhaarFront, aadhaarBack, panPhoto, passportPhoto, agreementPhoto } = req.body;

    // Re-validate the token is still valid (not used/expired)
    const tokenResult = await db.query(
      `SELECT rt.id, rt.required_docs, dr.name, dr.email, dr.status
       FROM dealer_reupload_tokens rt
       JOIN dealer_registrations dr ON dr.id = rt.registration_id
       WHERE rt.id = ? AND rt.used = 0 AND rt.expires_at > NOW() AND rt.registration_id = ?`,
      [tokenId, regId]
    );

    if (tokenResult.rows.length === 0) {
      return res.status(400).json({ success: false, error: "This re-upload session is no longer valid." });
    }

    const tokenRecord = tokenResult.rows[0];
    if (tokenRecord.status !== "ReuploadRequested") {
      return res.status(400).json({ success: false, error: "Registration status has changed. Please contact admin." });
    }

    const requiredDocs = tokenRecord.required_docs ? tokenRecord.required_docs.split(",").filter(Boolean) : [];

    // Determine what Aadhaar the dealer actually provided.
    // Admin always requests "aadhaar"; dealer chooses format:
    //   - photos mode → aadhaarFront + aadhaarBack (saved as aadhaar_front / aadhaar_back)
    //   - PDF mode    → aadhaarPhoto               (saved as aadhaar)
    const aadhaarNeeded = requiredDocs.includes("aadhaar");
    const hasAadhaarPdf    = aadhaarNeeded && !!aadhaarPhoto;
    const hasAadhaarPhotos = aadhaarNeeded && !!aadhaarFront && !!aadhaarBack;
    const aadhaarSatisfied = hasAadhaarPdf || hasAadhaarPhotos;

    // Validate that all required documents are provided
    const providedDocs = [];
    if (aadhaarNeeded && aadhaarSatisfied) providedDocs.push("aadhaar");
    if (requiredDocs.includes("pan")            && panPhoto)     providedDocs.push("pan");
    if (requiredDocs.includes("passport_photo") && passportPhoto) providedDocs.push("passport_photo");
    if (requiredDocs.includes("other")          && agreementPhoto) providedDocs.push("other");

    const missingDocs = requiredDocs.filter(d => !providedDocs.includes(d));
    if (missingDocs.length > 0) {
      const docLabels = {
        aadhaar:        hasAadhaarPdf === false && hasAadhaarPhotos === false
          ? (aadhaarFront || aadhaarBack ? "Aadhaar Card (Back Side missing)" : "Aadhaar Card (upload PDF or both front + back photos)")
          : "Aadhaar Card",
        pan:            "PAN Card",
        passport_photo: "Passport Photo",
        other:          "Dealership Agreement",
      };
      return res.status(400).json({
        success: false,
        error: `Missing required documents: ${missingDocs.map(d => docLabels[d] || d).join(", ")}`,
      });
    }

    // Use a transaction for atomicity:
    // file writes are NOT transactional, but DB operations are.
    // If any DB step fails, we roll back so the DB remains consistent.
    // (Orphaned files from failed writes are acceptable; the next re-upload request
    //  will DELETE the old DB records, and orphaned files can be cleaned up by a cron.)
    const client = await db.getClient();
    try {
      await client.query("BEGIN");

      // Delete old documents. When aadhaar is in requiredDocs, also delete
      // aadhaar_front and aadhaar_back to clean up regardless of the original
      // upload mode (in case dealer switches between PDF and two-photo modes).
      if (requiredDocs.length > 0) {
        const deleteTypes = aadhaarNeeded
          ? [...requiredDocs.filter(d => d !== "aadhaar"), "aadhaar", "aadhaar_front", "aadhaar_back"]
          : requiredDocs;
        const placeholders = deleteTypes.map(() => "?").join(", ");
        await client.query(
          `DELETE FROM documents
           WHERE entity_type = 'dealer_registration' AND entity_id = ? AND doc_type IN (${placeholders})`,
          [regId, ...deleteTypes]
        );
      }

      // Save new Aadhaar documents — format chosen by dealer (all stale variants deleted above)
      if (aadhaarNeeded) {
        if (hasAadhaarPdf) {
          await saveBase64File(aadhaarPhoto, "dealer_registration", regId, "aadhaar", client);
        } else if (hasAadhaarPhotos) {
          await saveBase64File(aadhaarFront, "dealer_registration", regId, "aadhaar_front", client);
          await saveBase64File(aadhaarBack,  "dealer_registration", regId, "aadhaar_back",  client);
        }
      }
      if (panPhoto && requiredDocs.includes("pan")) {
        await saveBase64File(panPhoto, "dealer_registration", regId, "pan", client);
      }
      if (passportPhoto && requiredDocs.includes("passport_photo")) {
        await saveBase64File(passportPhoto, "dealer_registration", regId, "passport_photo", client);
      }
      if (agreementPhoto && requiredDocs.includes("other")) {
        await saveBase64File(agreementPhoto, "dealer_registration", regId, "other", client);
      }

      // Mark the re-upload token as used
      await client.query("UPDATE dealer_reupload_tokens SET used = 1 WHERE id = ?", [tokenId]);

      // Set registration status back to Pending for re-review
      // (reupload_count is computed dynamically from dealer_reupload_tokens WHERE used=1 —
      //  marking this token used=1 above automatically increments that count for admin display)
      await client.query(
        "UPDATE dealer_registrations SET status = 'Pending', reviewed_by = NULL, reviewed_at = NULL WHERE id = ?",
        [regId]
      );

      // Mark that admin needs to review the newly uploaded documents.
      // Inside the transaction so it's atomic with all other state changes above.
      await client.query(
        "UPDATE dealer_registrations SET needs_review_after_reupload = 1 WHERE id = ?",
        [regId]
      );

      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }


    // Send confirmation email (fire-and-forget)
    sendReuploadConfirmationEmail(tokenRecord.email, tokenRecord.name)
      .catch(err => console.error(`[EMAIL] Failed to send re-upload confirmation to ${tokenRecord.email}:`, err.message));

    console.log(`[AUDIT] Re-upload submitted for registration ID ${regId} (${tokenRecord.email}) at ${new Date().toISOString()}`);

    res.json({
      success: true,
      message: "Documents re-uploaded successfully. Your registration is now back under review.",
    });

    // Notify all admin tabs that a dealer re-submitted registration docs (needs review)
    broadcastToRole("admin", "registration:status_changed", {
      id: regId,
      name: tokenRecord.name,
      status: "Pending",
      needs_review: true,
    });
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/auth/reupload-quotation/probe ────────────────────
// Public — Lightweight check whether a raw quotation re-upload token is still valid.
router.get("/reupload-quotation/probe", async (req, res, next) => {
  try {
    const rawToken = req.query.token;

    if (!rawToken || typeof rawToken !== "string" || rawToken.length < 32) {
      return res.status(400).json({ success: false, valid: false, error: "Invalid token format." });
    }

    const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");

    const result = await db.query(
      `SELECT rt.id
       FROM quotation_reupload_tokens rt
       JOIN quotations q ON q.id = rt.quotation_id
       WHERE rt.token = ?
         AND rt.used = 0
         AND rt.expires_at > NOW()
         AND q.status = 'ReuploadRequested'`,
      [tokenHash]
    );

    if (result.rows.length === 0) {
      return res.status(400).json({
        success: false,
        valid: false,
        error: "This re-upload link is no longer valid.",
      });
    }

    return res.json({ success: true, valid: true });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/auth/reupload-quotation/verify ──────────────────
// Public — Verify quotation re-upload token + dealer's password
router.post("/reupload-quotation/verify", reuploadVerifyLimiter, async (req, res, next) => {
  try {
    const { token, password } = req.body;

    if (!token || !password) {
      return res.status(400).json({ success: false, error: "Token and password are required." });
    }

    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");

    // Find valid token + quotation + dealer
    const result = await db.query(
      `SELECT rt.id AS token_id, rt.quotation_id, rt.reason, rt.required_docs,
              q.quotation_number, q.status,
              u.name AS dealer_name, u.email AS dealer_email, u.password_hash AS dealer_password_hash,
              c.name AS customer_name
       FROM quotation_reupload_tokens rt
       JOIN quotations q ON q.id = rt.quotation_id
       JOIN users u ON u.id = q.dealer_id
       LEFT JOIN customers c ON c.id = q.customer_id
       WHERE rt.token = ?
         AND rt.used = 0
         AND rt.expires_at > NOW()`,
      [tokenHash]
    );

    if (result.rows.length === 0) {
      return res.status(400).json({
        success: false,
        error: "This re-upload link is invalid, has already been used, or has expired. Please contact admin for a new link.",
      });
    }

    const record = result.rows[0];

    // Verify the quotation is still in ReuploadRequested status
    if (record.status !== "ReuploadRequested") {
      return res.status(400).json({
        success: false,
        error: "This re-upload request is no longer valid. The quotation status may have changed.",
      });
    }

    // Verify dealer password against users password_hash
    const isPasswordValid = await bcrypt.compare(password, record.dealer_password_hash);
    if (!isPasswordValid) {
      return res.status(401).json({
        success: false,
        error: "Incorrect password. Please enter your dealer account password.",
      });
    }

    // Issue a short-lived re-upload JWT
    const reuploadToken = jwt.sign(
      { type: "reupload_quotation", quotationId: record.quotation_id, tokenId: record.token_id },
      env.jwt.secret,
      { expiresIn: "1h" }
    );

    const requiredDocs = record.required_docs
      ? record.required_docs.split(",").filter(Boolean)
      : [];

    res.json({
      success: true,
      reuploadToken,
      quotation: {
        quotationNumber: record.quotation_number,
        customerName: record.customer_name || "Valued Customer",
        reason: record.reason,
        requiredDocs,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/auth/reupload-quotation/info ─────────────────────
// Protected — Get quotation re-upload session info
router.get("/reupload-quotation/info", async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ success: false, error: "Re-upload token required." });
    }
    const reuploadToken = authHeader.split(" ")[1];

    let decoded;
    try {
      decoded = jwt.verify(reuploadToken, env.jwt.secret);
    } catch {
      return res.status(401).json({ success: false, error: "Invalid or expired session. Please use the link from your email again." });
    }

    if (decoded.type !== "reupload_quotation") {
      return res.status(401).json({ success: false, error: "Invalid token type." });
    }

    // Re-fetch token and details
    const result = await db.query(
      `SELECT rt.reason, rt.required_docs, q.quotation_number, c.name AS customer_name
       FROM quotation_reupload_tokens rt
       JOIN quotations q ON q.id = rt.quotation_id
       LEFT JOIN customers c ON c.id = q.customer_id
       WHERE rt.id = ? AND rt.used = 0 AND rt.expires_at > NOW()`,
      [decoded.tokenId]
    );

    if (result.rows.length === 0) {
      return res.status(400).json({ success: false, error: "This re-upload session is no longer valid." });
    }

    const record = result.rows[0];
    const requiredDocs = record.required_docs ? record.required_docs.split(",").filter(Boolean) : [];

    res.json({
      success: true,
      quotation: {
        quotationNumber: record.quotation_number,
        customerName: record.customer_name || "Valued Customer",
        reason: record.reason,
        requiredDocs,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/auth/reupload-quotation/submit ──────────────────
// Protected — Submit new files for a quotation
router.post("/reupload-quotation/submit", async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ success: false, error: "Re-upload token required." });
    }
    const reuploadToken = authHeader.split(" ")[1];

    let decoded;
    try {
      decoded = jwt.verify(reuploadToken, env.jwt.secret);
    } catch {
      return res.status(401).json({ success: false, error: "Invalid or expired session. Please use the link from your email again." });
    }

    if (decoded.type !== "reupload_quotation") {
      return res.status(401).json({ success: false, error: "Invalid token type." });
    }

    const { quotationId, tokenId } = decoded;
    const filesPayload = req.body || {}; // e.g. { aadhaar, pan, geotag_1 }

    // Re-validate the token is still valid (not used/expired)
    const tokenResult = await db.query(
      `SELECT rt.id, rt.required_docs, q.quotation_number, q.status, q.customer_id, q.dealer_id,
              u.name AS dealer_name, u.email AS dealer_email,
              c.name AS customer_name
       FROM quotation_reupload_tokens rt
       JOIN quotations q ON q.id = rt.quotation_id
       JOIN users u ON u.id = q.dealer_id
       LEFT JOIN customers c ON c.id = q.customer_id
       WHERE rt.id = ? AND rt.used = 0 AND rt.expires_at > NOW() AND rt.quotation_id = ?`,
      [tokenId, quotationId]
    );

    if (tokenResult.rows.length === 0) {
      return res.status(400).json({ success: false, error: "This re-upload session is no longer valid." });
    }

    const tokenRecord = tokenResult.rows[0];
    if (tokenRecord.status !== "ReuploadRequested") {
      return res.status(400).json({ success: false, error: "Quotation status has changed. Please contact admin." });
    }

    const requiredDocs = tokenRecord.required_docs ? tokenRecord.required_docs.split(",").filter(Boolean) : [];

    // Check all required documents are in req.body
    const missingDocs = requiredDocs.filter(d => !filesPayload[d]);
    if (missingDocs.length > 0) {
      const docLabels = {
        aadhaar:       "Aadhaar Card",
        pan:           "PAN Card",
        passbook:      "Bank Passbook",
        light_bill:    "Latest Light Bill",
        vera_bill:     "Vera Bill",
        house_photo_1: "House Photo 1",
        house_photo_2: "House Photo 2",
        house_photo_3: "House Photo 3",
        geotag_1:      "Site / Inverter Photo",
        geotag_2:      "Solar Panels Photo",
        geotag_3:      "ACDB / Net Meter Photo",
      };
      return res.status(400).json({
        success: false,
        error: `Missing required documents: ${missingDocs.map(d => docLabels[d] || d).join(", ")}`,
      });
    }

    // Resolve uploads base path for cleaning up old files
    const uploadsBase = path.isAbsolute(env.upload.dir)
      ? env.upload.dir
      : path.resolve(__dirname, "../..", env.upload.dir);

    const client = await db.getClient();
    try {
      await client.query("BEGIN");

      // Delete old document files and DB rows for this quotation
      if (requiredDocs.length > 0) {
        const placeholders = requiredDocs.map(() => "?").join(", ");
        const oldDocsResult = await client.query(
          `SELECT id, file_path FROM documents
           WHERE entity_type = 'quotation' AND entity_id = ? AND doc_type IN (${placeholders})`,
          [quotationId, ...requiredDocs]
        );

        for (const doc of oldDocsResult.rows) {
          const oldAbsPath = path.normalize(path.join(uploadsBase, doc.file_path));
          if (oldAbsPath.startsWith(uploadsBase + path.sep)) {
            try {
              await fs.unlink(oldAbsPath);
            } catch (err) {
              // Ignore if file doesn't exist on disk
            }
          }
        }

        await client.query(
          `DELETE FROM documents
           WHERE entity_type = 'quotation' AND entity_id = ? AND doc_type IN (${placeholders})`,
          [quotationId, ...requiredDocs]
        );
      }

      // Save new files from payload (each item can be: { data, name, type, size, latitude?, longitude? })
      for (const docType of requiredDocs) {
        const fileObj = filesPayload[docType];
        const lat = fileObj.latitude !== undefined ? fileObj.latitude : null;
        const lng = fileObj.longitude !== undefined ? fileObj.longitude : null;
        await saveBase64File(fileObj, "quotation", quotationId, docType, client, lat, lng);
      }

      // Mark the re-upload token as used
      await client.query("UPDATE quotation_reupload_tokens SET used = 1 WHERE id = ?", [tokenId]);

      // Set quotation status back to Pending for review
      await client.query(
        "UPDATE quotations SET status = 'Pending' WHERE id = ?",
        [quotationId]
      );

      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }

    // Send confirmation email (fire-and-forget)
    sendQuotationReuploadConfirmationEmail(
      tokenRecord.dealer_email,
      tokenRecord.dealer_name,
      tokenRecord.customer_name || "Valued Customer",
      tokenRecord.quotation_number
    ).catch(err => console.error(`[EMAIL] Failed to send quotation re-upload confirmation:`, err.message));

    console.log(`[AUDIT] Re-upload submitted for quotation ID ${quotationId} (${tokenRecord.quotation_number}) at ${new Date().toISOString()}`);

    res.json({
      success: true,
      message: "Documents and photos re-uploaded successfully. Your quotation is now back under review.",
    });

    // Notify all admin tabs that a quotation doc re-upload was submitted (via email link)
    broadcastToRole("admin", "quotation:status_changed", {
      id: quotationId,
      quotation_number: tokenRecord.quotation_number,
      status: "Pending",
      needs_review: true,
    });
    // Notify the dealer's logged-in sessions (DealerRequests tab) that their quotation
    // is now back to Pending — even though the reupload was done via the email link.
    if (tokenRecord.dealer_id) {
      broadcastToUser(tokenRecord.dealer_id, "quotation:status_changed", {
        id: quotationId,
        quotation_number: tokenRecord.quotation_number,
        status: "Pending",
      });
    }
  } catch (err) {
    next(err);
  }
});

export default router;
