import { Router } from "express";
import bcrypt from "bcryptjs";
import crypto from "crypto";

import db from "../config/database.js";
import env from "../config/env.js";
import { authenticate, authorize } from "../middleware/auth.js";
import { sendDealerStatusEmail, sendDocumentReuploadEmail } from "../services/emailService.js";

const router = Router();

// All dealer management routes require admin
router.use(authenticate);
router.use(authorize("admin"));

// ─── GET /api/dealers/registrations/stats ────────────────
// Returns counts per status + needs-review count for admin stat boxes.
// Must be before /registrations/:id to avoid being parsed as :id.
router.get("/registrations/stats", async (req, res, next) => {
  try {
    const result = await db.query(`
      SELECT
        COUNT(*)                                                         AS total,
        SUM(status = 'Pending')                                          AS pending,
        SUM(status = 'Approved')                                         AS approved,
        SUM(status = 'Rejected')                                         AS rejected,
        SUM(status = 'ReuploadRequested')                                AS reupload_requested,
        SUM(status = 'Pending' AND needs_review_after_reupload = 1)      AS needs_review
      FROM dealer_registrations
    `);
    const row = result.rows[0];
    res.json({
      success: true,
      stats: {
        total:             parseInt(row.total, 10)             || 0,
        pending:           parseInt(row.pending, 10)           || 0,
        approved:          parseInt(row.approved, 10)          || 0,
        rejected:          parseInt(row.rejected, 10)          || 0,
        reuploadRequested: parseInt(row.reupload_requested, 10)|| 0,
        needsReview:       parseInt(row.needs_review, 10)      || 0,
      },
    });
  } catch (err) { next(err); }
});

// ─── GET /api/dealers/registrations/needs-review ─────────
// Lightweight endpoint for cross-tab review banners.
// Returns only the minimal fields for registrations that need admin review
// after a dealer has re-uploaded documents (needs_review_after_reupload = 1).
// Much cheaper than fetching status=All with full document JOINs just for banners.
// Must be before /registrations/:id to avoid being parsed as :id="needs-review".
router.get("/registrations/needs-review", async (req, res, next) => {
  try {
    const result = await db.query(
      `SELECT id, name, email,
              (SELECT COUNT(*) FROM dealer_reupload_tokens
               WHERE registration_id = dr.id AND used = 1) AS reupload_count
       FROM dealer_registrations dr
       WHERE status = 'Pending' AND needs_review_after_reupload = 1
       ORDER BY submitted_at DESC`
    );
    res.json({ success: true, registrations: result.rows });
  } catch (err) { next(err); }
});

// ─── GET /api/dealers/registrations ──────────────────────
// List dealer registration applications
router.get("/registrations", async (req, res, next) => {
  try {
    const { status = "Pending" } = req.query;

    // Shared reupload token JOIN fragment — used for ReuploadRequested and All
    const reuploadJoin = `
      LEFT JOIN dealer_reupload_tokens rt
        ON rt.registration_id = dr.id
        AND rt.id = (
          SELECT id FROM dealer_reupload_tokens
          WHERE registration_id = dr.id
          ORDER BY created_at DESC LIMIT 1
        )`;

    const reuploadSelect = `,
           rt.reason        AS reupload_reason,
           rt.required_docs AS reupload_required_docs,
           rt.created_at    AS reupload_requested_at,
           rt.expires_at    AS reupload_expires_at,
           rt.used          AS reupload_used`;

    // Subquery that counts how many times a dealer has successfully re-uploaded
    // (used=1 means dealer clicked the link and submitted new docs)
    const reuploadCountSelect = `,
           (SELECT COUNT(*) FROM dealer_reupload_tokens
            WHERE registration_id = dr.id AND used = 1) AS reupload_count`;

    let registrationsQuery;

    if (status === "All") {
      // Return ALL registrations — no status filter
      // JOIN latest token for context + count of completed re-uploads
      registrationsQuery = await db.query(
        `SELECT dr.*, u.name AS reviewed_by_name${reuploadSelect}${reuploadCountSelect}
         FROM dealer_registrations dr
         LEFT JOIN users u ON u.id = dr.reviewed_by
         ${reuploadJoin}
         ORDER BY dr.submitted_at DESC`
      );
    } else if (status === "ReuploadRequested") {
      // Filter to ReuploadRequested + JOIN reupload tokens for context
      registrationsQuery = await db.query(
        `SELECT dr.*, u.name AS reviewed_by_name${reuploadSelect}${reuploadCountSelect}
         FROM dealer_registrations dr
         LEFT JOIN users u ON u.id = dr.reviewed_by
         ${reuploadJoin}
         WHERE dr.status = ?
         ORDER BY dr.submitted_at DESC`,
        [status]
      );
    } else if (status === "Pending") {
      // For Pending, include reupload_count + needs_review_after_reupload so we can
      // show the "Re-uploaded" badge for registrations that went through the re-upload flow
      registrationsQuery = await db.query(
        `SELECT dr.*, u.name AS reviewed_by_name${reuploadCountSelect},
                dr.needs_review_after_reupload
         FROM dealer_registrations dr
         LEFT JOIN users u ON u.id = dr.reviewed_by
         WHERE dr.status = ?
         ORDER BY dr.submitted_at DESC`,
        [status]
      );
    } else {
      // Approved, Rejected — simple filter, no extra join needed
      registrationsQuery = await db.query(
        `SELECT dr.*, u.name AS reviewed_by_name
         FROM dealer_registrations dr
         LEFT JOIN users u ON u.id = dr.reviewed_by
         WHERE dr.status = ?
         ORDER BY dr.submitted_at DESC`,
        [status]
      );
    }

    const registrations = registrationsQuery.rows;

    if (registrations.length > 0) {
      const regIds = registrations.map(r => r.id);
      // MySQL IN clause with dynamic placeholders
      const placeholders = regIds.map(() => "?").join(", ");
      const docsResult = await db.query(
        `SELECT id, entity_id, doc_type, original_name, mime_type, file_size_bytes, file_path
         FROM documents
         WHERE entity_type = 'dealer_registration' AND entity_id IN (${placeholders})`,
        regIds
      );

      // Group documents by entity_id
      const docsMap = {};
      docsResult.rows.forEach(doc => {
        if (!docsMap[doc.entity_id]) {
          docsMap[doc.entity_id] = [];
        }
        docsMap[doc.entity_id].push(doc);
      });

      // Attach documents to registrations
      registrations.forEach(r => {
        r.documents = docsMap[r.id] || [];
      });
    }

    res.json({
      success: true,
      count: registrations.length,
      registrations: registrations,
    });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/dealers/registrations/:id/approve ─────────
// Approve a dealer registration → create user account
router.post("/registrations/:id/approve", async (req, res, next) => {
  try {
    const regId = parseInt(req.params.id, 10);

    if (isNaN(regId)) {
      return res.status(400).json({ success: false, error: "Invalid registration ID." });
    }

    // Get the registration
    const regResult = await db.query(
      "SELECT * FROM dealer_registrations WHERE id = ? AND status = 'Pending'",
      [regId]
    );

    if (regResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Registration not found or already processed.",
      });
    }

    const reg = regResult.rows[0];

    // Check if email already exists in users
    const existingUser = await db.query("SELECT id FROM users WHERE email = ?", [reg.email]);
    if (existingUser.rows.length > 0) {
      return res.status(409).json({
        success: false,
        error: "A user with this email already exists.",
      });
    }

    // Transaction: create user + update registration status + reassign documents
    const client = await db.getClient();
    let newUserId = null;
    try {
      await client.query("BEGIN");

      // Create user account
      const userInsert = await client.query(
        `INSERT INTO users (name, email, password_hash, role, mobile, location, company_name, password_changed_at)
         VALUES (?, ?, ?, 'dealer', ?, ?, ?, '1970-01-01 00:00:01')`,
        [reg.name, reg.email, reg.password_hash, reg.mobile, reg.location, reg.company_name]
      );
      newUserId = userInsert.insertId;

      // Update registration status
      await client.query(
        `UPDATE dealer_registrations SET status = 'Approved', reviewed_by = ?, reviewed_at = NOW()
         WHERE id = ?`,
        [req.user.id, regId]
      );

      // Reassign all registration documents to the new user.
      // Documents are saved with uploaded_by = NULL at registration time
      // (no user account exists yet). After approval, the dealer must be able
      // to access their own submitted documents via GET /api/uploads/:id.
      // The access check is: req.user.role !== 'admin' && doc.uploaded_by !== req.user.id
      // Without this UPDATE, null !== newUserId → dealer gets 403 on their own docs.
      await client.query(
        `UPDATE documents SET uploaded_by = ?
         WHERE entity_type = 'dealer_registration' AND entity_id = ? AND uploaded_by IS NULL`,
        [newUserId, regId]
      );

      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }

    // Clear the review flag — admin has taken action
    await db.query(
      "UPDATE dealer_registrations SET needs_review_after_reupload = 0 WHERE id = ?",
      [regId]
    );

    // Fetch created user for response
    const userResult = await db.query(
      "SELECT id, name, email, role FROM users WHERE id = ?",
      [newUserId]
    );

    res.json({
      success: true,
      message: `Dealer '${reg.name}' approved and account created.`,
      dealer: userResult.rows[0],
    });

    // Fire-and-forget email notification
    sendDealerStatusEmail(reg.email, reg.name, "Approved")
      .catch(err => console.error(`[EMAIL] Failed to send dealer Approved email to ${reg.email}:`, err.message));
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/dealers/registrations/:id/reject ──────────
// Reject a dealer registration — accepts optional { reason } in request body
router.post("/registrations/:id/reject", async (req, res, next) => {
  try {
    const regId = parseInt(req.params.id, 10);

    if (isNaN(regId)) {
      return res.status(400).json({ success: false, error: "Invalid registration ID." });
    }

    const { reason } = req.body;

    if (!reason || !reason.trim()) {
      return res.status(400).json({ success: false, error: "A reason for rejection is required." });
    }

    // Fetch registration before update (for email and response)
    // Allow rejection from both Pending AND ReuploadRequested states:
    // admin may finally reject after a dealer fails to re-upload satisfactory docs.
    const findResult = await db.query(
      "SELECT id, name, email, status FROM dealer_registrations WHERE id = ? AND status IN ('Pending', 'ReuploadRequested')",
      [regId]
    );

    if (findResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Registration not found or is not in a state that allows rejection.",
      });
    }

    const reg = findResult.rows[0];

    await db.query(
      `UPDATE dealer_registrations
         SET status = 'Rejected', reviewed_by = ?, reviewed_at = NOW(), rejection_reason = ?
       WHERE id = ? AND status IN ('Pending', 'ReuploadRequested')`,
      [req.user.id, reason.trim(), regId]
    );

    // If rejecting a ReuploadRequested registration, also invalidate any active re-upload tokens
    await db.query(
      "UPDATE dealer_reupload_tokens SET used = 1 WHERE registration_id = ? AND used = 0",
      [regId]
    );

    // Clear the review flag — admin has taken action
    await db.query(
      "UPDATE dealer_registrations SET needs_review_after_reupload = 0 WHERE id = ?",
      [regId]
    );

    res.json({
      success: true,
      message: `Dealer registration for '${reg.name}' rejected.`,
    });

    // Fire-and-forget email — includes admin's reason
    sendDealerStatusEmail(reg.email, reg.name, "Rejected", reason.trim())
      .catch(err => console.error(`[EMAIL] Failed to send dealer Rejected email to ${reg.email}:`, err.message));

    console.log(`[AUDIT] Rejection: admin ID ${req.user.id} rejected registration ID ${regId} (${reg.email}). Reason: ${reason.trim()}`);
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/dealers ────────────────────────────────────
// List all dealers (approved users with role='dealer')
// Returns: standard dealer fields + last_login_at (IMP-6) + failed_attempts count (IMP-1)
router.get("/", async (req, res, next) => {
  try {
    const result = await db.query(
      `SELECT
         u.id, u.name, u.email, u.mobile, u.location, u.company_name, u.is_active, u.created_at,
         u.last_login_at,
         COALESCE((
           SELECT COUNT(*)
           FROM login_attempts la
           WHERE la.email = u.email
             AND la.succeeded = 0
             AND la.attempted_at >= DATE_SUB(NOW(), INTERVAL 30 MINUTE)
         ), 0) AS failed_attempts
       FROM users u
       WHERE u.role = 'dealer'
       ORDER BY u.name`
    );

    res.json({
      success: true,
      count: result.rows.length,
      dealers: result.rows,
    });
  } catch (err) {
    next(err);
  }
});

// ─── PATCH /api/dealers/:id/toggle-active ────────────────
// Activate/deactivate a dealer
// MySQL does NOT support NOT is_active in the same way — we read, flip, then write
router.patch("/:id/toggle-active", async (req, res, next) => {
  try {
    const dealerId = parseInt(req.params.id, 10);

    if (isNaN(dealerId)) {
      return res.status(400).json({ success: false, error: "Invalid dealer ID." });
    }

    // Fetch current state
    const findResult = await db.query(
      "SELECT id, name, email, is_active FROM users WHERE id = ? AND role = 'dealer'",
      [dealerId]
    );

    if (findResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: "Dealer not found." });
    }

    const dealer = findResult.rows[0];
    const newActiveState = dealer.is_active ? 0 : 1;

    await db.query(
      "UPDATE users SET is_active = ? WHERE id = ?",
      [newActiveState, dealerId]
    );

    res.json({
      success: true,
      message: `Dealer '${dealer.name}' ${newActiveState ? "activated" : "deactivated"}.`,
      dealer: {
        id: dealer.id,
        name: dealer.name,
        email: dealer.email,
        is_active: newActiveState === 1,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/dealers/registrations/:id/request-reupload ────
// Admin only — Request dealer to re-upload documents.
// Allowed from both Pending and Rejected statuses.
router.post("/registrations/:id/request-reupload", async (req, res, next) => {
  try {
    const regId = parseInt(req.params.id, 10);

    if (isNaN(regId)) {
      return res.status(400).json({ success: false, error: "Invalid registration ID." });
    }

    const { reason, documents } = req.body;

    if (!reason || !reason.trim()) {
      return res.status(400).json({ success: false, error: "A reason for re-upload is required." });
    }

    if (!documents || !Array.isArray(documents) || documents.length === 0) {
      return res.status(400).json({ success: false, error: "At least one document type must be selected." });
    }

    const allowedDocTypes = ["aadhaar", "pan", "passport_photo", "other"];
    const invalidDocs = documents.filter(d => !allowedDocTypes.includes(d));
    if (invalidDocs.length > 0) {
      return res.status(400).json({ success: false, error: `Invalid document types: ${invalidDocs.join(", ")}` });
    }

    // Fetch the registration — must be Pending, Rejected, or ReuploadRequested
    // ReuploadRequested is allowed so admin can "Send Again" when the link has expired
    // or the dealer reports not receiving it.
    const regResult = await db.query(
      "SELECT id, name, email, status FROM dealer_registrations WHERE id = ? AND status IN ('Pending', 'Rejected', 'ReuploadRequested')",
      [regId]
    );

    if (regResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Registration not found or is not in a state that allows re-upload requests.",
      });
    }

    const reg = regResult.rows[0];

    // Invalidate any existing unused re-upload tokens for this registration
    await db.query(
      "UPDATE dealer_reupload_tokens SET used = 1 WHERE registration_id = ? AND used = 0",
      [regId]
    );

    // Generate a secure random token (raw token goes in email, hash goes in DB)
    const rawToken = crypto.randomBytes(32).toString("hex");
    const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
    const requiredDocsStr = documents.join(",");

    // Store token in DB with 72-hour expiry (3 days)
    await db.query(
      `INSERT INTO dealer_reupload_tokens (registration_id, token, reason, required_docs, expires_at)
       VALUES (?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL 72 HOUR))`,
      [regId, tokenHash, reason.trim(), requiredDocsStr]
    );

    // Update registration status to ReuploadRequested and clear the review flag.
    // Admin has seen the re-uploaded docs and decided they're insufficient —
    // needs_review_after_reupload should be cleared so banners don't show stale state.
    await db.query(
      "UPDATE dealer_registrations SET status = 'ReuploadRequested', needs_review_after_reupload = 0, reviewed_by = ?, reviewed_at = NOW() WHERE id = ?",
      [req.user.id, regId]
    );

    // Build re-upload URL and send email (fire-and-forget)
    const reuploadUrl = `${env.clientUrl}?reupload=${rawToken}`;
    sendDocumentReuploadEmail(reg.email, reg.name, reuploadUrl, reason.trim(), documents)
      .catch(err => console.error(`[EMAIL] Failed to send re-upload email to ${reg.email}:`, err.message));

    console.log(`[AUDIT] Re-upload requested: admin ID ${req.user.id} requested re-upload for registration ID ${regId} (${reg.email})`);

    res.json({
      success: true,
      message: `Re-upload request sent to ${reg.name} (${reg.email}).`,
    });
  } catch (err) {
    next(err);
  }
});

// ─── DELETE /api/dealers/:id/login-attempts ──────────────
// Admin only — Unlock a dealer account locked by too many failed login attempts.
// Clears all recent failed login_attempts for the given email so the next
// login attempt is treated as fresh (bypassing the 30-minute lockout window).
//
// Use case: A legitimate dealer accidentally locks their account and contacts
// support. The admin can unlock it immediately without waiting 30 minutes.
router.delete("/:id/login-attempts", async (req, res, next) => {
  try {
    const dealerId = parseInt(req.params.id, 10);
    if (isNaN(dealerId)) {
      return res.status(400).json({ success: false, error: "Invalid dealer ID." });
    }

    // Fetch dealer email — needed to clear login_attempts (keyed by email)
    const result = await db.query(
      "SELECT id, name, email FROM users WHERE id = ? AND role = 'dealer'",
      [dealerId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: "Dealer not found." });
    }

    const dealer = result.rows[0];

    // Delete all failed login attempts for this email (clears the lockout)
    const deleteResult = await db.query(
      "DELETE FROM login_attempts WHERE email = ? AND succeeded = 0",
      [dealer.email]
    );

    const cleared = deleteResult.affectedRows ?? 0;

    console.log(`[AUDIT] Account unlocked: admin ID ${req.user.id} (${req.user.email}) cleared ${cleared} failed login attempt(s) for dealer ${dealer.email} at ${new Date().toISOString()}`);

    res.json({
      success: true,
      message: `Account unlocked for ${dealer.name}. ${cleared} failed attempt(s) cleared.`,
      cleared,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
