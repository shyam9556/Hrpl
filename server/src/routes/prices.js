import { Router } from "express";
import Joi from "joi";

import db from "../config/database.js";
import { authenticate, authorize } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { broadcast } from "../utils/sseManager.js";

const router = Router();

// All price routes require authentication
router.use(authenticate);

// ─── Shared Item Name Builders ───────────────────────────
// These MUST match the SQL in stock.js INSERT...SELECT to ensure sync consistency
const buildPanelItemName = (brand, watt, type) =>
  `${brand} ${watt}W ${type}`.trim();

const buildInverterItemName = (brand, kw, type) =>
  `${brand} ${Number(kw)}kW ${type}`.trim();

// ═══════════════════════════════════════════════════════════
// PANELS
// ═══════════════════════════════════════════════════════════

// ─── GET /api/prices/panels ──────────────────────────────
// Get all active panels (available to all authenticated users)
router.get("/panels", async (req, res, next) => {
  try {
    const result = await db.query(
      "SELECT * FROM panels WHERE is_active = 1 ORDER BY brand, watt"
    );
    res.json({ success: true, panels: result.rows });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/prices/panels ─────────────────────────────
// Add a new panel (admin only)
const panelSchema = Joi.object({
  brand: Joi.string().required().trim().min(2).max(100),
  watt: Joi.string().required().trim().max(50),
  type: Joi.string().required().valid("Mono PERC", "Bifacial", "TOPCon", "Polycrystalline"),
  pricePerPanel: Joi.number().required().min(0),
});

router.post("/panels", authorize("admin"), validate(panelSchema), async (req, res, next) => {
  try {
    const { brand, watt, type, pricePerPanel } = req.body;

    const insertResult = await db.query(
      `INSERT INTO panels (brand, watt, type, price_per_panel)
       VALUES (?, ?, ?, ?)`,
      [brand, watt, type, pricePerPanel]
    );

    // Fetch inserted row
    const result = await db.query("SELECT * FROM panels WHERE id = ?", [insertResult.insertId]);

    res.status(201).json({
      success: true,
      message: `Panel ${brand} ${watt}W added successfully.`,
      panel: result.rows[0],
    });

    broadcast("prices:changed", { type: "panel", action: "created" });
  } catch (err) {
    next(err);
  }
});

// ─── PUT /api/prices/panels/:id ──────────────────────────
// Update a panel (admin only)
router.put("/panels/:id", authorize("admin"), validate(panelSchema), async (req, res, next) => {
  try {
    const panelId = parseInt(req.params.id, 10);
    if (isNaN(panelId)) {
      return res.status(400).json({ success: false, error: "Invalid panel ID." });
    }
    const { brand, watt, type, pricePerPanel } = req.body;

    const updateResult = await db.query(
      `UPDATE panels SET brand = ?, watt = ?, type = ?, price_per_panel = ?
       WHERE id = ? AND is_active = 1`,
      [brand, watt, type, pricePerPanel, panelId]
    );

    if (updateResult.rowCount === 0) {
      return res.status(404).json({ success: false, error: "Panel not found." });
    }

    // Fetch updated panel
    const result = await db.query("SELECT * FROM panels WHERE id = ?", [panelId]);
    const updatedPanel = result.rows[0];
    const itemName = buildPanelItemName(updatedPanel.brand, updatedPanel.watt, updatedPanel.type);

    try {
      await db.query(
        "UPDATE stock_items SET unit_price = ? WHERE item_name = ? AND category = 'Panel'",
        [pricePerPanel, itemName]
      );
    } catch (syncErr) {
      console.warn(`[Sync Warning] Failed to sync panel price to stock:`, syncErr.message);
    }

    res.json({
      success: true,
      message: `Panel updated successfully.`,
      panel: updatedPanel,
    });

    broadcast("prices:changed", { type: "panel", action: "updated", id: panelId });
  } catch (err) {
    next(err);
  }
});

// ─── DELETE /api/prices/panels/:id ───────────────────────
// Soft-delete a panel (admin only) — marks as inactive, preserves history
router.delete("/panels/:id", authorize("admin"), async (req, res, next) => {
  try {
    const panelId = parseInt(req.params.id, 10);
    if (isNaN(panelId)) {
      return res.status(400).json({ success: false, error: "Invalid panel ID." });
    }

    // Check if panel is used in any pending quotations
    const pendingCheck = await db.query(
      "SELECT COUNT(*) as count FROM quotations WHERE panel_id = ? AND status = 'Pending'",
      [panelId]
    );
    const pendingCount = parseInt(pendingCheck.rows[0].count, 10);
    if (pendingCount > 0) {
      return res.status(400).json({
        success: false,
        error: `Cannot deactivate — ${pendingCount} pending quotation(s) use this panel. Approve or reject them first.`,
      });
    }

    // Fetch panel info before deactivating (for response message)
    const findResult = await db.query(
      "SELECT id, brand, watt FROM panels WHERE id = ? AND is_active = 1",
      [panelId]
    );

    if (findResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: "Panel not found." });
    }

    const p = findResult.rows[0];

    await db.query(
      "UPDATE panels SET is_active = 0 WHERE id = ?",
      [panelId]
    );

    res.json({
      success: true,
      message: `Panel ${p.brand} ${p.watt}W removed from catalog.`,
    });

    broadcast("prices:changed", { type: "panel", action: "deleted", id: panelId });
  } catch (err) {
    next(err);
  }
});

// ═══════════════════════════════════════════════════════════
// INVERTERS
// ═══════════════════════════════════════════════════════════

// ─── GET /api/prices/inverters ───────────────────────────
router.get("/inverters", async (req, res, next) => {
  try {
    const result = await db.query(
      "SELECT * FROM inverters WHERE is_active = 1 ORDER BY brand, kw"
    );
    res.json({ success: true, inverters: result.rows });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/prices/inverters ──────────────────────────
const inverterSchema = Joi.object({
  brand: Joi.string().required().trim().min(2).max(100),
  kw: Joi.number().required().min(0.5).max(500),
  type: Joi.string().required().trim().max(50),
  pricePerUnit: Joi.number().required().min(0),
});

router.post("/inverters", authorize("admin"), validate(inverterSchema), async (req, res, next) => {
  try {
    const { brand, kw, type, pricePerUnit } = req.body;

    const insertResult = await db.query(
      `INSERT INTO inverters (brand, kw, type, price_per_unit)
       VALUES (?, ?, ?, ?)`,
      [brand, kw, type, pricePerUnit]
    );

    // Fetch inserted row
    const result = await db.query("SELECT * FROM inverters WHERE id = ?", [insertResult.insertId]);

    res.status(201).json({
      success: true,
      message: `Inverter ${brand} ${kw}kW added successfully.`,
      inverter: result.rows[0],
    });

    broadcast("prices:changed", { type: "inverter", action: "created" });
  } catch (err) {
    next(err);
  }
});

// ─── PUT /api/prices/inverters/:id ───────────────────────
router.put("/inverters/:id", authorize("admin"), validate(inverterSchema), async (req, res, next) => {
  try {
    const inverterId = parseInt(req.params.id, 10);
    if (isNaN(inverterId)) {
      return res.status(400).json({ success: false, error: "Invalid inverter ID." });
    }
    const { brand, kw, type, pricePerUnit } = req.body;

    const updateResult = await db.query(
      `UPDATE inverters SET brand = ?, kw = ?, type = ?, price_per_unit = ?
       WHERE id = ? AND is_active = 1`,
      [brand, kw, type, pricePerUnit, inverterId]
    );

    if (updateResult.rowCount === 0) {
      return res.status(404).json({ success: false, error: "Inverter not found." });
    }

    // Fetch updated inverter
    const result = await db.query("SELECT * FROM inverters WHERE id = ?", [inverterId]);
    const updatedInverter = result.rows[0];
    const itemName = buildInverterItemName(updatedInverter.brand, updatedInverter.kw, updatedInverter.type);

    try {
      await db.query(
        "UPDATE stock_items SET unit_price = ? WHERE item_name = ? AND category = 'Inverter'",
        [pricePerUnit, itemName]
      );
    } catch (syncErr) {
      console.warn(`[Sync Warning] Failed to sync inverter price to stock:`, syncErr.message);
    }

    res.json({
      success: true,
      message: `Inverter updated successfully.`,
      inverter: updatedInverter,
    });

    broadcast("prices:changed", { type: "inverter", action: "updated", id: inverterId });
  } catch (err) {
    next(err);
  }
});

// ─── DELETE /api/prices/inverters/:id ────────────────────
router.delete("/inverters/:id", authorize("admin"), async (req, res, next) => {
  try {
    const inverterId = parseInt(req.params.id, 10);
    if (isNaN(inverterId)) {
      return res.status(400).json({ success: false, error: "Invalid inverter ID." });
    }

    // Check if inverter is used in any pending quotations
    const pendingCheck = await db.query(
      "SELECT COUNT(*) as count FROM quotations WHERE inverter_id = ? AND status = 'Pending'",
      [inverterId]
    );
    const pendingCount = parseInt(pendingCheck.rows[0].count, 10);
    if (pendingCount > 0) {
      return res.status(400).json({
        success: false,
        error: `Cannot deactivate — ${pendingCount} pending quotation(s) use this inverter. Approve or reject them first.`,
      });
    }

    // Fetch inverter info before deactivating
    const findResult = await db.query(
      "SELECT id, brand, kw FROM inverters WHERE id = ? AND is_active = 1",
      [inverterId]
    );

    if (findResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: "Inverter not found." });
    }

    const inv = findResult.rows[0];

    await db.query(
      "UPDATE inverters SET is_active = 0 WHERE id = ?",
      [inverterId]
    );

    res.json({
      success: true,
      message: `Inverter ${inv.brand} ${inv.kw}kW removed from catalog.`,
    });

    broadcast("prices:changed", { type: "inverter", action: "deleted", id: inverterId });
  } catch (err) {
    next(err);
  }
});

// ═══════════════════════════════════════════════════════════
// ACCESSORIES
// ═══════════════════════════════════════════════════════════

// ─── GET /api/prices/accessories ─────────────────────────
router.get("/accessories", async (req, res, next) => {
  try {
    const result = await db.query(
      "SELECT * FROM accessories ORDER BY id"
    );
    res.json({ success: true, accessories: result.rows });
  } catch (err) {
    next(err);
  }
});

// ─── PUT /api/prices/accessories ─────────────────────────
// Update accessory prices (admin only) — accepts array of { id, price }
const accessoryUpdateSchema = Joi.object({
  accessories: Joi.array().items(
    Joi.object({
      id: Joi.number().integer().required(),
      price: Joi.number().required().min(0),
    })
  ).required().min(1),
});

router.put("/accessories", authorize("admin"), validate(accessoryUpdateSchema), async (req, res, next) => {
  try {
    const { accessories } = req.body;
    const client = await db.getClient();

    try {
      await client.query("BEGIN");

      for (const acc of accessories) {
        await client.query(
          "UPDATE accessories SET price = ? WHERE id = ?",
          [acc.price, acc.id]
        );

        try {
          const accInfo = await client.query("SELECT key_name, display_name FROM accessories WHERE id = ?", [acc.id]);
          if (accInfo.rows.length > 0) {
            const { key_name: keyName, display_name: displayName } = accInfo.rows[0];

            // Map new key_names (from update-accessories.js) to their stock_items names.
            // Stock items are seeded using display_name, so we sync by display_name.
            // This replaces the old hardcoded key_name map which used stale key names.
            let stockItemName = null;
            if (keyName === "acdb") stockItemName = "ACDB (L&T ELMEX)";
            else if (keyName === "dcdb") stockItemName = "DCDB (L&T ELMEX)";
            else if (keyName === "earthing_la_electrode") stockItemName = "EARTHING & LA ELECTRODE (VASUDHARA)";
            else if (keyName === "polycab_dc_cable_red") stockItemName = "POLYCAB DC CABLE 4 SQ MM (RED)";
            else if (keyName === "polycab_dc_cable_black") stockItemName = "POLYCAB DC CABLE 4 SQ MM (BLACK)";
            else if (keyName === "addison_ac_cable_red") stockItemName = "ADDISON AC CABLE 2.5 SQ MM (RED)";
            else if (keyName === "addison_ac_cable_black") stockItemName = "ADDISON AC CABLE 2.5 SQ MM (BLACK)";
            else if (keyName === "addison_la_cable") stockItemName = "ADDISON LA CABLE 16 MM (GREEN)";
            else if (keyName === "earthing_chemical") stockItemName = "EARTHING CHEMICAL (VASUDHARA)";

            // Fallback: if no mapping above, try matching by display_name directly
            if (!stockItemName) stockItemName = displayName;

            if (stockItemName) {
              await client.query(
                "UPDATE stock_items SET unit_price = ? WHERE item_name = ?",
                [acc.price, stockItemName]
              );
            }
          }
        } catch (syncErr) {
          console.warn(`[Sync Warning] Failed to sync accessory price to stock:`, syncErr.message);
        }
      }

      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }

    // Fetch updated accessories
    const result = await db.query("SELECT * FROM accessories ORDER BY id");

    res.json({
      success: true,
      message: `${accessories.length} accessory price(s) updated.`,
      accessories: result.rows,
    });

    broadcast("prices:changed", { type: "accessories", action: "updated" });
  } catch (err) {
    next(err);
  }
});

// ═══════════════════════════════════════════════════════════
// KITS
// ═══════════════════════════════════════════════════════════

// ─── GET /api/prices/kits ─────────────────────────────────
// Get all kits (admin only — dealers get them via GET /api/prices)
router.get("/kits", authorize("admin"), async (req, res, next) => {
  try {
    const result = await db.query("SELECT * FROM kit_prices ORDER BY brand, type, panels");
    res.json({ success: true, kits: result.rows });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/prices/kits ────────────────────────────────
// Add a new kit configuration (admin only)
const kitCreateSchema = Joi.object({
  brand:     Joi.string().required().trim().min(2).max(100),
  type:      Joi.string().required().trim().max(50),
  watt:      Joi.string().required().trim().max(50),
  panels:    Joi.number().integer().required().min(1),
  kw:        Joi.number().required().min(0.1).max(500),
  inv_brand: Joi.string().required().trim().max(100),
  inv_kw:    Joi.number().required().min(0.1).max(500),
  price:     Joi.number().required().min(0),
});

router.post("/kits", authorize("admin"), validate(kitCreateSchema), async (req, res, next) => {
  try {
    const { brand, type, watt, panels, kw, inv_brand, inv_kw, price } = req.body;
    const insertResult = await db.query(
      `INSERT INTO kit_prices (brand, type, watt, panels, kw, inv_brand, inv_kw, price)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [brand, type, watt, panels, kw, inv_brand, inv_kw, price]
    );
    const result = await db.query("SELECT * FROM kit_prices WHERE id = ?", [insertResult.insertId]);
    res.status(201).json({
      success: true,
      message: `Kit ${brand} ${type} ${kw}kW added successfully.`,
      kit: result.rows[0],
    });

    broadcast("prices:changed", { type: "kit", action: "created" });
  } catch (err) {
    next(err);
  }
});

// ─── PUT /api/prices/kits/:id ───────────────────────────
// Update a kit price (admin only)
const kitPriceSchema = Joi.object({
  price: Joi.number().required().min(0),
});

router.put("/kits/:id", authorize("admin"), validate(kitPriceSchema), async (req, res, next) => {
  try {
    const kitId = parseInt(req.params.id, 10);
    if (isNaN(kitId)) {
      return res.status(400).json({ success: false, error: "Invalid kit ID." });
    }
    const { price } = req.body;

    const updateResult = await db.query(
      "UPDATE kit_prices SET price = ? WHERE id = ?",
      [price, kitId]
    );

    if (updateResult.rowCount === 0) {
      return res.status(404).json({ success: false, error: "Kit not found." });
    }

    const result = await db.query("SELECT * FROM kit_prices WHERE id = ?", [kitId]);

    res.json({
      success: true,
      message: `Kit price updated to ₹${price}.`,
      kit: result.rows[0],
    });

    broadcast("prices:changed", { type: "kit", action: "updated", id: kitId });
  } catch (err) {
    next(err);
  }
});

// ─── DELETE /api/prices/kits/:id ──────────────────────────
// Remove a kit configuration (admin only)
router.delete("/kits/:id", authorize("admin"), async (req, res, next) => {
  try {
    const kitId = parseInt(req.params.id, 10);
    if (isNaN(kitId)) {
      return res.status(400).json({ success: false, error: "Invalid kit ID." });
    }
    const findResult = await db.query("SELECT id, brand, type, kw FROM kit_prices WHERE id = ?", [kitId]);
    if (findResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: "Kit not found." });
    }
    const k = findResult.rows[0];
    await db.query("DELETE FROM kit_prices WHERE id = ?", [kitId]);
    res.json({
      success: true,
      message: `Kit ${k.brand} ${k.type} ${k.kw}kW removed from catalog.`,
    });

    broadcast("prices:changed", { type: "kit", action: "deleted", id: kitId });
  } catch (err) {
    next(err);
  }
});

// ═══════════════════════════════════════════════════════════
// COMBINED — All prices in one call
// ═══════════════════════════════════════════════════════════

// ─── GET /api/prices ─────────────────────────────────────
// Get all prices (panels + inverters + accessories + kits) in a single request
router.get("/", async (req, res, next) => {
  try {
    const [panels, inverters, accessories, kits] = await Promise.all([
      db.query("SELECT * FROM panels WHERE is_active = 1 ORDER BY brand, watt"),
      db.query("SELECT * FROM inverters WHERE is_active = 1 ORDER BY brand, kw"),
      db.query("SELECT * FROM accessories ORDER BY id"),
      db.query("SELECT * FROM kit_prices ORDER BY brand, type, panels"),
    ]);

    res.json({
      success: true,
      panels: panels.rows,
      inverters: inverters.rows,
      accessories: accessories.rows,
      kits: kits.rows,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
