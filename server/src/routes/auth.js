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
} from "../validators/authSchema.js";
import { sendPasswordResetEmail, sendDealerWelcomeEmail, sendReuploadConfirmationEmail } from "../services/emailService.js";

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

// ─── POST /api/auth/login ────────────────────────────────
// Public — Authenticate user and return JWT token
router.post("/login", validate(loginSchema), async (req, res, next) => {
  try {
    const { email, password, role } = req.body;

    // Find user by email
    const result = await db.query(
      "SELECT id, name, email, password_hash, role, is_active FROM users WHERE email = ?",
      [email]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({
        success: false,
        error: "Invalid email or password.",
      });
    }

    const user = result.rows[0];

    // Check if account is active (MySQL returns TINYINT as number)
    if (!user.is_active) {
      return res.status(403).json({
        success: false,
        error: "Account has been deactivated. Contact admin.",
      });
    }

    // Check if the user has the correct role
    if (user.role !== role) {
      return res.status(401).json({
        success: false,
        error: "Invalid email or password.",
      });
    }

    // Verify password
    const isPasswordValid = await bcrypt.compare(password, user.password_hash);
    if (!isPasswordValid) {
      return res.status(401).json({
        success: false,
        error: "Invalid email or password.",
      });
    }

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
      },
    });
  } catch (err) {
    next(err);
  }
});

// Helper to save base64 verification documents
const saveBase64File = async (fileObj, entityType, entityId, docType, dbClient = db) => {
  if (!fileObj || !fileObj.data) return null;

  // Resolve upload directory from env config (honours UPLOAD_DIR in production)
  const uploadsBase = path.isAbsolute(env.upload.dir)
    ? env.upload.dir
    : path.resolve(__dirname, "../..", env.upload.dir);
  const uploadsDir = path.join(uploadsBase, "dealer_registrations");
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
  const relativePath = `dealer_registrations/${filename}`;

  // Insert document record into database
  // MySQL does not support RETURNING — we insert then fetch by LAST_INSERT_ID()
  const insertResult = await dbClient.query(
    `INSERT INTO documents (entity_type, entity_id, doc_type, file_path, original_name, mime_type, file_size_bytes, uploaded_by, public_token)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
    ]
  );

  // Fetch the inserted document
  const docResult = await dbClient.query(
    "SELECT id, entity_type, entity_id, doc_type, original_name, mime_type, file_size_bytes, uploaded_at, public_token FROM documents WHERE id = ?",
    [insertResult.insertId]
  );

  return docResult.rows[0];
};

// ─── POST /api/auth/register ─────────────────────────────
// Public — Submit dealer registration application
router.post("/register", validate(registerSchema), async (req, res, next) => {
  try {
    const { name, email, password, mobile, location, companyName, aadhaarPhoto, panPhoto, passportPhoto } = req.body;

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

    // Insert registration application
    const insertResult = await db.query(
      `INSERT INTO dealer_registrations (name, email, mobile, location, company_name, password_hash)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [name, email, mobile, location, companyName || null, passwordHash]
    );

    const regId = insertResult.insertId;

    // Fetch inserted record
    const result = await db.query(
      "SELECT id, name, email, status, submitted_at FROM dealer_registrations WHERE id = ?",
      [regId]
    );

    // Save uploaded documents if provided
    if (aadhaarPhoto) {
      await saveBase64File(aadhaarPhoto, "dealer_registration", regId, "aadhaar");
    }
    if (panPhoto) {
      await saveBase64File(panPhoto, "dealer_registration", regId, "pan");
    }
    if (passportPhoto) {
      await saveBase64File(passportPhoto, "dealer_registration", regId, "passport_photo");
    }

    // Fire-and-forget welcome email — must never block or fail the registration response
    sendDealerWelcomeEmail(email, name)
      .catch(err => console.error("[Email] Welcome email failed:", err.message));

    res.status(201).json({
      success: true,
      message: "Registration submitted successfully. Waiting for admin approval.",
      registration: result.rows[0],
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

    // Send reset email
    await sendPasswordResetEmail(user.email, user.name, resetToken);

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

      // Verify user exists and is a dealer
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

      // Prevent admin from resetting another admin's password
      if (targetUser.role === "admin" && targetUser.id !== req.user.id) {
        return res.status(403).json({
          success: false,
          error: "Cannot reset another admin's password.",
        });
      }

      // Hash and update password — also bump password_changed_at to
      // immediately invalidate all existing sessions for the target user.
      const newHash = await bcrypt.hash(newPassword, 10);
      await db.query(
        "UPDATE users SET password_hash = ?, password_changed_at = UTC_TIMESTAMP() WHERE id = ?",
        [newHash, userId]
      );

      console.log(`[AUDIT] Admin password reset: admin ID ${req.user.id} (${req.user.email}) reset password for user ID ${userId} (${targetUser.email}) at ${new Date().toISOString()}`);

      res.json({
        success: true,
        message: `Password reset for ${targetUser.name} (${targetUser.email}).`,
      });
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
    const { aadhaarPhoto, panPhoto, passportPhoto } = req.body;

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

    // Validate that all required documents are provided
    const providedDocs = [];
    if (requiredDocs.includes("aadhaar") && aadhaarPhoto) providedDocs.push("aadhaar");
    if (requiredDocs.includes("pan") && panPhoto) providedDocs.push("pan");
    if (requiredDocs.includes("passport_photo") && passportPhoto) providedDocs.push("passport_photo");

    const missingDocs = requiredDocs.filter(d => !providedDocs.includes(d));
    if (missingDocs.length > 0) {
      const docLabels = { aadhaar: "Aadhaar Card", pan: "PAN Card", passport_photo: "Passport Photo" };
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

      // Delete old documents of the required types from the DB
      if (requiredDocs.length > 0) {
        const placeholders = requiredDocs.map(() => "?").join(", ");
        await client.query(
          `DELETE FROM documents
           WHERE entity_type = 'dealer_registration' AND entity_id = ? AND doc_type IN (${placeholders})`,
          [regId, ...requiredDocs]
        );
      }

      // Save new documents (these write files to disk — outside transaction scope)
      if (aadhaarPhoto && requiredDocs.includes("aadhaar")) {
        await saveBase64File(aadhaarPhoto, "dealer_registration", regId, "aadhaar", client);
      }
      if (panPhoto && requiredDocs.includes("pan")) {
        await saveBase64File(panPhoto, "dealer_registration", regId, "pan", client);
      }
      if (passportPhoto && requiredDocs.includes("passport_photo")) {
        await saveBase64File(passportPhoto, "dealer_registration", regId, "passport_photo", client);
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
  } catch (err) {
    next(err);
  }
});

export default router;
