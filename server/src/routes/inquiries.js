import { Router } from "express";
import Joi from "joi";

import db from "../config/database.js";
import { authenticate } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";

const router = Router();

router.use(authenticate);

// ─── Validation Schemas ──────────────────────────────────
const inquirySchema = Joi.object({
  name: Joi.string().required().trim().min(2).max(255),
  location: Joi.string().required().trim().min(2).max(255),
  remark: Joi.string().allow("", null).trim().max(1000),
  status: Joi.string().valid("New", "Followed Up", "Quoted", "Closed").default("New"),
});

const followupSchema = Joi.object({
  notes: Joi.string().required().trim().min(2).max(1000),
});

const statusSchema = Joi.object({
  status: Joi.string().valid("New", "Followed Up", "Quoted", "Closed").required(),
});

// ─── GET /api/inquiries ──────────────────────────────────
// List inquiries — admin sees all, dealer sees own only
router.get("/", async (req, res, next) => {
  try {
    const { status, search } = req.query;

    let whereClause = "";
    const params = [];

    // Role-based filtering
    if (req.user.role === "dealer") {
      whereClause += " AND created_by = ?";
      params.push(req.user.id);
    }

    if (status) {
      whereClause += " AND status = ?";
      params.push(status);
    }

    if (search) {
      // MySQL LIKE is case-insensitive with utf8mb4_unicode_ci (equivalent to ILIKE)
      whereClause += " AND (name LIKE ? OR location LIKE ? OR remark LIKE ?)";
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    // Pagination
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 50));
    const offset = (page - 1) * limit;

    // Count total for pagination
    const countResult = await db.query(
      `SELECT COUNT(*) as total
       FROM inquiries i
       WHERE 1=1 ${whereClause}`,
      params
    );
    const total = parseInt(countResult.rows[0].total, 10);

    // Fetch inquiries with creator name
    const result = await db.query(
      `SELECT i.*, u.name as created_by_name
       FROM inquiries i
       JOIN users u ON u.id = i.created_by
       WHERE 1=1 ${whereClause}
       ORDER BY i.updated_at DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    res.json({
      success: true,
      inquiries: result.rows,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/inquiries ─────────────────────────────────
// Create a new inquiry
router.post("/", validate(inquirySchema), async (req, res, next) => {
  try {
    const { name, location, remark, status } = req.body;

    const insertResult = await db.query(
      `INSERT INTO inquiries (name, location, remark, status, created_by)
       VALUES (?, ?, ?, ?, ?)`,
      [name, location, remark || null, status || "New", req.user.id]
    );

    // Fetch inserted row
    const result = await db.query(
      "SELECT * FROM inquiries WHERE id = ?",
      [insertResult.insertId]
    );

    res.status(201).json({
      success: true,
      message: `Inquiry for '${name}' added successfully.`,
      inquiry: result.rows[0],
    });
  } catch (err) {
    next(err);
  }
});

// ─── PUT /api/inquiries/:id ──────────────────────────────
// Update inquiry details
router.put("/:id", validate(inquirySchema), async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { name, location, remark, status } = req.body;

    if (isNaN(id)) {
      return res.status(400).json({ success: false, error: "Invalid inquiry ID." });
    }

    // Check ownership
    const existing = await db.query("SELECT created_by FROM inquiries WHERE id = ?", [id]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ success: false, error: "Inquiry not found." });
    }
    if (req.user.role === "dealer" && existing.rows[0].created_by !== req.user.id) {
      return res.status(403).json({ success: false, error: "You can only edit your own inquiries." });
    }

    await db.query(
      `UPDATE inquiries
       SET name = ?, location = ?, remark = ?, status = ?
       WHERE id = ?`,
      [name, location, remark || null, status, id]
    );

    // Fetch updated row
    const result = await db.query("SELECT * FROM inquiries WHERE id = ?", [id]);

    res.json({
      success: true,
      message: `Inquiry for '${name}' updated successfully.`,
      inquiry: result.rows[0],
    });
  } catch (err) {
    next(err);
  }
});

// ─── PATCH /api/inquiries/:id/status ──────────────────────
// Update inquiry status quickly
router.patch("/:id/status", validate(statusSchema), async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { status } = req.body;

    if (isNaN(id)) {
      return res.status(400).json({ success: false, error: "Invalid inquiry ID." });
    }

    // Check ownership
    const existing = await db.query("SELECT created_by FROM inquiries WHERE id = ?", [id]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ success: false, error: "Inquiry not found." });
    }
    if (req.user.role === "dealer" && existing.rows[0].created_by !== req.user.id) {
      return res.status(403).json({ success: false, error: "You can only update your own inquiries." });
    }

    await db.query(
      "UPDATE inquiries SET status = ? WHERE id = ?",
      [status, id]
    );

    // Fetch updated row
    const result = await db.query("SELECT * FROM inquiries WHERE id = ?", [id]);

    res.json({
      success: true,
      message: "Status updated.",
      inquiry: result.rows[0],
    });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/inquiries/:id/followups ────────────────────
// Log a follow-up action for an inquiry
router.post("/:id/followups", validate(followupSchema), async (req, res, next) => {
  const client = await db.getClient();
  try {
    const id = parseInt(req.params.id, 10);
    const { notes } = req.body;

    if (isNaN(id)) {
      return res.status(400).json({ success: false, error: "Invalid inquiry ID." });
    }

    // Start transaction
    await client.query("BEGIN");

    // Check existence and ownership
    const existing = await client.query("SELECT created_by, status FROM inquiries WHERE id = ?", [id]);
    if (existing.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ success: false, error: "Inquiry not found." });
    }
    if (req.user.role === "dealer" && existing.rows[0].created_by !== req.user.id) {
      await client.query("ROLLBACK");
      return res.status(403).json({ success: false, error: "Access denied." });
    }

    // Insert follow-up entry
    const followupInsert = await client.query(
      `INSERT INTO inquiry_followups (inquiry_id, notes)
       VALUES (?, ?)`,
      [id, notes]
    );

    // Fetch inserted followup
    const followupResult = await client.query(
      "SELECT * FROM inquiry_followups WHERE id = ?",
      [followupInsert.insertId]
    );

    // Update status to 'Followed Up' if it was 'New'
    let newStatus = existing.rows[0].status;
    if (newStatus === "New") {
      newStatus = "Followed Up";
    }

    // Update inquiry details with last follow-up info
    await client.query(
      `UPDATE inquiries
       SET last_followup_date = NOW(), last_followup_notes = ?, status = ?
       WHERE id = ?`,
      [notes, newStatus, id]
    );

    // Fetch updated inquiry
    const inquiryResult = await client.query(
      "SELECT * FROM inquiries WHERE id = ?",
      [id]
    );

    await client.query("COMMIT");

    res.status(201).json({
      success: true,
      message: "Follow-up logged successfully.",
      followup: followupResult.rows[0],
      inquiry: inquiryResult.rows[0],
    });
  } catch (err) {
    await client.query("ROLLBACK");
    next(err);
  } finally {
    client.release();
  }
});

// ─── GET /api/inquiries/:id/followups ─────────────────────
// Retrieve all follow-up timeline entries for a specific inquiry
router.get("/:id/followups", async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);

    if (isNaN(id)) {
      return res.status(400).json({ success: false, error: "Invalid inquiry ID." });
    }

    // Check existence and ownership
    const existing = await db.query("SELECT created_by FROM inquiries WHERE id = ?", [id]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ success: false, error: "Inquiry not found." });
    }
    if (req.user.role === "dealer" && existing.rows[0].created_by !== req.user.id) {
      return res.status(403).json({ success: false, error: "Access denied." });
    }

    const result = await db.query(
      `SELECT * FROM inquiry_followups
       WHERE inquiry_id = ?
       ORDER BY followup_date DESC`,
      [id]
    );

    res.json({
      success: true,
      followups: result.rows,
    });
  } catch (err) {
    next(err);
  }
});

// ─── DELETE /api/inquiries/:id ───────────────────────────
// Delete inquiry
router.delete("/:id", async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);

    if (isNaN(id)) {
      return res.status(400).json({ success: false, error: "Invalid inquiry ID." });
    }

    // Check existence and ownership
    const existing = await db.query("SELECT created_by, name FROM inquiries WHERE id = ?", [id]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ success: false, error: "Inquiry not found." });
    }
    if (req.user.role === "dealer" && existing.rows[0].created_by !== req.user.id) {
      return res.status(403).json({ success: false, error: "You can only delete your own inquiries." });
    }

    await db.query("DELETE FROM inquiries WHERE id = ?", [id]);

    res.json({
      success: true,
      message: `Inquiry for '${existing.rows[0].name}' deleted.`,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
