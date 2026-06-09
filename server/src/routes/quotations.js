import { Router } from "express";
import Joi from "joi";
import crypto from "crypto";
import path from "path";
import { promises as fs } from "fs";
import { fileURLToPath } from "url";

import db from "../config/database.js";
import env from "../config/env.js";
import { authenticate, authorize } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { sendQuotationStatusEmail, sendDeliveryMilestoneEmail, sendPortalReuploadNotificationEmail, sendGeotagReuploadEmail, sendQuotationReuploadConfirmationEmail } from "../services/emailService.js";
import { broadcastToRole, broadcastToUser } from "../utils/sseManager.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);


const router = Router();

// All quotation routes require authentication
router.use(authenticate);

// ─── GET /api/quotations/stats ───────────────────────────
// Admin & dealer — lightweight counts per status + re-upload review counts.
// Must be before /:id routes to avoid being parsed as an :id param.
router.get("/stats", authorize("admin"), async (req, res, next) => {
  try {
    const result = await db.query(`
      SELECT
        COUNT(*)                                            AS total,
        SUM(status = 'Pending')                             AS pending,
        SUM(status = 'Approved')                            AS approved,
        SUM(status = 'Rejected')                            AS rejected,
        SUM(status = 'ReuploadRequested')                   AS reupload_requested,
        SUM(needs_review_after_reupload = 1)                AS docs_needs_review,
        SUM(geotag_needs_review = 1)                        AS geotag_needs_review
      FROM quotations
    `);
    const row = result.rows[0];
    res.json({
      success: true,
      stats: {
        total:             parseInt(row.total, 10)              || 0,
        pending:           parseInt(row.pending, 10)            || 0,
        approved:          parseInt(row.approved, 10)           || 0,
        rejected:          parseInt(row.rejected, 10)           || 0,
        reuploadRequested: parseInt(row.reupload_requested, 10) || 0,
        docsNeedsReview:   parseInt(row.docs_needs_review, 10)  || 0,
        geotagNeedsReview: parseInt(row.geotag_needs_review, 10)|| 0,
      },
    });
  } catch (err) { next(err); }
});

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

    // MySQL advisory lock prevents concurrent quotation number generation.
    // GET_LOCK returns 1 on success, 0 on timeout, NULL on error.
    // We must check the return value — a silent 0 means we are NOT holding
    // the lock and proceeding would risk a duplicate quotation number.
    const lockResult = await client.query("SELECT GET_LOCK('quotation_number_lock', 10) as locked");
    const lockAcquired = lockResult.rows?.[0]?.locked;
    if (lockAcquired !== 1) {
      await client.query("ROLLBACK");
      console.error(`[LOCK] Failed to acquire quotation_number_lock — returned: ${lockAcquired}`);
      return res.status(503).json({
        success: false,
        error: "Server is busy processing another quotation. Please try again in a moment.",
      });
    }

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

    // Notify all admin tabs that a new quotation arrived
    broadcastToRole("admin", "quotation:new", {
      id: quotationResult.rows[0]?.id,
      quotation_number: quotationNumber,
      dealer_name: quotationResult.rows[0]?.dealer_name,
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

    const reuploadJoin = ``;

    const reuploadSelect = `,
           q.rejection_reason          AS reupload_reason,
           q.reupload_required_docs    AS reupload_required_docs,
           q.geotag_reupload_requested AS geotag_reupload_requested,
           q.geotag_reupload_reason    AS geotag_reupload_reason,
           q.geotag_uploaded           AS geotag_uploaded,
           q.geotag_submitted          AS geotag_submitted,
           q.geotag_reupload_slots     AS geotag_reupload_slots`;

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

    // If approving or rejecting, invalidate any active re-upload tokens and clear review flags
    if (status === "Approved" || status === "Rejected") {
      await db.query(
        "UPDATE quotation_reupload_tokens SET used = 1 WHERE quotation_id = ? AND used = 0",
        [quotationId]
      );
      // Clear re-upload review flags so amber badges reset after admin action
      await db.query(
        "UPDATE quotations SET needs_review_after_reupload = 0, geotag_needs_review = 0 WHERE id = ?",
        [quotationId]
      );
    }

    // Fetch updated row with dealer info so we can send a notification email
    const result = await db.query(
      `SELECT q.id, q.dealer_id, q.quotation_number, q.status,
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

    // Notify all admins and the specific dealer about the status change
    broadcastToRole("admin", "quotation:status_changed", { id: quotationId, status });
    broadcastToUser(quotation.dealer_id, "quotation:status_changed", { id: quotationId, status });
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
      `SELECT q.id, q.dealer_id, q.quotation_number, q.delivery_status, q.status,
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

    // Notify all admins and the specific dealer about the delivery status change
    broadcastToRole("admin", "quotation:delivery_changed", { id: quotationId, delivery_status: status });
    broadcastToUser(quotation.dealer_id, "quotation:delivery_changed", { id: quotationId, delivery_status: status });
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

    // Start transaction to delete quotation, associated documents, re-upload tokens, and files on disk
    const client = await db.getClient();
    try {
      await client.query("BEGIN");

      // 1. Fetch associated documents to delete files on disk
      const docsResult = await client.query(
        "SELECT id, file_path FROM documents WHERE entity_type = 'quotation' AND entity_id = ?",
        [quotationId]
      );

      // Resolve uploads directory
      const UPLOADS_DIR = path.normalize(
        path.isAbsolute(env.upload.dir)
          ? env.upload.dir
          : path.resolve(__dirname, "../..", env.upload.dir)
      );

      // 2. Delete physical files from disk
      for (const doc of docsResult.rows) {
        const absPath = path.normalize(path.join(UPLOADS_DIR, doc.file_path));
        if (absPath.startsWith(UPLOADS_DIR + path.sep)) {
          await fs.unlink(absPath).catch(() => {});
        }
      }

      // 3. Delete document records from database
      await client.query(
        "DELETE FROM documents WHERE entity_type = 'quotation' AND entity_id = ?",
        [quotationId]
      );

      // 4. Delete associated re-upload tokens
      await client.query(
        "DELETE FROM quotation_reupload_tokens WHERE quotation_id = ?",
        [quotationId]
      );

      // 5. Delete the quotation itself
      await client.query("DELETE FROM quotations WHERE id = ?", [quotationId]);

      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }

    res.json({
      success: true,
      message: `Quotation ${quotation.quotation_number} and all associated files/documents deleted.`,
    });

    // Notify admins that a quotation was deleted
    broadcastToRole("admin", "quotation:deleted", { id: quotationId });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/quotations/:id/request-reupload ────────────────
// Admin only — Request dealer to re-upload specific quotation documents via the portal.
// Documents are flagged on the quotation directly (no external token link generated).
const requestReuploadSchema = Joi.object({
  reason: Joi.string().required(),
  documents: Joi.array().items(
    Joi.string().valid(
      "aadhaar", "pan", "passbook", "light_bill", "vera_bill",
      "house_photo_1", "house_photo_2", "house_photo_3"
      // Note: geotag_1/2/3 are handled by /request-geotag-reupload below
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
      `SELECT q.id, q.quotation_number, q.status, q.customer_id, q.dealer_id,
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
    const requiredDocsStr = documents.join(",");

    // Store required docs and reason directly on the quotation (portal-based flow)
    await db.query(
      `UPDATE quotations
       SET status = 'ReuploadRequested', rejection_reason = ?, reupload_required_docs = ?
       WHERE id = ?`,
      [reason.trim(), requiredDocsStr, quotationId]
    );

    // Send portal notification email — no token link, dealer logs in directly
    sendPortalReuploadNotificationEmail(
      q.dealer_email,
      q.dealer_name,
      q.customer_name || "Valued Customer",
      q.quotation_number,
      reason.trim(),
      documents
    ).catch(err => console.error(`[EMAIL] Failed to send portal re-upload notification to ${q.dealer_email}:`, err.message));

    console.log(`[AUDIT] Portal document re-upload requested: admin ${req.user.id} → quotation ${quotationId} (${q.quotation_number})`);

    res.json({
      success: true,
      message: `Re-upload request sent to dealer ${q.dealer_name} for quotation ${q.quotation_number}.`,
    });

    // Notify the specific dealer that their quotation needs document re-upload
    broadcastToUser(q.dealer_id || req.user.id, "quotation:reupload_requested", {
      id: quotationId,
      quotation_number: q.quotation_number,
    });
    // Notify all admins that the status changed to ReuploadRequested
    broadcastToRole("admin", "quotation:status_changed", { id: quotationId, status: "ReuploadRequested" });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/quotations/:id/submit-portal-reupload ──────────
// Dealer only — Submit replacement documents via the portal.
// Uses the dealer's main auth JWT (no reupload token needed).
router.post("/:id/submit-portal-reupload", authorize("dealer"), async (req, res, next) => {
  try {
    const quotationId = parseInt(req.params.id, 10);
    if (isNaN(quotationId)) {
      return res.status(400).json({ success: false, error: "Invalid quotation ID." });
    }

    // Verify the quotation belongs to this dealer and is in ReuploadRequested status
    const qResult = await db.query(
      `SELECT q.id, q.quotation_number, q.status, q.reupload_required_docs, q.customer_id,
              u.name AS dealer_name, u.email AS dealer_email,
              c.name AS customer_name
       FROM quotations q
       JOIN users u ON u.id = q.dealer_id
       LEFT JOIN customers c ON c.id = q.customer_id
       WHERE q.id = ? AND q.dealer_id = ? AND q.status = 'ReuploadRequested'`,
      [quotationId, req.user.id]
    );

    if (qResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Quotation not found, does not belong to you, or is not in re-upload requested state.",
      });
    }

    const q = qResult.rows[0];

    // Admin MUST have specified which docs to reupload — no fallback
    if (!q.reupload_required_docs) {
      return res.status(400).json({
        success: false,
        error: "No specific documents have been flagged for re-upload. Please contact admin.",
      });
    }

    const docsToProcess = q.reupload_required_docs.split(",").filter(Boolean);
    const filesPayload = req.body || {};

    // ── Aadhaar expansion ───────────────────────────────────────────────────
    // Admin always requests "aadhaar". Dealer chooses format at upload time:
    //   photos mode → sends payload.aadhaar_front + payload.aadhaar_back
    //   PDF mode    → sends payload.aadhaar
    // Build the actual list of doc types we will write, resolving the choice.
    const aadhaarNeeded = docsToProcess.includes("aadhaar");
    const hasAadhaarPdf    = aadhaarNeeded && !!filesPayload.aadhaar;
    const hasAadhaarPhotos = aadhaarNeeded && !!filesPayload.aadhaar_front && !!filesPayload.aadhaar_back;
    const aadhaarSatisfied = hasAadhaarPdf || hasAadhaarPhotos;

    // Expand docsToProcess: replace "aadhaar" with the actual sub-types the dealer sent
    const effectiveDocs = docsToProcess.flatMap(d => {
      if (d !== "aadhaar") return [d];
      if (hasAadhaarPhotos) return ["aadhaar_front", "aadhaar_back"];
      if (hasAadhaarPdf)    return ["aadhaar"];
      return ["aadhaar"]; // will fail validation below
    });

    // Validate: all admin-required docs must be satisfied
    const missingDocs = docsToProcess.filter(d => {
      if (d === "aadhaar") return !aadhaarSatisfied;
      return !filesPayload[d];
    });
    if (missingDocs.length > 0) {
      const docLabels = {
        aadhaar:       aadhaarNeeded && !aadhaarSatisfied
          ? (filesPayload.aadhaar_front && !filesPayload.aadhaar_back
              ? "Aadhaar Card — Back Side (missing)"
              : "Aadhaar Card (upload PDF or both Front + Back photos)")
          : "Aadhaar Card",
        pan:           "PAN Card",
        passbook:      "Bank Passbook",
        light_bill:    "Latest Light Bill",
        vera_bill:     "Vera Bill",
        house_photo_1: "House Photo 1",
        house_photo_2: "House Photo 2",
        house_photo_3: "House Photo 3",
      };
      return res.status(400).json({
        success: false,
        error: `Missing required documents: ${missingDocs.map(d => docLabels[d] || d).join(", ")}`,
      });
    }

    // Resolve uploads directory
    const uploadsBase = path.isAbsolute(env.upload.dir)
      ? env.upload.dir
      : path.resolve(__dirname, "../..", env.upload.dir);

    const ALLOWED_MIME = {
      aadhaar:       ["image/jpeg", "image/png", "image/webp", "application/pdf"],
      aadhaar_front: ["image/jpeg", "image/png", "image/webp", "application/pdf"],
      aadhaar_back:  ["image/jpeg", "image/png", "image/webp", "application/pdf"],
      pan:           ["image/jpeg", "image/png", "image/webp", "application/pdf"],
      passbook:      ["image/jpeg", "image/png", "image/webp", "application/pdf"],
      light_bill:    ["image/jpeg", "image/png", "image/webp", "application/pdf"],
      vera_bill:     ["image/jpeg", "image/png", "image/webp", "application/pdf"],
      house_photo_1: ["image/jpeg", "image/png", "image/webp"],
      house_photo_2: ["image/jpeg", "image/png", "image/webp"],
      house_photo_3: ["image/jpeg", "image/png", "image/webp"],
    };

    const client = await db.getClient();
    try {
      await client.query("BEGIN");

      // Delete old documents for the types being re-uploaded.
      // For Aadhaar, always delete ALL three variants so no stale docs remain
      // when dealer switches between PDF and two-photo modes.
      const deleteTypes = aadhaarNeeded
        ? [...docsToProcess.filter(d => d !== "aadhaar"), "aadhaar", "aadhaar_front", "aadhaar_back"]
        : docsToProcess;
      const placeholders = deleteTypes.map(() => "?").join(", ");
      const oldDocsResult = await client.query(
        `SELECT id, file_path FROM documents
         WHERE entity_type = 'quotation' AND entity_id = ? AND doc_type IN (${placeholders})`,
        [quotationId, ...deleteTypes]
      );

      for (const doc of oldDocsResult.rows) {
        const oldAbsPath = path.normalize(path.join(uploadsBase, doc.file_path));
        if (oldAbsPath.startsWith(uploadsBase + path.sep)) {
          try { await fs.unlink(oldAbsPath); } catch { /* file missing, ignore */ }
        }
      }

      await client.query(
        `DELETE FROM documents WHERE entity_type = 'quotation' AND entity_id = ? AND doc_type IN (${placeholders})`,
        [quotationId, ...deleteTypes]
      );

      // Save new files (base64 payload: { data, name, type, size })
      for (const docType of effectiveDocs) {
        const fileObj = filesPayload[docType];
        if (!fileObj?.data || !fileObj?.name || !fileObj?.type) {
          throw new Error(`Invalid file payload for ${docType}`);
        }

        // Validate MIME type
        const allowed = ALLOWED_MIME[docType] || ["image/jpeg", "image/png", "image/webp", "application/pdf"];
        if (!allowed.includes(fileObj.type)) {
          throw new Error(`Invalid file type for ${docType}: ${fileObj.type}`);
        }

        // Decode base64 and save file
        // Cross-validate: MIME in data URI must match declared type
        const dataUriMatch = fileObj.data.match(/^data:([^;]+);base64,/);
        const dataUriMime = dataUriMatch ? dataUriMatch[1] : null;
        if (!dataUriMime || dataUriMime !== fileObj.type) {
          throw new Error(`MIME type mismatch for ${docType}: declared '${fileObj.type}' but data URI contains '${dataUriMime}'.`);
        }

        const base64Data = fileObj.data.replace(/^data:[^;]+;base64,/, "");
        const buffer = Buffer.from(base64Data, "base64");

        // Magic-byte verification — mirrors the check in uploads.js.
        // Validates the actual decoded bytes match the MIME's known signature,
        // preventing disguised uploads (e.g. an EXE with a crafted JPEG data URI).
        const MAGIC_SIGNATURES = new Map([
          ["image/jpeg",      [[0xFF, 0xD8, 0xFF]]],
          ["image/png",       [[0x89, 0x50, 0x4E, 0x47]]],
          ["image/webp",      [[0x52, 0x49, 0x46, 0x46]]],
          ["application/pdf", [[0x25, 0x50, 0x44, 0x46]]],
        ]);
        const magicSigs = MAGIC_SIGNATURES.get(fileObj.type);
        if (!magicSigs) {
          throw new Error(`Unsupported file type for ${docType}: '${fileObj.type}'.`);
        }
        const isValidMagic = magicSigs.some(sig =>
          sig.every((byte, i) => buffer[i] === byte)
        );
        if (!isValidMagic) {
          throw new Error(
            `File content for ${docType} does not match its declared type ('${fileObj.type}'). ` +
            `The file may be corrupted or disguised.`
          );
        }

        const ext = fileObj.name.split(".").pop().toLowerCase() || "bin";
        const safeExt = ext.replace(/[^a-z0-9]/g, "").slice(0, 10);
        const fileName = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${safeExt}`;
        const relPath = path.join("quotation", String(quotationId), fileName);
        const absPath = path.join(uploadsBase, relPath);

        await fs.mkdir(path.dirname(absPath), { recursive: true });
        await fs.writeFile(absPath, buffer);

        await client.query(
          `INSERT INTO documents (entity_type, entity_id, doc_type, original_name, file_path, mime_type, file_size_bytes, public_token, uploaded_by)
           VALUES ('quotation', ?, ?, ?, ?, ?, ?, ?, ?)`,
          [quotationId, docType, fileObj.name, relPath.replace(/\\/g, "/"), fileObj.type, buffer.length, crypto.randomUUID(), req.user.id]
        );
      }

      // Clear reupload flag and set status back to Pending, notify admin for review
      await client.query(
        `UPDATE quotations SET status = 'Pending', reupload_required_docs = NULL, needs_review_after_reupload = 1 WHERE id = ?`,
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
      q.dealer_email,
      q.dealer_name,
      q.customer_name || "Valued Customer",
      q.quotation_number
    ).catch(err => console.error(`[EMAIL] Failed to send re-upload confirmation:`, err.message));

    console.log(`[AUDIT] Portal doc re-upload submitted: dealer ${req.user.id} → quotation ${quotationId} (${q.quotation_number})`);

    res.json({
      success: true,
      message: "Documents re-uploaded successfully. Your quotation is now back under review.",
    });

    // Notify all admins that a quotation came back to Pending and needs review
    broadcastToRole("admin", "quotation:status_changed", {
      id: quotationId,
      quotation_number: q.quotation_number,
      status: "Pending",
      needs_review: true,
    });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/quotations/:id/request-geotag-reupload ─────────
// Admin only — Flag that specific geo-tag photo slots need re-upload.
// Body: { reason: string, slots: ["geotag_1","geotag_2","geotag_3"] }
router.post("/:id/request-geotag-reupload", authorize("admin"), async (req, res, next) => {
  try {
    const quotationId = parseInt(req.params.id, 10);
    if (isNaN(quotationId)) {
      return res.status(400).json({ success: false, error: "Invalid quotation ID." });
    }

    const { reason, slots } = req.body;
    if (!reason || !reason.trim()) {
      return res.status(400).json({ success: false, error: "Please provide a reason for requesting geo-tag re-upload." });
    }

    // Validate slots
    const VALID_SLOTS = ["geotag_1", "geotag_2", "geotag_3"];
    const requestedSlots = Array.isArray(slots) && slots.length > 0
      ? slots.filter(s => VALID_SLOTS.includes(s))
      : VALID_SLOTS; // default: all 3
    if (requestedSlots.length === 0) {
      return res.status(400).json({ success: false, error: "Please select at least one geo-tag photo slot." });
    }

    // Only allowed on Approved quotations WHERE geo-tags have been uploaded at least once
    const qResult = await db.query(
      `SELECT q.id, q.quotation_number, q.status, q.geotag_submitted, q.dealer_id,
              u.name AS dealer_name, u.email AS dealer_email
       FROM quotations q
       JOIN users u ON u.id = q.dealer_id
       WHERE q.id = ? AND q.status = 'Approved'`,
      [quotationId]
    );

    if (qResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Quotation not found or is not in Approved status.",
      });
    }

    const q = qResult.rows[0];

    // Guard: dealer must have submitted geo-tags at least once before admin can request re-upload
    if (!q.geotag_submitted) {
      return res.status(400).json({
        success: false,
        error: "Dealer has not submitted any geo-tag photos yet. Re-upload can only be requested after the dealer's first submission.",
      });
    }

    // Set the flag and store which specific slots need re-upload
    const slotsStr = requestedSlots.join(",");
    await db.query(
      `UPDATE quotations
       SET geotag_reupload_requested = 1,
           geotag_reupload_reason    = ?,
           geotag_reupload_slots     = ?
       WHERE id = ?`,
      [reason.trim(), slotsStr, quotationId]
    );

    // Send notification email (fire-and-forget)
    sendGeotagReuploadEmail(
      q.dealer_email,
      q.dealer_name,
      q.quotation_number,
      reason.trim()
    ).catch(err => console.error(`[EMAIL] Geotag re-upload email failed:`, err.message));

    console.log(`[AUDIT] Geo-tag re-upload requested: admin ${req.user.id} → quotation ${quotationId} (${q.quotation_number}) slots: ${slotsStr}`);

    res.json({
      success: true,
      message: `Geo-tag re-upload request sent to dealer ${q.dealer_name}.`,
      slots: requestedSlots,
    });

    // Notify the specific dealer that geo-tag photos need re-upload
    broadcastToUser(q.dealer_id || req.user.id, "quotation:geotag_reupload_requested", {
      id: quotationId,
      quotation_number: q.quotation_number,
      slots: requestedSlots,
    });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/quotations/:id/submit-geotag ────────────────────
// Dealer only — Explicitly submit geo-tag photos, locking them.
// For first-time: requires all 3 slots to have docs.
// For re-upload: requires all admin-requested slots to have docs.
router.post("/:id/submit-geotag", authorize("dealer"), async (req, res, next) => {
  try {
    const quotationId = parseInt(req.params.id, 10);
    if (isNaN(quotationId)) {
      return res.status(400).json({ success: false, error: "Invalid quotation ID." });
    }

    // Verify quotation belongs to this dealer and is Approved
    const qResult = await db.query(
      `SELECT q.id, q.quotation_number, q.status, q.geotag_submitted,
              q.geotag_reupload_requested, q.geotag_reupload_slots
       FROM quotations q
       WHERE q.id = ? AND q.dealer_id = ? AND q.status = 'Approved'`,
      [quotationId, req.user.id]
    );

    if (qResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Quotation not found, does not belong to you, or is not in Approved status.",
      });
    }

    const q = qResult.rows[0];
    const GEOTAG_SLOTS = ["geotag_1", "geotag_2", "geotag_3"];
    const isReupload = !!q.geotag_reupload_requested;

    // Determine which slots are required for this submission
    const requiredSlots = isReupload && q.geotag_reupload_slots
      ? q.geotag_reupload_slots.split(",").filter(Boolean)
      : GEOTAG_SLOTS; // first-time: all 3 required

    // Validate all required slots have uploaded docs
    const placeholders = requiredSlots.map(() => "?").join(",");
    const docsResult = await db.query(
      `SELECT doc_type FROM documents
       WHERE entity_type = 'quotation' AND entity_id = ? AND doc_type IN (${placeholders})`,
      [quotationId, ...requiredSlots]
    );
    const uploadedSlots = new Set(docsResult.rows.map(r => r.doc_type));
    const missingSlots = requiredSlots.filter(s => !uploadedSlots.has(s));

    if (missingSlots.length > 0) {
      const SLOT_LABELS = { geotag_1: "Site / Inverter Photo", geotag_2: "Solar Panels Photo", geotag_3: "ACDB / Net Meter Photo" };
      return res.status(400).json({
        success: false,
        error: `Please upload photos for all required slots before submitting: ${missingSlots.map(s => SLOT_LABELS[s] || s).join(", ")}.`,
      });
    }

    // Build UPDATE — always set geotag_submitted=1
    // If re-upload: clear flags and notify admin via geotag_needs_review=1
    if (isReupload) {
      await db.query(
        `UPDATE quotations
         SET geotag_submitted = 1,
             geotag_reupload_requested = 0,
             geotag_reupload_reason    = NULL,
             geotag_reupload_slots     = NULL,
             geotag_needs_review       = 1
         WHERE id = ?`,
        [quotationId]
      );
    } else {
      await db.query(
        `UPDATE quotations SET geotag_submitted = 1 WHERE id = ?`,
        [quotationId]
      );
    }

    console.log(`[AUDIT] Geo-tag photos submitted: dealer ${req.user.id} → quotation ${quotationId} (${q.quotation_number}) isReupload=${isReupload}`);

    res.json({
      success: true,
      message: "Geo-tag photos submitted successfully.",
      isReupload,
    });

    // Notify all admins that a dealer submitted geo-tag photos (needs review if re-upload)
    broadcastToRole("admin", "quotation:geotag_submitted", {
      id: quotationId,
      quotation_number: q.quotation_number,
      isReupload,
      needs_review: isReupload,
    });
  } catch (err) {
    next(err);
  }
});

// ─── PATCH /api/quotations/:id/clear-geotag-reupload ──────────
// Called after dealer uploads all requested geo-tag slots, or by admin to manually clear.
router.patch("/:id/clear-geotag-reupload", authenticate, async (req, res, next) => {
  try {
    const quotationId = parseInt(req.params.id, 10);
    if (isNaN(quotationId)) {
      return res.status(400).json({ success: false, error: "Invalid quotation ID." });
    }

    let whereExtra = "";
    const params = [quotationId];
    if (req.user.role === "dealer") {
      whereExtra = " AND dealer_id = ?";
      params.push(req.user.id);
    }

    await db.query(
      `UPDATE quotations
       SET geotag_reupload_requested = 0,
           geotag_reupload_reason    = NULL,
           geotag_reupload_slots     = NULL,
           geotag_needs_review       = 0
       WHERE id = ?${whereExtra}`,
      params
    );

    res.json({ success: true });

    // Notify the dealer (or admin) that the geotag re-upload flag has been cleared
    if (req.user.role === "admin") {
      // Admin manually cleared — notify all admins (including self) to refresh
      broadcastToRole("admin", "quotation:status_changed", { id: quotationId });
    } else {
      // Dealer triggered clear — notify admins
      broadcastToRole("admin", "quotation:status_changed", { id: quotationId });
    }
  } catch (err) {
    next(err);
  }
});


export default router;
