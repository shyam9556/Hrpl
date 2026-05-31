import { Router } from "express";
import Joi from "joi";
import crypto from "crypto";

import db from "../config/database.js";
import env from "../config/env.js";
import { authenticate, authorize } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { sendQuotationStatusEmail, sendDeliveryMilestoneEmail, sendQuotationReuploadEmail } from "../services/emailService.js";

const router = Router();

// All quotation routes require authentication
router.use(authenticate);

// ─── Quotation Number Generator ──────────────────────────
// Format: HP/2025-26/0001 (prefix/financial-year/sequential)
// Uses MySQL GET_LOCK() as advisory lock to prevent concurrent duplicates
async function generateQuotationNumber(queryFn = db) {
  // Get prefix from settings
  const prefixResult = await queryFn.query(
    "SELECT value FROM system_settings WHERE `key` = 'quotation_prefix'"
  );
  const prefix = prefixResult.rows[0]?.value || "HP";

  // Calculate Indian financial year (April to March)
  const now = new Date();
  const month = now.getMonth() + 1; // 1-12
  const year = now.getFullYear();
  const fyStart = month >= 4 ? year : year - 1;
  const fyEnd = fyStart + 1;
  const fy = `${fyStart}-${String(fyEnd).slice(-2)}`; // e.g., "2025-26"

  // Get last quotation number for this financial year
  const lastResult = await queryFn.query(
    `SELECT quotation_number FROM quotations
     WHERE quotation_number LIKE ?
     ORDER BY id DESC LIMIT 1`,
    [`${prefix}/${fy}/%`]
  );

  let nextSeq = 1;
  if (lastResult.rows.length > 0) {
    const lastNum = lastResult.rows[0].quotation_number;
    const lastSeq = parseInt(lastNum.split("/").pop(), 10);
    nextSeq = lastSeq + 1;
  }

  return `${prefix}/${fy}/${String(nextSeq).padStart(4, "0")}`;
}

// ─── Validation Schema ───────────────────────────────────
const createQuotationSchema = Joi.object({
  customerId: Joi.number().integer().allow(null),
  panelId: Joi.number().integer().required(),
  inverterId: Joi.number().integer().required(),
  panelCount: Joi.number().integer().required().min(1).max(500),
  systemKw: Joi.number().required().min(0.1),
  structureHeight: Joi.string().allow("", null).max(100).default("Ground Level (Flat)"),
  paymentMode: Joi.string().allow("", null).max(100).default("Cash"),
  subsidyApplicable: Joi.boolean().default(true),
  panelCost: Joi.number().required().min(0),
  inverterCost: Joi.number().required().min(0),
  dcWireCost: Joi.number().min(0).default(0),
  acWireCost: Joi.number().min(0).default(0),
  structureCost: Joi.number().min(0).default(0),
  electricalCost: Joi.number().min(0).default(0),
  earthingCost: Joi.number().min(0).default(0),
  miscCost: Joi.number().min(0).default(0),
  subtotal: Joi.number().required().min(0),
  gstRate: Joi.number().required().min(0).max(100).default(12),
  gstAmount: Joi.number().required().min(0),
  total: Joi.number().required().min(0),
  subsidyAmount: Joi.number().min(0).default(0),
  effectivePrice: Joi.number().required().min(0),
  pricePerKw: Joi.number().min(0).default(0),
});

// ─── POST /api/quotations ────────────────────────────────
// Create a new quotation
router.post("/", validate(createQuotationSchema), async (req, res, next) => {
  const client = await db.getClient();
  try {
    const data = req.body;

    await client.query("BEGIN");

    // MySQL advisory lock prevents concurrent quotation number generation
    // GET_LOCK returns 1 on success, 0 on timeout, NULL on error
    await client.query("SELECT GET_LOCK('quotation_number_lock', 10) as locked");

    // Generate sequential quotation number within the lock
    const quotationNumber = await generateQuotationNumber(client);

    // Server-side cost validation
    const {
      panelCost, inverterCost, dcWireCost, acWireCost, structureCost,
      electricalCost, earthingCost, miscCost, subtotal, gstRate,
      gstAmount, total, subsidyAmount, effectivePrice
    } = data;

    const expectedSubtotal = panelCost + inverterCost + dcWireCost + acWireCost +
      structureCost + electricalCost + earthingCost + miscCost;
    const expectedGst = Math.round(expectedSubtotal * (gstRate / 100));
    const expectedTotal = expectedSubtotal + expectedGst;
    const expectedEffective = Math.max(0, expectedTotal - subsidyAmount);

    // Allow Rs.2 tolerance for rounding differences
    const tolerance = 2;
    if (Math.abs(subtotal - expectedSubtotal) > tolerance ||
        Math.abs(gstAmount - expectedGst) > tolerance ||
        Math.abs(total - expectedTotal) > tolerance ||
        Math.abs(effectivePrice - expectedEffective) > tolerance) {
      // ISSUE-19: Also allow effectivePrice > expectedEffective (custom price override is allowed UPWARD).
      // Only reject if math doesn't add up internally OR if effective < computed (custom price below floor).
      const isCustomPriceOverride = effectivePrice > expectedEffective + tolerance;
      if (!isCustomPriceOverride) {
        console.error("[Pricing Mismatch] Validation failed:");
        console.error(`  - Received gstRate: ${gstRate}`);
        console.error(`  - Subtotal: Submitted = ${subtotal}, Expected = ${expectedSubtotal} (diff = ${Math.abs(subtotal - expectedSubtotal)})`);
        console.error(`  - GST Amount: Submitted = ${gstAmount}, Expected = ${expectedGst} (diff = ${Math.abs(gstAmount - expectedGst)})`);
        console.error(`  - Total: Submitted = ${total}, Expected = ${expectedTotal} (diff = ${Math.abs(total - expectedTotal)})`);
        console.error(`  - Effective: Submitted = ${effectivePrice}, Expected = ${expectedEffective} (diff = ${Math.abs(effectivePrice - expectedEffective)})`);

        await client.query("ROLLBACK");
        await client.query("SELECT RELEASE_LOCK('quotation_number_lock')");
        return res.status(400).json({
          success: false,
          error: "Cost calculation mismatch. Please refresh and try again.",
        });
      }
    }

    // ISSUE-19: Reject custom prices BELOW the computed standard effective price.
    // The frontend prevents this too (isCustomPriceValid check), but this is the
    // authoritative backend guard against tampered requests.
    if (effectivePrice < expectedEffective - tolerance) {
      await client.query("ROLLBACK");
      await client.query("SELECT RELEASE_LOCK('quotation_number_lock')");
      return res.status(400).json({
        success: false,
        error: `Custom price (Rs.${effectivePrice.toLocaleString("en-IN")}) cannot be below the computed standard price (Rs.${expectedEffective.toLocaleString("en-IN")}). Please set a valid price.`,
      });
    }

    // Get quotation validity from settings
    const validityResult = await client.query(
      "SELECT value FROM system_settings WHERE `key` = 'quotation_validity_days'"
    );
    const validityDays = parseInt(validityResult.rows[0]?.value || "30", 10);
    const validUntil = new Date();
    validUntil.setDate(validUntil.getDate() + validityDays);

    const insertResult = await client.query(
      `INSERT INTO quotations (
        quotation_number, dealer_id, customer_id, panel_id, inverter_id,
        panel_count, system_kw, structure_height, payment_mode, subsidy_applicable,
        panel_cost, inverter_cost, dc_wire_cost, ac_wire_cost, structure_cost,
        electrical_cost, earthing_cost, misc_cost, subtotal, gst_rate,
        gst_amount, total, subsidy_amount, effective_price, price_per_kw,
        valid_until
      ) VALUES (
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?
      )`,
      [
        quotationNumber, req.user.id, data.customerId || null, data.panelId, data.inverterId,
        data.panelCount, data.systemKw, data.structureHeight, data.paymentMode, data.subsidyApplicable ? 1 : 0,
        data.panelCost, data.inverterCost, data.dcWireCost, data.acWireCost, data.structureCost,
        data.electricalCost, data.earthingCost, data.miscCost, data.subtotal, data.gstRate,
        data.gstAmount, data.total, data.subsidyAmount, data.effectivePrice, data.pricePerKw,
        validUntil.toISOString().split("T")[0],
      ]
    );

    await client.query("COMMIT");
    await client.query("SELECT RELEASE_LOCK('quotation_number_lock')");

    // Fetch the full inserted quotation with joins
    const quotationResult = await db.query(
      `SELECT q.*,
              u.name as dealer_name, u.email as dealer_email, u.mobile as dealer_mobile,
              c.name as customer_name, c.phone as customer_phone, c.email as customer_email,
              c.city as customer_city, c.address as customer_address,
              p.brand as panel_brand, p.watt as panel_watt, p.type as panel_type,
              i.brand as inverter_brand, i.kw as inverter_kw, i.type as inverter_type
       FROM quotations q
       JOIN users u ON u.id = q.dealer_id
       LEFT JOIN customers c ON c.id = q.customer_id
       JOIN panels p ON p.id = q.panel_id
       JOIN inverters i ON i.id = q.inverter_id
       WHERE q.id = ?`,
      [insertResult.insertId]
    );

    res.status(201).json({
      success: true,
      message: `Quotation ${quotationNumber} created successfully.`,
      quotation: quotationResult.rows[0],
    });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    await client.query("SELECT RELEASE_LOCK('quotation_number_lock')").catch(() => {});
    next(err);
  } finally {
    client.release();
  }
});

// ─── GET /api/quotations ─────────────────────────────────
// List quotations — admin sees all, dealer sees own only
router.get("/", async (req, res, next) => {
  try {
    const { status, page = 1, limit = 20, search } = req.query;
    const offset = (parseInt(page, 10) - 1) * parseInt(limit, 10);

    let whereClause = "";
    const params = [];

    // Role-based filtering
    if (req.user.role === "dealer") {
      whereClause += " AND q.dealer_id = ?";
      params.push(req.user.id);
    }

    // Status filter
    if (status) {
      whereClause += " AND q.status = ?";
      params.push(status);
    }

    // Search by quotation number or customer name (LIKE is case-insensitive in MySQL utf8mb4_unicode_ci)
    if (search) {
      whereClause += " AND (q.quotation_number LIKE ? OR c.name LIKE ?)";
      params.push(`%${search}%`, `%${search}%`);
    }

    // Count total matching rows
    const countQuery = `
      SELECT COUNT(*) as total
      FROM quotations q
      LEFT JOIN customers c ON c.id = q.customer_id
      WHERE 1=1 ${whereClause}
    `;
    const countResult = await db.query(countQuery, params);
    const total = parseInt(countResult.rows[0].total, 10);

    const reuploadJoin = `
      LEFT JOIN quotation_reupload_tokens rt
        ON rt.quotation_id = q.id
        AND rt.id = (
          SELECT id FROM quotation_reupload_tokens
          WHERE quotation_id = q.id
          ORDER BY created_at DESC LIMIT 1
        )`;

    const reuploadSelect = `,
           rt.reason        AS reupload_reason,
           rt.required_docs AS reupload_required_docs,
           rt.created_at    AS reupload_requested_at,
           rt.expires_at    AS reupload_expires_at,
           rt.used          AS reupload_used`;

    const reuploadCountSelect = `,
           (SELECT COUNT(*) FROM quotation_reupload_tokens
            WHERE quotation_id = q.id AND used = 1) AS reupload_count`;

    // Fetch paginated results with joined data
    const dataQuery = `
      SELECT q.*,
             u.name as dealer_name, u.email as dealer_email, u.mobile as dealer_mobile,
             c.name as customer_name, c.phone as customer_phone, c.email as customer_email, c.city as customer_city, c.address as customer_address,
             p.brand as panel_brand, p.watt as panel_watt, p.type as panel_type,
             i.brand as inverter_brand, i.kw as inverter_kw, i.type as inverter_type
             ${reuploadSelect}${reuploadCountSelect}
      FROM quotations q
      JOIN users u ON u.id = q.dealer_id
      LEFT JOIN customers c ON c.id = q.customer_id
      JOIN panels p ON p.id = q.panel_id
      JOIN inverters i ON i.id = q.inverter_id
      ${reuploadJoin}
      WHERE 1=1 ${whereClause}
      ORDER BY q.created_at DESC
      LIMIT ? OFFSET ?
    `;
    const dataParams = [...params, parseInt(limit, 10), offset];
    const dataResult = await db.query(dataQuery, dataParams);

    const quotations = dataResult.rows;

    if (quotations.length > 0) {
      const qIds = quotations.map(q => q.id);
      // MySQL IN clause: use dynamic placeholders
      const placeholders = qIds.map(() => "?").join(", ");
      const docsResult = await db.query(
        `SELECT id, entity_id, doc_type, original_name, mime_type, file_size_bytes, file_path, public_token, latitude, longitude
         FROM documents
         WHERE entity_type = 'quotation' AND entity_id IN (${placeholders})`,
        qIds
      );

      // Group documents by entity_id
      const docsMap = {};
      docsResult.rows.forEach(doc => {
        if (!docsMap[doc.entity_id]) {
          docsMap[doc.entity_id] = [];
        }
        docsMap[doc.entity_id].push(doc);
      });

      // Attach documents to quotations and compute expiry flag
      quotations.forEach(q => {
        q.documents = docsMap[q.id] || [];
      });
    }

    // GAP-1: Compute is_expired for all returned quotations.
    // valid_until is stored as a DATE column; compare to start-of-today to avoid
    // timezone boundary issues (a quote valid "until today" is still valid today).
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    quotations.forEach(q => {
      q.is_expired = q.valid_until
        ? new Date(q.valid_until) < todayStart
        : false;
    });

    res.json({
      success: true,
      quotations: quotations,
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

// ─── GET /api/quotations/:id ─────────────────────────────
// Get single quotation with full details
router.get("/:id", async (req, res, next) => {
  try {
    const quotationId = parseInt(req.params.id, 10);

    if (isNaN(quotationId)) {
      return res.status(400).json({ success: false, error: "Invalid quotation ID." });
    }

    const result = await db.query(
      `SELECT q.*,
              u.name as dealer_name, u.email as dealer_email, u.mobile as dealer_mobile,
              c.name as customer_name, c.phone as customer_phone, c.email as customer_email,
              c.city as customer_city, c.address as customer_address,
              p.brand as panel_brand, p.watt as panel_watt, p.type as panel_type,
              i.brand as inverter_brand, i.kw as inverter_kw, i.type as inverter_type,
              rt.reason        AS reupload_reason,
              rt.required_docs AS reupload_required_docs,
              rt.created_at    AS reupload_requested_at,
              rt.expires_at    AS reupload_expires_at,
              rt.used          AS reupload_used,
              (SELECT COUNT(*) FROM quotation_reupload_tokens WHERE quotation_id = q.id AND used = 1) AS reupload_count
       FROM quotations q
       JOIN users u ON u.id = q.dealer_id
       LEFT JOIN customers c ON c.id = q.customer_id
       JOIN panels p ON p.id = q.panel_id
       JOIN inverters i ON i.id = q.inverter_id
       LEFT JOIN quotation_reupload_tokens rt
         ON rt.quotation_id = q.id
         AND rt.id = (
           SELECT id FROM quotation_reupload_tokens
           WHERE quotation_id = q.id
           ORDER BY created_at DESC LIMIT 1
         )
       WHERE q.id = ?`,
      [quotationId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: "Quotation not found." });
    }

    const quotation = result.rows[0];

    // Access control: dealer can only view own quotations
    if (req.user.role === "dealer" && quotation.dealer_id !== req.user.id) {
      return res.status(403).json({
        success: false,
        error: "You do not have permission to view this quotation.",
      });
    }

    // GAP-1: Compute is_expired for single-get response (consistent with list endpoint).
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    quotation.is_expired = quotation.valid_until
      ? new Date(quotation.valid_until) < todayStart
      : false;

    // Also fetch associated documents
    const docsResult = await db.query(
      "SELECT id, doc_type, original_name, mime_type, file_size_bytes, uploaded_at, public_token FROM documents WHERE entity_type = 'quotation' AND entity_id = ? ORDER BY uploaded_at",
      [quotationId]
    );

    res.json({
      success: true,
      quotation,
      documents: docsResult.rows,
    });
  } catch (err) {
    next(err);
  }
});

// ─── PATCH /api/quotations/:id/status ────────────────────
// Update quotation status (admin only)
const updateStatusSchema = Joi.object({
  status: Joi.string().required().valid("Pending", "Approved", "Rejected", "ReuploadRequested"),
});

router.patch("/:id/status", authorize("admin"), validate(updateStatusSchema), async (req, res, next) => {
  try {
    const quotationId = parseInt(req.params.id, 10);
    const { status } = req.body;

    if (isNaN(quotationId)) {
      return res.status(400).json({ success: false, error: "Invalid quotation ID." });
    }

    const updateResult = await db.query(
      "UPDATE quotations SET status = ? WHERE id = ?",
      [status, quotationId]
    );

    if (updateResult.rowCount === 0) {
      return res.status(404).json({ success: false, error: "Quotation not found." });
    }

    // If approving or rejecting, invalidate any active re-upload tokens
    if (status === "Approved" || status === "Rejected") {
      await db.query(
        "UPDATE quotation_reupload_tokens SET used = 1 WHERE quotation_id = ? AND used = 0",
        [quotationId]
      );
    }

    // Fetch updated row with dealer info so we can send a notification email
    const result = await db.query(
      `SELECT q.id, q.quotation_number, q.status,
              u.name AS dealer_name, u.email AS dealer_email
       FROM quotations q
       JOIN users u ON u.id = q.dealer_id
       WHERE q.id = ?`,
      [quotationId]
    );

    const quotation = result.rows[0];

    // Send dealer notification email (fire-and-forget — failure does not block the response)
    if (quotation && (status === "Approved" || status === "Rejected")) {
      sendQuotationStatusEmail(
        quotation.dealer_email,
        quotation.dealer_name,
        quotation.quotation_number,
        status
      ).catch(err => console.error("[Email] Quotation status notification failed:", err.message));
    }

    res.json({
      success: true,
      message: `Quotation ${quotation.quotation_number} marked as ${status}.`,
      quotation: { id: quotation.id, quotation_number: quotation.quotation_number, status: quotation.status },
    });
  } catch (err) {
    next(err);
  }
});

// ─── PATCH /api/quotations/:id/delivery ──────────────────
// Update material delivery status (admin only)
const updateDeliverySchema = Joi.object({
  status: Joi.string().required().valid("Pending", "Dispatched", "Delivered"),
});

router.patch("/:id/delivery", authorize("admin"), validate(updateDeliverySchema), async (req, res, next) => {
  try {
    const quotationId = parseInt(req.params.id, 10);
    const { status } = req.body;

    if (isNaN(quotationId)) {
      return res.status(400).json({ success: false, error: "Invalid quotation ID." });
    }

    // Only allow delivery status updates on Approved quotations
    const updateResult = await db.query(
      "UPDATE quotations SET delivery_status = ? WHERE id = ? AND status = 'Approved'",
      [status, quotationId]
    );

    if (updateResult.rowCount === 0) {
      // Check if quotation exists to give a better error message
      const exists = await db.query("SELECT id, status FROM quotations WHERE id = ?", [quotationId]);
      if (exists.rows.length === 0) {
        return res.status(404).json({ success: false, error: "Quotation not found." });
      }
      return res.status(400).json({
        success: false,
        error: `Cannot update delivery status — quotation is '${exists.rows[0].status}', must be 'Approved'.`,
      });
    }

    // Fetch updated row with dealer and customer info for the milestone email
    const result = await db.query(
      `SELECT q.id, q.quotation_number, q.delivery_status, q.status,
              u.name AS dealer_name, u.email AS dealer_email,
              c.name AS customer_name
       FROM quotations q
       JOIN users u ON u.id = q.dealer_id
       LEFT JOIN customers c ON c.id = q.customer_id
       WHERE q.id = ?`,
      [quotationId]
    );

    const quotation = result.rows[0];

    // Fire-and-forget milestone email for Dispatched and Delivered
    if (quotation && (status === "Dispatched" || status === "Delivered")) {
      sendDeliveryMilestoneEmail(
        quotation.dealer_email,
        quotation.dealer_name,
        quotation.quotation_number,
        quotation.customer_name || "N/A",
        status
      ).catch(err => console.error("[Email] Delivery milestone email failed:", err.message));
    }

    res.json({
      success: true,
      message: `Quotation ${quotation.quotation_number} delivery marked as ${status}.`,
      quotation: { id: quotation.id, quotation_number: quotation.quotation_number, delivery_status: quotation.delivery_status, status: quotation.status },
    });
  } catch (err) {
    next(err);
  }
});

// ─── DELETE /api/quotations/:id ──────────────────────────
// Delete a quotation (admin or owner dealer if still Pending)
router.delete("/:id", async (req, res, next) => {
  try {
    const quotationId = parseInt(req.params.id, 10);

    if (isNaN(quotationId)) {
      return res.status(400).json({ success: false, error: "Invalid quotation ID." });
    }

    // Fetch quotation to check ownership
    const findResult = await db.query(
      "SELECT id, quotation_number, dealer_id, status FROM quotations WHERE id = ?",
      [quotationId]
    );

    if (findResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: "Quotation not found." });
    }

    const quotation = findResult.rows[0];

    // Only admin can delete, or dealer can delete their own Pending quotations
    if (req.user.role === "dealer") {
      if (quotation.dealer_id !== req.user.id) {
        return res.status(403).json({
          success: false,
          error: "You can only delete your own quotations.",
        });
      }
      if (quotation.status !== "Pending") {
        return res.status(400).json({
          success: false,
          error: "Only pending quotations can be deleted.",
        });
      }
    }

    await db.query("DELETE FROM quotations WHERE id = ?", [quotationId]);

    res.json({
      success: true,
      message: `Quotation ${quotation.quotation_number} deleted.`,
    });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/quotations/:id/request-reupload ────────────────
// Admin only — Request dealer to re-upload documents/geotags.
const requestReuploadSchema = Joi.object({
  reason: Joi.string().required(),
  documents: Joi.array().items(
    Joi.string().valid(
      "aadhaar", "pan", "passbook", "site_photo", "vera_bill",
      "house_photo_1", "house_photo_2", "house_photo_3",
      "geotag_1", "geotag_2", "geotag_3"
    )
  ).min(1).required(),
});

router.post("/:id/request-reupload", authorize("admin"), validate(requestReuploadSchema), async (req, res, next) => {
  try {
    const quotationId = parseInt(req.params.id, 10);

    if (isNaN(quotationId)) {
      return res.status(400).json({ success: false, error: "Invalid quotation ID." });
    }

    const { reason, documents } = req.body;

    // Fetch the quotation — must be Pending, Rejected, or ReuploadRequested
    const qResult = await db.query(
      `SELECT q.id, q.quotation_number, q.status, q.customer_id,
              u.name AS dealer_name, u.email AS dealer_email,
              c.name AS customer_name
       FROM quotations q
       JOIN users u ON u.id = q.dealer_id
       LEFT JOIN customers c ON c.id = q.customer_id
       WHERE q.id = ? AND q.status IN ('Pending', 'Rejected', 'ReuploadRequested')`,
      [quotationId]
    );

    if (qResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Quotation not found or is not in a state that allows re-upload requests.",
      });
    }

    const q = qResult.rows[0];

    // Invalidate any existing unused re-upload tokens for this quotation
    await db.query(
      "UPDATE quotation_reupload_tokens SET used = 1 WHERE quotation_id = ? AND used = 0",
      [quotationId]
    );

    // Generate a secure random token (raw token goes in email, hash goes in DB)
    const rawToken = crypto.randomBytes(32).toString("hex");
    const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
    const requiredDocsStr = documents.join(",");

    // Store token in DB with 72-hour expiry (3 days)
    await db.query(
      `INSERT INTO quotation_reupload_tokens (quotation_id, token, reason, required_docs, expires_at)
       VALUES (?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL 72 HOUR))`,
      [quotationId, tokenHash, reason.trim(), requiredDocsStr]
    );

    // Update quotation status to ReuploadRequested and save rejection note
    await db.query(
      `UPDATE quotations 
       SET status = 'ReuploadRequested', rejection_reason = ? 
       WHERE id = ?`,
      [reason.trim(), quotationId]
    );

    // Build re-upload URL and send email (fire-and-forget)
    const reuploadUrl = `${env.clientUrl}?q_reupload=${rawToken}`;
    sendQuotationReuploadEmail(
      q.dealer_email,
      q.dealer_name,
      q.customer_name || "Valued Customer",
      q.quotation_number,
      reuploadUrl,
      reason.trim(),
      documents
    ).catch(err => console.error(`[EMAIL] Failed to send quotation re-upload email to ${q.dealer_email}:`, err.message));

    console.log(`[AUDIT] Quotation re-upload requested: admin ID ${req.user.id} requested re-upload for quotation ID ${quotationId} (${q.quotation_number})`);

    res.json({
      success: true,
      message: `Re-upload request sent to dealer ${q.dealer_name} for quotation ${q.quotation_number}.`,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
