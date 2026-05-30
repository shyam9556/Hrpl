import { Router } from "express";
import Joi from "joi";

import db from "../config/database.js";
import { authenticate, authorize } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";

const router = Router();

// ─── GET /api/settings/public ────────────────────────────
// Public settings needed by the frontend (NO auth required)
// Only exposes non-sensitive settings like GST rate, company name
router.get("/public", async (req, res, next) => {
  try {
    const publicKeys = [
      "gst_rate",
      "quotation_validity_days",
      "quotation_prefix",
      "company_name",
      "company_phone",
      "company_email",
      "company_address",
      "stock_threshold_high",
      "stock_threshold_low",
      "bom_price_per_kw",
      "labour_price_per_kw",
      "commission_price_per_kw",
      "profit_percentage",
      "transport_percentage",
      // MINOR-05: environmental stats used in quotation builder
      "solar_yield_per_kw",
      "co2_per_kw",
    ];

    // MySQL equivalent of ANY($1::text[]) — use IN with dynamic placeholders
    const placeholders = publicKeys.map(() => "?").join(", ");
    const result = await db.query(
      `SELECT \`key\`, value FROM system_settings WHERE \`key\` IN (${placeholders})`,
      publicKeys
    );

    const settings = {};
    for (const row of result.rows) {
      settings[row.key] = row.value;
    }

    res.json({ success: true, settings });
  } catch (err) {
    next(err);
  }
});

// All remaining settings routes require authentication + admin role
router.use(authenticate);

// ─── GET /api/settings ───────────────────────────────────
// Get all system settings (admin only)
router.get("/", authorize("admin"), async (req, res, next) => {
  try {
    const result = await db.query(
      "SELECT `key`, value, description FROM system_settings ORDER BY id"
    );

    // Convert rows array to key-value object for easier frontend use
    const settings = {};
    for (const row of result.rows) {
      settings[row.key] = row.value;
    }

    res.json({
      success: true,
      settings,
      details: result.rows, // Also send full details with descriptions
    });
  } catch (err) {
    next(err);
  }
});

// ─── PUT /api/settings ───────────────────────────────────
// Update system settings (admin only)
// Accepts: { gst_rate: "12", quotation_validity_days: "30", ... }
const updateSettingsSchema = Joi.object({
  settings: Joi.object().pattern(
    Joi.string(),
    Joi.string().allow("").max(500)
  ).required().min(1),
});

router.put("/", authorize("admin"), validate(updateSettingsSchema), async (req, res, next) => {
  try {
    const { settings } = req.body;
    const client = await db.getClient();
    let updatedCount = 0;

    try {
      await client.query("BEGIN");

      for (const [key, value] of Object.entries(settings)) {
        // Reject unknown keys
        const ALLOWED_SETTING_KEYS = [
          "gst_rate", "quotation_validity_days", "quotation_prefix",
          "company_name", "company_phone", "company_email", "company_address",
          "max_upload_size_mb", "smtp_from_email", "smtp_from_name",
          "stock_threshold_high", "stock_threshold_low", "stock_manager_pin",
          "bom_price_per_kw", "labour_price_per_kw", "commission_price_per_kw",
          "profit_percentage", "transport_percentage",
          // MINOR-05: environmental stats
          "solar_yield_per_kw", "co2_per_kw",
        ];
        if (!ALLOWED_SETTING_KEYS.includes(key)) {
          await client.query("ROLLBACK");
          return res.status(400).json({
            success: false,
            error: `Unknown setting key: '${key}'.`,
          });
        }

        // Validate stock manager PIN
        if (key === "stock_manager_pin") {
          const isNumeric = /^\d{4,8}$/.test(value);
          if (!isNumeric) {
            await client.query("ROLLBACK");
            return res.status(400).json({
              success: false,
              error: "Stock Manager PIN must be a 4 to 8 digit number.",
            });
          }
        }

        // Validate known numeric settings
        if (["gst_rate", "quotation_validity_days", "max_upload_size_mb", "stock_threshold_high", "stock_threshold_low", "bom_price_per_kw", "labour_price_per_kw", "commission_price_per_kw", "profit_percentage", "transport_percentage", "solar_yield_per_kw", "co2_per_kw"].includes(key)) {
          const num = Number(value);
          if (isNaN(num) || num < 0) {
            await client.query("ROLLBACK");
            return res.status(400).json({
              success: false,
              error: `Invalid value for '${key}': must be a non-negative number.`,
            });
          }
          if (["gst_rate", "profit_percentage", "transport_percentage"].includes(key) && (num < 0 || num > 100)) {
            await client.query("ROLLBACK");
            return res.status(400).json({
              success: false,
              error: `${key.replace(/_/g, " ").toUpperCase()} must be between 0 and 100.`,
            });
          }
          if (key === "quotation_validity_days" && (num < 1 || num > 365)) {
            await client.query("ROLLBACK");
            return res.status(400).json({
              success: false,
              error: "Quotation validity must be between 1 and 365 days.",
            });
          }
          if (key === "stock_threshold_low" && num < 0) {
            await client.query("ROLLBACK");
            return res.status(400).json({
              success: false,
              error: "Low stock threshold must be a non-negative number.",
            });
          }
        }

        // key is a reserved word in MySQL — backtick-quote it
        const result = await client.query(
          "UPDATE system_settings SET value = ? WHERE `key` = ?",
          [value, key]
        );
        if (result.rowCount > 0) updatedCount++;
      }

      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }

    // Fetch updated settings
    const result = await db.query(
      "SELECT `key`, value, description FROM system_settings ORDER BY id"
    );

    const updatedSettings = {};
    for (const row of result.rows) {
      updatedSettings[row.key] = row.value;
    }

    res.json({
      success: true,
      message: `${updatedCount} setting(s) updated.`,
      settings: updatedSettings,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
