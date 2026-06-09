import { Router } from "express";
import Joi from "joi";

import db from "../config/database.js";
import { authenticate, authorize } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { broadcastToRole, broadcastToUser } from "../utils/sseManager.js";

const router = Router();

router.use(authenticate);

// ─── Validation Schemas ──────────────────────────────────
const customerSchema = Joi.object({
  name: Joi.string().required().trim().min(2).max(255),
  phone: Joi.string().allow("", null).pattern(/^\d{10}$/)
    .messages({ "string.pattern.base": "Please enter a valid 10-digit phone number" }),
  email: Joi.string().email().allow("", null).lowercase().trim(),
  city: Joi.string().allow("", null).trim().max(255),
  address: Joi.string().allow("", null).trim().max(1000),
  status: Joi.string().valid("Lead", "Quoted", "Approved", "Installed", "Follow-up").default("Lead"),
  notes: Joi.string().allow("", null).trim().max(2000),
});

// ─── GET /api/customers ──────────────────────────────────
// List customers — admin sees all, dealer sees own only
router.get("/", async (req, res, next) => {
  try {
    const { status, search, page = 1, limit = 20 } = req.query;
    const offset = (parseInt(page, 10) - 1) * parseInt(limit, 10);

    let whereClause = "";
    const params = [];

    // Role-based filtering
    if (req.user.role === "dealer") {
      whereClause += " AND c.created_by = ?";
      params.push(req.user.id);
    }

    if (status) {
      whereClause += " AND c.status = ?";
      params.push(status);
    }

    if (search) {
      // MySQL LIKE is case-insensitive with utf8mb4_unicode_ci (equivalent to ILIKE)
      whereClause += " AND (c.name LIKE ? OR c.phone LIKE ? OR c.city LIKE ?)";
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    // Count
    const countResult = await db.query(
      `SELECT COUNT(*) as total FROM customers c WHERE 1=1 ${whereClause}`,
      params
    );
    const total = parseInt(countResult.rows[0].total, 10);

    // Fetch with creator name — LIMIT/OFFSET appended separately
    const dataResult = await db.query(
      `SELECT c.*, u.name as created_by_name
       FROM customers c
       JOIN users u ON u.id = c.created_by
       WHERE 1=1 ${whereClause}
       ORDER BY c.updated_at DESC
       LIMIT ? OFFSET ?`,
      [...params, parseInt(limit, 10), offset]
    );

    res.json({
      success: true,
      customers: dataResult.rows,
      pagination: {
        total,
        page: parseInt(page, 10),
        limit: parseInt(limit, 10),
        totalPages: Math.ceil(total / parseInt(limit, 10)),
      },
    });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/customers ─────────────────────────────────
// Create a new customer
router.post("/", validate(customerSchema), async (req, res, next) => {
  try {
    const { name, phone, email, city, address, status, notes } = req.body;

    const insertResult = await db.query(
      `INSERT INTO customers (name, phone, email, city, address, status, notes, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [name, phone || null, email || null, city || null, address || null, status, notes || null, req.user.id]
    );

    // Fetch the inserted row
    const result = await db.query(
      "SELECT * FROM customers WHERE id = ?",
      [insertResult.insertId]
    );

    res.status(201).json({
      success: true,
      message: `Customer '${name}' added.`,
      customer: result.rows[0],
    });

    // Notify admin and the creating dealer that a new customer was added
    broadcastToRole("admin", "customer:changed", { action: "created", id: insertResult.insertId });
    broadcastToUser(req.user.id, "customer:changed", { action: "created", id: insertResult.insertId });
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/customers/:id ──────────────────────────────
// Get single customer with quotation history
router.get("/:id", async (req, res, next) => {
  try {
    const customerId = parseInt(req.params.id, 10);

    if (isNaN(customerId)) {
      return res.status(400).json({ success: false, error: "Invalid customer ID." });
    }

    const result = await db.query(
      `SELECT c.*, u.name as created_by_name
       FROM customers c
       JOIN users u ON u.id = c.created_by
       WHERE c.id = ?`,
      [customerId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: "Customer not found." });
    }

    const customer = result.rows[0];

    // Access control
    if (req.user.role === "dealer" && customer.created_by !== req.user.id) {
      return res.status(403).json({ success: false, error: "Access denied." });
    }

    // Get quotations for this customer
    const quotations = await db.query(
      `SELECT id, quotation_number, system_kw, total, effective_price, status, created_at
       FROM quotations WHERE customer_id = ? ORDER BY created_at DESC`,
      [customerId]
    );

    res.json({
      success: true,
      customer,
      quotations: quotations.rows,
    });
  } catch (err) {
    next(err);
  }
});

// ─── PUT /api/customers/:id ──────────────────────────────
// Update customer
router.put("/:id", validate(customerSchema), async (req, res, next) => {
  try {
    const customerId = parseInt(req.params.id, 10);
    const { name, phone, email, city, address, status, notes } = req.body;

    if (isNaN(customerId)) {
      return res.status(400).json({ success: false, error: "Invalid customer ID." });
    }

    // Check ownership
    const existing = await db.query("SELECT created_by FROM customers WHERE id = ?", [customerId]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ success: false, error: "Customer not found." });
    }
    if (req.user.role === "dealer" && existing.rows[0].created_by !== req.user.id) {
      return res.status(403).json({ success: false, error: "You can only edit your own customers." });
    }

    await db.query(
      `UPDATE customers SET name=?, phone=?, email=?, city=?, address=?, status=?, notes=?
       WHERE id = ?`,
      [name, phone || null, email || null, city || null, address || null, status, notes || null, customerId]
    );

    // Fetch updated row
    const result = await db.query("SELECT * FROM customers WHERE id = ?", [customerId]);

    res.json({
      success: true,
      message: `Customer '${name}' updated.`,
      customer: result.rows[0],
    });

    // Notify admin and the creating dealer that a customer was updated
    broadcastToRole("admin", "customer:changed", { action: "updated", id: customerId });
    broadcastToUser(existing.rows[0].created_by, "customer:changed", { action: "updated", id: customerId });
  } catch (err) {
    next(err);
  }
});

// ─── DELETE /api/customers/:id ───────────────────────────
// Delete customer (admin only)
router.delete("/:id", authorize("admin"), async (req, res, next) => {
  try {
    const customerId = parseInt(req.params.id, 10);

    if (isNaN(customerId)) {
      return res.status(400).json({ success: false, error: "Invalid customer ID." });
    }

    // Guard: prevent deleting customers with existing quotations
    const quotationCheck = await db.query(
      "SELECT COUNT(*) as count FROM quotations WHERE customer_id = ?",
      [customerId]
    );
    const count = parseInt(quotationCheck.rows[0].count, 10);
    if (count > 0) {
      return res.status(400).json({
        success: false,
        error: `Cannot delete this customer — they have ${count} linked quotation(s). Remove or reassign quotations first.`,
      });
    }

    // Fetch name and creator before deletion (for response + SSE targeting)
    const findResult = await db.query(
      "SELECT name, created_by FROM customers WHERE id = ?",
      [customerId]
    );

    if (findResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: "Customer not found." });
    }

    const { name: customerName, created_by: ownerId } = findResult.rows[0];

    await db.query("DELETE FROM customers WHERE id = ?", [customerId]);

    res.json({
      success: true,
      message: `Customer '${customerName}' deleted.`,
    });

    // Notify all admins that a customer was removed
    broadcastToRole("admin", "customer:changed", { action: "deleted", id: customerId });
    // Notify the dealer who created this customer so their CustomerManager refreshes
    if (ownerId) {
      broadcastToUser(ownerId, "customer:changed", { action: "deleted", id: customerId });
    }
  } catch (err) {
    next(err);
  }

});

export default router;
