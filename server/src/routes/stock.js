/**
 * Stock Routes — /api/stock
 * ─────────────────────────────────────────────────────────────────────────────
 * All routes require authenticate + authorize("admin").
 *
 * Architecture: Transaction-based ledger
 *   - Every quantity change (add / deduct / adjust) is recorded in stock_transactions
 *   - stock_items.quantity is a cached running balance kept in sync atomically
 *   - Opening / closing are computed from balance_after lookups (O(log N), indexed)
 *   - Price changes are direct updates (not transaction-based)
 *
 * Route map:
 *   GET  /                     — fetch all stock items (with panel/inverter sync)
 *   GET  /daily                — daily report, single day or date range
 *   GET  /transactions         — ledger summary per item for a date range
 *   GET  /transactions/:itemId — paginated transaction history for one item
 *   POST /                     — add a new stock item
 *   POST /:id/add              — add stock movement (qty in)
 *   POST /:id/deduct           — deduct stock movement (qty out)
 *   POST /:id/adjust           — override to exact quantity (physical count)
 *   PATCH /:id                 — update unit price only
 *   DELETE /:id                — remove a stock item
 */

import { Router } from "express";
import Joi from "joi";

import db from "../config/database.js";
import { authenticate, authorize } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { broadcastToRole } from "../utils/sseManager.js";

const router = Router();

// All stock routes require authentication + admin role
router.use(authenticate);
router.use(authorize("admin"));


// ─── Helper: Get current date string in IST (YYYY-MM-DD) ─────────────────────
// Uses Intl.DateTimeFormat with Asia/Kolkata timezone for reliable IST conversion.
// 'en-CA' locale produces YYYY-MM-DD format natively — no manual parsing needed.
function getISTDateString(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(date);
}

// ─── Helper: Validate a YYYY-MM-DD date string, reject future dates ───────────
function validateDateParam(dateStr, fieldName = "date") {
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateStr || !dateRegex.test(dateStr)) {
    return `${fieldName} must be a valid date in YYYY-MM-DD format.`;
  }
  if (dateStr > getISTDateString()) {
    return `${fieldName} cannot be in the future.`;
  }
  return null; // valid
}

// ─── Helper: Compute the "day after" an IST date string ──────────────────────
// Used to create the upper boundary for end-of-day queries.
// e.g., "2024-09-24" → "2024-09-25"
function nextISTDay(dateStr) {
  const d = new Date(dateStr + "T00:00:00+05:30");
  d.setDate(d.getDate() + 1);
  return getISTDateString(d);
}


// ═══════════════════════════════════════════════════════════════════════════════
// GET /api/stock
// Fetch all stock items. Auto-syncs active panels and inverters into stock_items.
// ═══════════════════════════════════════════════════════════════════════════════
router.get("/", async (req, res, next) => {
  try {
    // Sync active panels → INSERT IGNORE ensures no duplicates and no quantity reset
    await db.query(
      `INSERT IGNORE INTO stock_items (category, item_name, quantity, unit)
       SELECT 'Panel',
              CONCAT(brand, ' ', watt, 'W ', type),
              0,
              'pcs'
       FROM panels
       WHERE is_active = 1`
    );

    // Sync active inverters
    await db.query(
      `INSERT IGNORE INTO stock_items (category, item_name, quantity, unit)
       SELECT 'Inverter',
              CONCAT(
                brand, ' ',
                TRIM(TRAILING '.' FROM TRIM(TRAILING '0' FROM CAST(kw AS CHAR))),
                'kW ', type
              ),
              0,
              'pcs'
       FROM inverters
       WHERE is_active = 1`
    );

    const result = await db.query(
      "SELECT * FROM stock_items ORDER BY category, item_name"
    );

    // Group by category for frontend convenience
    const grouped = {};
    for (const item of result.rows) {
      if (!grouped[item.category]) grouped[item.category] = [];
      grouped[item.category].push(item);
    }

    res.json({
      success: true,
      count: result.rows.length,
      stock: result.rows,
      grouped,
    });
  } catch (err) {
    next(err);
  }
});


// ═══════════════════════════════════════════════════════════════════════════════
// GET /api/stock/transactions
// Ledger summary: one row per stock item, aggregated for a date range.
// Returns opening/closing balance + totals for add/deduct movements.
// MUST be defined before /:id routes to avoid Express matching "transactions" as an ID.
// ═══════════════════════════════════════════════════════════════════════════════
router.get("/transactions", async (req, res, next) => {
  try {
    const { from, to } = req.query;
    const today = getISTDateString();

    if (!from || !to) {
      return res.status(400).json({
        success: false,
        error: "Both 'from' and 'to' date parameters are required.",
      });
    }

    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(from) || !dateRegex.test(to)) {
      return res.status(400).json({
        success: false,
        error: "Dates must be in YYYY-MM-DD format.",
      });
    }
    if (from > today || to > today) {
      return res.status(400).json({
        success: false,
        error: "Cannot query future dates.",
      });
    }
    if (from > to) {
      return res.status(400).json({
        success: false,
        error: "'from' date must be on or before 'to' date.",
      });
    }

    const toPlusOne = nextISTDay(to);

    const result = await db.query(
      `SELECT
         si.id,
         si.item_name,
         si.category,
         si.unit,
         si.quantity  AS live_quantity,

         -- Opening: last balance_after BEFORE start of 'from' day in IST
         COALESCE(
           (SELECT balance_after FROM stock_transactions
            WHERE stock_item_id = si.id
              AND created_at < CONVERT_TZ(CONCAT(?, ' 00:00:00'), '+05:30', '+00:00')
            ORDER BY created_at DESC LIMIT 1),
           0
         ) AS opening_balance,

         -- Closing: last balance_after BEFORE start of day-after-'to' (= end of 'to' day)
         COALESCE(
           (SELECT balance_after FROM stock_transactions
            WHERE stock_item_id = si.id
              AND created_at < CONVERT_TZ(CONCAT(?, ' 00:00:00'), '+05:30', '+00:00')
            ORDER BY created_at DESC LIMIT 1),
           0
         ) AS closing_balance,

         -- Movements in the date range. 'initial' is included in total_added so that
         -- the accounting equation holds: Opening + Added - Used = Closing.
         -- If 'initial' falls BEFORE the queried period it is in the opening balance
         -- and never appears in the JOIN — so counting it here has no double-count risk.
         COALESCE(SUM(CASE WHEN stx.transaction_type IN ('add','initial') THEN stx.quantity ELSE 0 END), 0) AS total_added,
         COALESCE(SUM(CASE WHEN stx.transaction_type = 'deduct'           THEN stx.quantity ELSE 0 END), 0) AS total_used,
         COUNT(CASE WHEN stx.transaction_type IN ('add','deduct','adjustment','initial') THEN 1 END)         AS movement_count

       FROM stock_items si
       LEFT JOIN stock_transactions stx
         ON  stx.stock_item_id = si.id
         AND stx.created_at >= CONVERT_TZ(CONCAT(?, ' 00:00:00'), '+05:30', '+00:00')
         AND stx.created_at <  CONVERT_TZ(CONCAT(?, ' 00:00:00'), '+05:30', '+00:00')

       GROUP BY si.id, si.item_name, si.category, si.unit, si.quantity
       ORDER BY si.category, si.item_name`,
      [from, toPlusOne, from, toPlusOne]
    );

    res.json({
      success: true,
      data: result.rows,
      dateRange: { from, to },
    });
  } catch (err) {
    next(err);
  }
});


// ═══════════════════════════════════════════════════════════════════════════════
// GET /api/stock/transactions/:itemId
// Paginated transaction history for a single stock item (ledger drill-down).
// ═══════════════════════════════════════════════════════════════════════════════
router.get("/transactions/:itemId", async (req, res, next) => {
  try {
    const itemId = parseInt(req.params.itemId, 10);
    if (isNaN(itemId)) {
      return res.status(400).json({ success: false, error: "Invalid item ID." });
    }

    const today = getISTDateString();

    // Default: last 90 days
    const defaultFrom = getISTDateString(new Date(Date.now() - 90 * 24 * 60 * 60 * 1000));
    const from  = req.query.from  || defaultFrom;
    const to    = req.query.to    || today;
    const page  = Math.max(1, parseInt(req.query.page,  10) || 1);
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 50));
    const offset = (page - 1) * limit;

    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(from) || !dateRegex.test(to)) {
      return res.status(400).json({ success: false, error: "Dates must be in YYYY-MM-DD format." });
    }
    if (to > today) {
      return res.status(400).json({ success: false, error: "Cannot query future dates." });
    }
    if (from > to) {
      return res.status(400).json({ success: false, error: "'from' must be on or before 'to'." });
    }

    const toPlusOne = nextISTDay(to);

    // Verify item exists
    const itemResult = await db.query(
      "SELECT id, item_name, category, unit, quantity FROM stock_items WHERE id = ?",
      [itemId]
    );
    if (itemResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: "Stock item not found." });
    }
    const item = itemResult.rows[0];

    // Opening balance: last balance_after before start of 'from' day
    const openingResult = await db.query(
      `SELECT balance_after FROM stock_transactions
       WHERE stock_item_id = ?
         AND created_at < CONVERT_TZ(CONCAT(?, ' 00:00:00'), '+05:30', '+00:00')
       ORDER BY created_at DESC LIMIT 1`,
      [itemId, from]
    );
    const openingBalance = openingResult.rows.length > 0 ? openingResult.rows[0].balance_after : 0;

    // Closing balance: last balance_after before start of toPlusOne (= end of 'to' day)
    const closingResult = await db.query(
      `SELECT balance_after FROM stock_transactions
       WHERE stock_item_id = ?
         AND created_at < CONVERT_TZ(CONCAT(?, ' 00:00:00'), '+05:30', '+00:00')
       ORDER BY created_at DESC LIMIT 1`,
      [itemId, toPlusOne]
    );
    const closingBalance = closingResult.rows.length > 0 ? closingResult.rows[0].balance_after : 0;

    // Totals in range — 'initial' counted in total_added so Opening+Added-Used=Closing always holds
    const summaryResult = await db.query(
      `SELECT
         COALESCE(SUM(CASE WHEN transaction_type IN ('add','initial') THEN quantity ELSE 0 END), 0) AS total_added,
         COALESCE(SUM(CASE WHEN transaction_type = 'deduct'           THEN quantity ELSE 0 END), 0) AS total_used,
         COUNT(CASE WHEN transaction_type IN ('add','deduct','adjustment','initial') THEN 1 END)     AS movement_count
       FROM stock_transactions
       WHERE stock_item_id = ?
         AND created_at >= CONVERT_TZ(CONCAT(?, ' 00:00:00'), '+05:30', '+00:00')
         AND created_at <  CONVERT_TZ(CONCAT(?, ' 00:00:00'), '+05:30', '+00:00')`,
      [itemId, from, toPlusOne]
    );

    // Total count for pagination
    const countResult = await db.query(
      `SELECT COUNT(*) AS total FROM stock_transactions
       WHERE stock_item_id = ?
         AND created_at >= CONVERT_TZ(CONCAT(?, ' 00:00:00'), '+05:30', '+00:00')
         AND created_at <  CONVERT_TZ(CONCAT(?, ' 00:00:00'), '+05:30', '+00:00')`,
      [itemId, from, toPlusOne]
    );
    const total = countResult.rows[0].total;

    // Paginated transaction list with performer name
    const txResult = await db.query(
      `SELECT
         stx.id, stx.transaction_type, stx.quantity, stx.balance_after,
         stx.reason_category, stx.reason_note, stx.created_at,
         u.name AS performed_by_name
       FROM stock_transactions stx
       LEFT JOIN users u ON u.id = stx.performed_by
       WHERE stx.stock_item_id = ?
         AND stx.created_at >= CONVERT_TZ(CONCAT(?, ' 00:00:00'), '+05:30', '+00:00')
         AND stx.created_at <  CONVERT_TZ(CONCAT(?, ' 00:00:00'), '+05:30', '+00:00')
       ORDER BY stx.created_at DESC
       LIMIT ? OFFSET ?`,
      [itemId, from, toPlusOne, limit, offset]
    );

    const s = summaryResult.rows[0];
    res.json({
      success: true,
      item,
      summary: {
        openingBalance,
        closingBalance,
        totalAdded:    parseInt(s.total_added,     10),
        totalUsed:     parseInt(s.total_used,      10),
        movementCount: parseInt(s.movement_count,  10),
      },
      transactions: txResult.rows,
      pagination: {
        page,
        limit,
        total: parseInt(total, 10),
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
      dateRange: { from, to },
    });
  } catch (err) {
    next(err);
  }
});


// ═══════════════════════════════════════════════════════════════════════════════
// GET /api/stock/daily
// Daily report: opening/closing per item for a single day or date range.
// Computed from stock_transactions — no separate snapshots table needed.
// ═══════════════════════════════════════════════════════════════════════════════
router.get("/daily", async (req, res, next) => {
  try {
    const today = getISTDateString();
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

    let from, to;

    if (req.query.date) {
      // Single-day mode
      const err = validateDateParam(req.query.date, "date");
      if (err) return res.status(400).json({ success: false, error: err });
      from = req.query.date;
      to   = req.query.date;
    } else if (req.query.from || req.query.to) {
      // Date-range mode
      from = req.query.from || today;
      to   = req.query.to   || today;
      if (!dateRegex.test(from) || !dateRegex.test(to)) {
        return res.status(400).json({ success: false, error: "Dates must be in YYYY-MM-DD format." });
      }
      if (from > today || to > today) {
        return res.status(400).json({ success: false, error: "Cannot query future dates." });
      }
      if (from > to) {
        return res.status(400).json({ success: false, error: "'from' must be on or before 'to'." });
      }
    } else {
      // Default: today
      from = today;
      to   = today;
    }

    const toPlusOne = nextISTDay(to);

    const result = await db.query(
      `SELECT
         si.id          AS stock_item_id,
         si.category,
         si.item_name,
         si.unit,
         si.quantity    AS live_quantity,

         COALESCE(
           (SELECT balance_after FROM stock_transactions
            WHERE stock_item_id = si.id
              AND created_at < CONVERT_TZ(CONCAT(?, ' 00:00:00'), '+05:30', '+00:00')
            ORDER BY created_at DESC LIMIT 1),
           0
         ) AS opening_balance,

         COALESCE(
           (SELECT balance_after FROM stock_transactions
            WHERE stock_item_id = si.id
              AND created_at < CONVERT_TZ(CONCAT(?, ' 00:00:00'), '+05:30', '+00:00')
            ORDER BY created_at DESC LIMIT 1),
           0
         ) AS closing_balance,

         -- 'initial' counted in total_added so Opening + Added - Used = Closing always holds
         COALESCE(SUM(CASE WHEN stx.transaction_type IN ('add','initial') THEN stx.quantity ELSE 0 END), 0) AS total_added,
         COALESCE(SUM(CASE WHEN stx.transaction_type = 'deduct'           THEN stx.quantity ELSE 0 END), 0) AS total_used,
         COUNT(CASE WHEN stx.transaction_type IN ('add','deduct','adjustment','initial') THEN 1 END)         AS movement_count

       FROM stock_items si
       LEFT JOIN stock_transactions stx
         ON  stx.stock_item_id = si.id
         AND stx.created_at >= CONVERT_TZ(CONCAT(?, ' 00:00:00'), '+05:30', '+00:00')
         AND stx.created_at <  CONVERT_TZ(CONCAT(?, ' 00:00:00'), '+05:30', '+00:00')

       GROUP BY si.id, si.category, si.item_name, si.unit, si.quantity
       ORDER BY si.category, si.item_name`,
      [from, toPlusOne, from, toPlusOne]
    );

    res.json({
      success: true,
      data: result.rows,
      mode: from === to ? "single" : "range",
      dateRange: { from, to },
    });
  } catch (err) {
    next(err);
  }
});


// ═══════════════════════════════════════════════════════════════════════════════
// POST /api/stock
// Add a new stock item (manual items only — panels/inverters sync automatically).
// Seeds an 'initial' transaction if the starting quantity is > 0.
// ═══════════════════════════════════════════════════════════════════════════════
const addStockItemSchema = Joi.object({
  category: Joi.string().valid('Structure Material', 'Electrical Material').required(),
  itemName: Joi.string().required().trim().min(2).max(255),
  quantity: Joi.number().integer().required().min(0),
  unit: Joi.string().required().trim().max(30).default("pcs"),
});

router.post("/", validate(addStockItemSchema), async (req, res, next) => {
  const client = await db.getClient();
  try {
    const { category, itemName, quantity, unit } = req.body;

    await client.query("BEGIN");

    const insertResult = await client.query(
      `INSERT INTO stock_items (category, item_name, quantity, unit)
       VALUES (?, ?, ?, ?)`,
      [category, itemName, quantity, unit]
    );
    const newItemId = insertResult.insertId;

    // Seed initial transaction only if quantity > 0
    if (quantity > 0) {
      await client.query(
        `INSERT INTO stock_transactions
           (stock_item_id, transaction_type, quantity, balance_after, reason_category, performed_by)
         VALUES (?, 'initial', ?, ?, 'New stock item created', ?)`,
        [newItemId, quantity, quantity, req.user.id]
      );
    }

    await client.query("COMMIT");

    const result = await db.query("SELECT * FROM stock_items WHERE id = ?", [newItemId]);

    res.status(201).json({
      success: true,
      message: `Stock item '${itemName}' added.`,
      item: result.rows[0],
    });

    broadcastToRole("admin", "stock:changed", { action: "created" });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    next(err);
  } finally {
    client.release();
  }
});


// ─── Shared validation schema for stock movements (add / deduct) ─────────────
const stockMovementSchema = Joi.object({
  quantity:       Joi.number().integer().required().min(1).max(100000),
  reasonCategory: Joi.string().trim().max(100).optional().allow("", null),
  reasonNote:     Joi.string().trim().max(500).optional().allow("", null),
});


// ═══════════════════════════════════════════════════════════════════════════════
// POST /api/stock/:id/add
// Add stock — stock coming in (purchase, receipt, returned from site, etc.)
// Atomic: both stock_items update and stock_transactions insert succeed or both roll back.
// ═══════════════════════════════════════════════════════════════════════════════
router.post("/:id/add", validate(stockMovementSchema), async (req, res, next) => {
  const client = await db.getClient();
  try {
    const stockId = parseInt(req.params.id, 10);
    if (isNaN(stockId)) {
      return res.status(400).json({ success: false, error: "Invalid stock item ID." });
    }

    const { quantity, reasonCategory, reasonNote } = req.body;

    await client.query("BEGIN");

    // SELECT FOR UPDATE locks the row to prevent concurrent modification
    const findResult = await client.query(
      "SELECT id, item_name, quantity FROM stock_items WHERE id = ? FOR UPDATE",
      [stockId]
    );
    if (findResult.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ success: false, error: "Stock item not found." });
    }

    const currentQty  = findResult.rows[0].quantity;
    const newBalance  = currentQty + quantity;

    await client.query(
      "UPDATE stock_items SET quantity = ? WHERE id = ?",
      [newBalance, stockId]
    );

    const txResult = await client.query(
      `INSERT INTO stock_transactions
         (stock_item_id, transaction_type, quantity, balance_after,
          reason_category, reason_note, performed_by)
       VALUES (?, 'add', ?, ?, ?, ?, ?)`,
      [stockId, quantity, newBalance,
       reasonCategory || null, reasonNote || null, req.user.id]
    );

    await client.query("COMMIT");

    const updatedItem = (await db.query("SELECT * FROM stock_items WHERE id = ?", [stockId])).rows[0];

    res.json({
      success: true,
      message: `Added ${quantity} ${updatedItem.unit}. New balance: ${newBalance}.`,
      item: updatedItem,
      transaction: { id: txResult.insertId, type: "add", quantity, balance_after: newBalance },
    });

    broadcastToRole("admin", "stock:changed", { action: "add", id: stockId });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    next(err);
  } finally {
    client.release();
  }
});


// ═══════════════════════════════════════════════════════════════════════════════
// POST /api/stock/:id/deduct
// Use/deduct stock — stock going out (installation, damage, return to supplier, etc.)
// Blocked if deduction would exceed current balance.
// ═══════════════════════════════════════════════════════════════════════════════
router.post("/:id/deduct", validate(stockMovementSchema), async (req, res, next) => {
  const client = await db.getClient();
  try {
    const stockId = parseInt(req.params.id, 10);
    if (isNaN(stockId)) {
      return res.status(400).json({ success: false, error: "Invalid stock item ID." });
    }

    const { quantity, reasonCategory, reasonNote } = req.body;

    await client.query("BEGIN");

    const findResult = await client.query(
      "SELECT id, item_name, quantity, unit FROM stock_items WHERE id = ? FOR UPDATE",
      [stockId]
    );
    if (findResult.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ success: false, error: "Stock item not found." });
    }

    const currentQty = findResult.rows[0].quantity;
    const unit       = findResult.rows[0].unit;

    if (quantity > currentQty) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        success: false,
        error: `Cannot deduct ${quantity} ${unit} — only ${currentQty} available.`,
      });
    }

    const newBalance = currentQty - quantity;

    await client.query(
      "UPDATE stock_items SET quantity = ? WHERE id = ?",
      [newBalance, stockId]
    );

    const txResult = await client.query(
      `INSERT INTO stock_transactions
         (stock_item_id, transaction_type, quantity, balance_after,
          reason_category, reason_note, performed_by)
       VALUES (?, 'deduct', ?, ?, ?, ?, ?)`,
      [stockId, quantity, newBalance,
       reasonCategory || null, reasonNote || null, req.user.id]
    );

    await client.query("COMMIT");

    const updatedItem = (await db.query("SELECT * FROM stock_items WHERE id = ?", [stockId])).rows[0];

    res.json({
      success: true,
      message: `Used ${quantity} ${unit}. New balance: ${newBalance}.`,
      item: updatedItem,
      transaction: { id: txResult.insertId, type: "deduct", quantity, balance_after: newBalance },
    });

    broadcastToRole("admin", "stock:changed", { action: "deduct", id: stockId });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    next(err);
  } finally {
    client.release();
  }
});


// ═══════════════════════════════════════════════════════════════════════════════
// POST /api/stock/:id/adjust
// Physical stock count override — sets the exact quantity.
// reasonCategory is REQUIRED for adjustments (audit trail).
// ═══════════════════════════════════════════════════════════════════════════════
const adjustStockSchema = Joi.object({
  quantity:       Joi.number().integer().required().min(0).max(1000000),
  reasonCategory: Joi.string().trim().max(100).required(),
  reasonNote:     Joi.string().trim().max(500).optional().allow("", null),
});

router.post("/:id/adjust", validate(adjustStockSchema), async (req, res, next) => {
  const client = await db.getClient();
  try {
    const stockId = parseInt(req.params.id, 10);
    if (isNaN(stockId)) {
      return res.status(400).json({ success: false, error: "Invalid stock item ID." });
    }

    const { quantity: newQty, reasonCategory, reasonNote } = req.body;

    await client.query("BEGIN");

    const findResult = await client.query(
      "SELECT id, item_name, quantity, unit FROM stock_items WHERE id = ? FOR UPDATE",
      [stockId]
    );
    if (findResult.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ success: false, error: "Stock item not found." });
    }

    const currentQty = findResult.rows[0].quantity;

    // No-op if quantity unchanged
    if (newQty === currentQty) {
      await client.query("ROLLBACK");
      return res.json({
        success: true,
        message: "No change needed — quantity is already correct.",
        item: findResult.rows[0],
      });
    }

    const delta = Math.abs(newQty - currentQty);

    await client.query(
      "UPDATE stock_items SET quantity = ? WHERE id = ?",
      [newQty, stockId]
    );

    const txResult = await client.query(
      `INSERT INTO stock_transactions
         (stock_item_id, transaction_type, quantity, balance_after,
          reason_category, reason_note, performed_by)
       VALUES (?, 'adjustment', ?, ?, ?, ?, ?)`,
      [stockId, delta, newQty,
       reasonCategory, reasonNote || null, req.user.id]
    );

    await client.query("COMMIT");

    const updatedItem = (await db.query("SELECT * FROM stock_items WHERE id = ?", [stockId])).rows[0];

    res.json({
      success: true,
      message: `Stock adjusted to ${newQty} ${updatedItem.unit} (was ${currentQty}).`,
      item: updatedItem,
      transaction: {
        id: txResult.insertId, type: "adjustment",
        oldQty: currentQty, newQty, delta, balance_after: newQty,
      },
    });

    broadcastToRole("admin", "stock:changed", { action: "adjust", id: stockId });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    next(err);
  } finally {
    client.release();
  }
});


// ═══════════════════════════════════════════════════════════════════════════════
// PATCH /api/stock/:id
// Update unit price ONLY.
// Quantity is now managed exclusively through /add, /deduct, /adjust.
// Syncs updated price to the corresponding panel/inverter catalog entry
// (Structure Material and Electrical Material have no catalog table to sync to).
// ═══════════════════════════════════════════════════════════════════════════════
const updatePriceSchema = Joi.object({
  unitPrice: Joi.number().min(0).required(),
});

router.patch("/:id", validate(updatePriceSchema), async (req, res, next) => {
  try {
    const stockId = parseInt(req.params.id, 10);
    if (isNaN(stockId)) {
      return res.status(400).json({ success: false, error: "Invalid stock item ID." });
    }

    const { unitPrice } = req.body;

    const updateResult = await db.query(
      "UPDATE stock_items SET unit_price = ? WHERE id = ?",
      [unitPrice, stockId]
    );
    if (updateResult.rowCount === 0) {
      return res.status(404).json({ success: false, error: "Stock item not found." });
    }

    const result = await db.query("SELECT * FROM stock_items WHERE id = ?", [stockId]);
    const updatedItem = result.rows[0];

    // Sync price to the corresponding catalog table
    try {
      const { item_name, category } = updatedItem;
      if (category === "Panel") {
        const panels = await db.query(
          "SELECT id, brand, watt, type FROM panels WHERE is_active = 1"
        );
        const match = panels.rows.find(
          (p) => `${p.brand} ${p.watt}W ${p.type}` === item_name
        );
        if (match) {
          await db.query("UPDATE panels SET price_per_panel = ? WHERE id = ?", [unitPrice, match.id]);
        }
      } else if (category === "Inverter") {
        const inverters = await db.query(
          "SELECT id, brand, kw, type FROM inverters WHERE is_active = 1"
        );
        const match = inverters.rows.find((inv) => {
          const kwNum = parseFloat(inv.kw);
          const kwStr = kwNum % 1 === 0 ? String(kwNum) : String(kwNum);
          return `${inv.brand} ${kwStr}kW ${inv.type}` === item_name;
        });
        if (match) {
          await db.query("UPDATE inverters SET price_per_unit = ? WHERE id = ?", [unitPrice, match.id]);
        }
      }
    } catch (syncErr) {
      // Sync failure is non-fatal — log a warning but don't fail the request
      console.warn("[Stock] Price sync to catalog failed:", syncErr.message);
    }

    res.json({
      success: true,
      message: `Price for '${updatedItem.item_name}' updated to ₹${unitPrice}.`,
      item: updatedItem,
    });

    broadcastToRole("admin", "stock:changed", { action: "priceUpdated", id: stockId });
  } catch (err) {
    next(err);
  }
});


// ═══════════════════════════════════════════════════════════════════════════════
// DELETE /api/stock/:id
// Remove a stock item. ON DELETE CASCADE handles transaction cleanup automatically.
// If the item is an active Panel/Inverter in the catalog it will be re-synced on
// the next GET /api/stock call — we flag this in the response so the frontend
// can warn the user instead of silently letting the item ghost back.
// ═══════════════════════════════════════════════════════════════════════════════
router.delete("/:id", async (req, res, next) => {
  try {
    const stockId = parseInt(req.params.id, 10);
    if (isNaN(stockId)) {
      return res.status(400).json({ success: false, error: "Invalid stock item ID." });
    }

    // Fetch item details BEFORE deleting so we can check catalog membership
    const findResult = await db.query(
      "SELECT id, item_name, category FROM stock_items WHERE id = ?",
      [stockId]
    );
    if (findResult.rows.length === 0) {
      // Item already gone — refresh the caller's list so their UI becomes consistent
      return res.status(404).json({
        success: false,
        error: "Stock item not found. It may have already been removed. Please refresh to see the current stock list.",
      });
    }

    const { item_name: itemName, category } = findResult.rows[0];
    await db.query("DELETE FROM stock_items WHERE id = ?", [stockId]);

    // Check whether this item will be re-synced from the catalog on next GET /
    // This can only happen for Panel and Inverter categories (auto-synced via INSERT IGNORE).
    let willReappear = false;
    if (category === "Panel") {
      const catalogCheck = await db.query(
        `SELECT 1 FROM panels
         WHERE CONCAT(brand, ' ', watt, 'W ', type) = ? AND is_active = 1 LIMIT 1`,
        [itemName]
      );
      willReappear = catalogCheck.rows.length > 0;
    } else if (category === "Inverter") {
      const catalogCheck = await db.query(
        `SELECT 1 FROM inverters
         WHERE CONCAT(
           brand, ' ',
           TRIM(TRAILING '.' FROM TRIM(TRAILING '0' FROM CAST(kw AS CHAR))),
           'kW ', type
         ) = ? AND is_active = 1 LIMIT 1`,
        [itemName]
      );
      willReappear = catalogCheck.rows.length > 0;
    }

    res.json({
      success: true,
      message: `Stock item '${itemName}' removed.`,
      willReappear,
      category,
    });
    broadcastToRole("admin", "stock:changed", { action: "deleted", id: stockId });
  } catch (err) {
    next(err);
  }
});


export default router;
