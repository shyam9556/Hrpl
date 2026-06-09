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

// ─── GET /api/stock ──────────────────────────────────────
// Get all stock items grouped by category (with automatic panels/inverters sync)
router.get("/", async (req, res, next) => {
  try {
    // Batch sync all active panels to stock in a single query
    // MySQL equivalent: INSERT IGNORE (replaces ON CONFLICT DO NOTHING)
    // MySQL does not have TO_CHAR; use CONCAT and CAST instead
    await db.query(
      `INSERT IGNORE INTO stock_items (category, item_name, quantity, unit)
       SELECT 'Panel',
              CONCAT(brand, ' ', watt, 'W ', type),
              0, 'pcs'
       FROM panels WHERE is_active = 1`
    );

    // Batch sync all active inverters to stock
    // Strip trailing zeros so SQL format matches JS Number(kw).toString():
    //   3.60 → '3.6', 3.00 → '3', 1.50 → '1.5'
    // We can't use TRIM(TRAILING '0') directly on decimals; convert to CHAR first,
    // then trim trailing zeros and any trailing decimal point.
    await db.query(
      `INSERT IGNORE INTO stock_items (category, item_name, quantity, unit)
       SELECT 'Inverter',
              CONCAT(
                brand, ' ',
                TRIM(TRAILING '.' FROM TRIM(TRAILING '0' FROM CAST(kw AS CHAR))),
                'kW ', type
              ),
              0, 'pcs'
       FROM inverters WHERE is_active = 1`
    );

    // Fetch all stock items (including newly synced ones)
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

// ─── POST /api/stock ─────────────────────────────────────
// Add a new stock item
const addStockSchema = Joi.object({
  category: Joi.string().required().trim().min(2).max(50),
  itemName: Joi.string().required().trim().min(2).max(255),
  quantity: Joi.number().integer().required().min(0),
  unit: Joi.string().required().trim().max(30).default("pcs"),
});

router.post("/", validate(addStockSchema), async (req, res, next) => {
  try {
    const { category, itemName, quantity, unit } = req.body;

    const insertResult = await db.query(
      `INSERT INTO stock_items (category, item_name, quantity, unit)
       VALUES (?, ?, ?, ?)`,
      [category, itemName, quantity, unit]
    );

    // Fetch inserted row
    const result = await db.query(
      "SELECT * FROM stock_items WHERE id = ?",
      [insertResult.insertId]
    );

    res.status(201).json({
      success: true,
      message: `Stock item '${itemName}' added.`,
      item: result.rows[0],
    });

    broadcastToRole("admin", "stock:changed", { action: "created" });
  } catch (err) {
    next(err);
  }
});

// ─── PATCH /api/stock/:id ────────────────────────────────
// Update stock quantity and/or unit price
const updateStockSchema = Joi.object({
  quantity: Joi.number().integer().min(0),
  unitPrice: Joi.number().min(0),
}).min(1);

router.patch("/:id", validate(updateStockSchema), async (req, res, next) => {
  try {
    const stockId = parseInt(req.params.id, 10);
    const { quantity, unitPrice } = req.body;

    if (isNaN(stockId)) {
      return res.status(400).json({ success: false, error: "Invalid stock item ID." });
    }

    const updateFields = [];
    const params = [];

    if (quantity !== undefined) {
      updateFields.push("quantity = ?");
      params.push(quantity);
    }
    if (unitPrice !== undefined) {
      updateFields.push("unit_price = ?");
      params.push(unitPrice);
    }

    params.push(stockId);
    const query = `UPDATE stock_items SET ${updateFields.join(", ")} WHERE id = ?`;
    const updateResult = await db.query(query, params);

    if (updateResult.rowCount === 0) {
      return res.status(404).json({ success: false, error: "Stock item not found." });
    }

    // Fetch updated item
    const result = await db.query("SELECT * FROM stock_items WHERE id = ?", [stockId]);
    const updatedItem = result.rows[0];

    // Synchronize price to corresponding panels, inverters, or accessories if changed
    if (unitPrice !== undefined) {
      const item_name = updatedItem.item_name;
      const category = updatedItem.category;

      try {
        if (category === "Panel") {
          const panels = await db.query("SELECT id, brand, watt, type FROM panels WHERE is_active = 1");
          const matchedPanel = panels.rows.find(p => `${p.brand} ${p.watt}W ${p.type}`.trim() === item_name);
          if (matchedPanel) {
            await db.query("UPDATE panels SET price_per_panel = ? WHERE id = ?", [unitPrice, matchedPanel.id]);
          }
        } else if (category === "Inverter") {
          const inverters = await db.query("SELECT id, brand, kw, type FROM inverters WHERE is_active = 1");
          const matchedInverter = inverters.rows.find(inv => `${inv.brand} ${Number(inv.kw)}kW ${inv.type}`.trim() === item_name);
          if (matchedInverter) {
            await db.query("UPDATE inverters SET price_per_unit = ? WHERE id = ?", [unitPrice, matchedInverter.id]);
          }
        } else if (category === "Accessory" || category === "Wire") {
          await db.query(
            "UPDATE accessories SET price = ? WHERE display_name = ?",
            [unitPrice, item_name]
          );
        }
      } catch (syncErr) {
        console.warn(`[Sync Warning] Failed to sync stock price to catalog:`, syncErr.message);
      }
    }

    res.json({
      success: true,
      message: `Stock item '${updatedItem.item_name}' updated successfully.`,
      item: updatedItem,
    });

    broadcastToRole("admin", "stock:changed", { action: "updated", id: stockId });
  } catch (err) {
    next(err);
  }
});

// ─── DELETE /api/stock/:id ───────────────────────────────
// Remove a stock item
router.delete("/:id", async (req, res, next) => {
  try {
    const stockId = parseInt(req.params.id, 10);

    if (isNaN(stockId)) {
      return res.status(400).json({ success: false, error: "Invalid stock item ID." });
    }

    // Fetch item name before deletion for response message
    const findResult = await db.query(
      "SELECT item_name FROM stock_items WHERE id = ?",
      [stockId]
    );

    if (findResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: "Stock item not found." });
    }

    const itemName = findResult.rows[0].item_name;

    await db.query("DELETE FROM stock_items WHERE id = ?", [stockId]);

    res.json({
      success: true,
      message: `Stock item '${itemName}' removed.`,
    });

    broadcastToRole("admin", "stock:changed", { action: "deleted", id: stockId });
  } catch (err) {
    next(err);
  }
});

export default router;
