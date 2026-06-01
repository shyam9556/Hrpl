import { Router } from "express";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import { fileURLToPath } from "url";
import rateLimit from "express-rate-limit";

import db from "../config/database.js";
import env from "../config/env.js";
import { authenticate, authorize } from "../middleware/auth.js";
import { uploadSingle, uploadMultiple, handleUploadError } from "../middleware/upload.js";

// ─── Uploads Directory ───────────────────────────────────
// Resolved once at module load to an absolute, normalised path.
// In production set UPLOAD_DIR=/var/www/highlight-pro/uploads in .env
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const UPLOADS_DIR = path.normalize(
  path.isAbsolute(env.upload.dir)
    ? env.upload.dir
    : path.resolve(__dirname, "../..", env.upload.dir)
);
// Canonical prefix used in all boundary checks (always ends with sep)
const UPLOADS_PREFIX = UPLOADS_DIR + path.sep;

const router = Router();

// Rate limiter for the public token endpoint — prevents brute-force enumeration
// of public_token values. Tokens are UUIDs so enumeration is computationally
// infeasible, but rate limiting provides defense-in-depth.
const publicTokenLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  message: { success: false, error: "Too many requests. Please try again later." },
  standardHeaders: true,
  legacyHeaders: false,
});

// ─── safeResolvePath ─────────────────────────────────────
// Resolves a DB-stored relative path to a normalised absolute path and
// verifies it is strictly inside UPLOADS_DIR (OWASP path-traversal defence).
// Returns null if the resulting path escapes the uploads directory.
function safeResolvePath(relativePath) {
  // path.normalize collapses any ".." segments before we check containment
  const resolved = path.normalize(path.join(UPLOADS_DIR, relativePath));
  if (!resolved.startsWith(UPLOADS_PREFIX)) return null;
  return resolved;
}

// ─── safeUnlink ──────────────────────────────────────────
// Deletes a file only if it is inside UPLOADS_DIR.
// Used to clean up multer-written files on error paths.
function safeUnlink(filePath) {
  if (!filePath) return;
  const normalised = path.normalize(filePath);
  // Path is normalize()d and startsWith(UPLOADS_PREFIX) guards both fs calls below.
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  if (normalised.startsWith(UPLOADS_PREFIX) && fs.existsSync(normalised)) {
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    fs.unlinkSync(normalised);
  }
}

// ─── Magic Byte Verification ─────────────────────────────
// Verify that the uploaded file's content matches its declared MIME type.
// Uses a closed Map — prototype-safe, no bracket access on user-supplied keys.
const MAGIC_SIGNATURES = new Map([
  ["image/jpeg",      [[0xFF, 0xD8, 0xFF]]],
  ["image/png",       [[0x89, 0x50, 0x4E, 0x47]]],
  ["image/webp",      [[0x52, 0x49, 0x46, 0x46]]], // "RIFF"
  ["application/pdf", [[0x25, 0x50, 0x44, 0x46]]], // "%PDF"
]);

async function verifyFileMagicBytes(filePath, declaredMimeType) {
  try {
    // Lookup via Map.get() — immune to prototype-pollution attacks
    const signatures = MAGIC_SIGNATURES.get(declaredMimeType);
    if (!signatures) return false; // Type not in allowlist — reject

    // Only open a file that multer placed inside UPLOADS_DIR.
    // path.normalize + startsWith(UPLOADS_PREFIX) guard ensures containment.
    const normalisedPath = path.normalize(filePath);
    if (!normalisedPath.startsWith(UPLOADS_PREFIX)) return false;

    // Path is containment-verified above — safe to open.
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    const fd = fs.openSync(normalisedPath, "r");
    const buffer = Buffer.alloc(8);
    fs.readSync(fd, buffer, 0, 8, 0);
    fs.closeSync(fd);

    // `i` is Array.prototype.every's loop counter (not user input).
    // eslint-disable-next-line security/detect-object-injection
    return signatures.some(sig => sig.every((byte, i) => buffer[i] === byte));
  } catch {
    return false;
  }
}

// ─── GET /api/uploads/public/:token ──────────────────────
// Public endpoint — view a file via its public token (e.g. WhatsApp sharing)
router.get("/public/:token", publicTokenLimiter, async (req, res, next) => {
  try {
    const token = req.params.token;
    const result = await db.query(
      "SELECT * FROM documents WHERE public_token = ?",
      [token]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: "Document not found." });
    }

    const doc = result.rows[0];

    // file_path is a DB-stored relative path written by our server using a UUID filename.
    // safeResolvePath: normalises the path and validates it is inside UPLOADS_DIR.
    // The null-check on the next line ensures we never reach any fs call with an unsafe path.
    const absolutePath = safeResolvePath(doc.file_path);
    if (!absolutePath) {
      return res.status(403).json({ success: false, error: "Access denied." });
    }

    // absolutePath has been validated by safeResolvePath() — containment confirmed.
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    if (!fs.existsSync(absolutePath)) {
      return res.status(404).json({ success: false, error: "File not found on server. It may have been deleted." });
    }

    res.setHeader("Content-Type", doc.mime_type);
    res.setHeader("Content-Disposition", `inline; filename="${encodeURIComponent(doc.original_name)}"`);

    // res.sendFile() reads Content-Length from the actual file size on disk (via stat()),
    // which eliminates the Content-Length mismatch bug caused by the DB storing the
    // original browser file size (before canvas compression on the frontend).
    // It also handles all stream errors, connection aborts, and Range requests internally.
    // absolutePath is already validated by safeResolvePath() above — safe to send directly.
    // We pass it as a relative path from its own directory to make Express happy on all platforms.
    const dir = path.dirname(absolutePath);
    const base = path.basename(absolutePath);
    res.sendFile(base, { root: dir }, (err) => {
      if (err && !res.headersSent) {
        next(err);
      }
      // If headers were already sent (streaming started), sendFile handles cleanup internally.
    });
  } catch (err) {
    next(err);
  }
});

// All routes below require authentication
router.use(authenticate);

// ─── POST /api/uploads/single ────────────────────────────
// Upload a single file and link it to an entity.
// Body: entityType, entityId, docType, latitude?, longitude?
router.post("/single", uploadSingle("file"), handleUploadError, async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: "No file uploaded." });
    }

    const { entityType, entityId, docType, latitude, longitude } = req.body;

    if (!entityType || !entityId || !docType) {
      safeUnlink(req.file.path);
      return res.status(400).json({ success: false, error: "Missing required fields: entityType, entityId, docType" });
    }

    // Closed allowlists — only these string literals are ever accepted
    const VALID_ENTITY_TYPES = ["quotation", "dealer_registration", "customer"];
    const VALID_DOC_TYPES    = [
      "aadhaar", "aadhaar_front", "aadhaar_back",
      "pan", "passbook", "site_photo", "passport_photo",
      "other", "geotag_1", "geotag_2", "geotag_3",
      "vera_bill", "house_photo_1", "house_photo_2", "house_photo_3",
    ];

    if (!VALID_ENTITY_TYPES.includes(entityType)) {
      safeUnlink(req.file.path);
      return res.status(400).json({ success: false, error: `Invalid entityType. Must be one of: ${VALID_ENTITY_TYPES.join(", ")}` });
    }
    if (!VALID_DOC_TYPES.includes(docType)) {
      safeUnlink(req.file.path);
      return res.status(400).json({ success: false, error: `Invalid docType. Must be one of: ${VALID_DOC_TYPES.join(", ")}` });
    }

    // Verify file magic bytes — rejects disguised files
    const isValidMagic = await verifyFileMagicBytes(req.file.path, req.file.mimetype);
    if (!isValidMagic) {
      safeUnlink(req.file.path);
      return res.status(400).json({ success: false, error: "File content does not match its declared type. The file may be corrupted or disguised." });
    }

    // ── Geotag Slot Deduplication ─────────────────────────────────────────
    // If uploading a geotag to a slot that already has a document, atomically
    // remove the old file on disk and its DB record before inserting the new
    // one. This guarantees exactly one document per slot and prevents orphaned
    // records from appearing on page refresh.
    const GEOTAG_TYPES = ["geotag_1", "geotag_2", "geotag_3"];
    if (GEOTAG_TYPES.includes(docType)) {
      const existingResult = await db.query(
        "SELECT id, file_path FROM documents WHERE entity_type = ? AND entity_id = ? AND doc_type = ?",
        [entityType, parseInt(entityId, 10), docType]
      );
      for (const oldDoc of existingResult.rows) {
        // safeResolvePath validates the path is inside UPLOADS_DIR before any fs call.
        const oldAbsPath = safeResolvePath(oldDoc.file_path);
        // eslint-disable-next-line security/detect-non-literal-fs-filename
        if (oldAbsPath && fs.existsSync(oldAbsPath)) {
          // eslint-disable-next-line security/detect-non-literal-fs-filename
          fs.unlinkSync(oldAbsPath);
        }
        await db.query("DELETE FROM documents WHERE id = ?", [oldDoc.id]);
      }
    }

    // Store relative path (from UPLOADS_DIR root) — multer wrote this with a UUID filename
    const relativePath = path.relative(UPLOADS_DIR, req.file.path).replace(/\\/g, "/");

    const insertResult = await db.query(
      `INSERT INTO documents (entity_type, entity_id, doc_type, file_path, original_name, mime_type, file_size_bytes, uploaded_by, public_token, latitude, longitude)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        entityType,
        parseInt(entityId, 10),
        docType,
        relativePath,
        req.file.originalname,
        req.file.mimetype,
        req.file.size,
        req.user.id,
        crypto.randomUUID(),
        latitude  ? parseFloat(latitude)  : null,
        longitude ? parseFloat(longitude) : null,
      ]
    );

    const result = await db.query(
      "SELECT id, entity_type, entity_id, doc_type, original_name, mime_type, file_size_bytes, uploaded_at, public_token, latitude, longitude FROM documents WHERE id = ?",
      [insertResult.insertId]
    );

    // ── Geotag post-upload tracking ───────────────────────────────────────
    // After any geotag upload on a quotation:
    // 1. Mark geotag_uploaded = 1 (first-upload tracking)
    // 2. If a reupload was requested, check if all requested slots are now done
    //    and clear the flag only when ALL requested slots have been uploaded.
    if (GEOTAG_TYPES.includes(docType) && entityType === "quotation") {
      const qid = parseInt(entityId, 10);

      // Step 1: mark uploaded
      await db.query(
        "UPDATE quotations SET geotag_uploaded = 1 WHERE id = ?",
        [qid]
      );

      // Step 2: smart-clear reupload flag
      const flagResult = await db.query(
        "SELECT geotag_reupload_requested, geotag_reupload_slots FROM quotations WHERE id = ?",
        [qid]
      );
      if (flagResult.rows.length > 0 && flagResult.rows[0].geotag_reupload_requested) {
        const slotsStr = flagResult.rows[0].geotag_reupload_slots;
        const requestedSlots = slotsStr
          ? slotsStr.split(",").filter(Boolean)
          : GEOTAG_TYPES; // legacy: all 3

        // Check which requested slots still have no uploaded doc
        const uploadedResult = await db.query(
          `SELECT doc_type FROM documents
           WHERE entity_type = 'quotation' AND entity_id = ? AND doc_type IN (${requestedSlots.map(() => "?").join(",")})`,
          [qid, ...requestedSlots]
        );
        const uploadedSlots = new Set(uploadedResult.rows.map(r => r.doc_type));
        const allDone = requestedSlots.every(s => uploadedSlots.has(s));

        if (allDone) {
          await db.query(
            "UPDATE quotations SET geotag_reupload_requested = 0, geotag_reupload_reason = NULL, geotag_reupload_slots = NULL WHERE id = ?",
            [qid]
          );
          // Notify admin that geotag re-uploads are ready for review
          await db.query(
            "UPDATE quotations SET geotag_needs_review = 1 WHERE id = ?",
            [qid]
          );
        }
      }
    }

    res.status(201).json({ success: true, message: "File uploaded successfully.", document: result.rows[0] });

  } catch (err) {
    safeUnlink(req.file?.path);
    next(err);
  }
});

// ─── POST /api/uploads/multiple ──────────────────────────
// Upload up to 5 files for an entity.
router.post("/multiple", uploadMultiple("files", 5), handleUploadError, async (req, res, next) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ success: false, error: "No files uploaded." });
    }

    const { entityType, entityId, docType } = req.body;

    const VALID_ENTITY_TYPES = ["quotation", "dealer_registration", "customer"];
    const VALID_DOC_TYPES    = [
      "aadhaar", "aadhaar_front", "aadhaar_back",
      "pan", "passbook", "site_photo", "passport_photo",
      "other", "geotag_1", "geotag_2", "geotag_3",
      "vera_bill", "house_photo_1", "house_photo_2", "house_photo_3",
    ];

    if (!entityType || !entityId || !docType) {
      for (const file of req.files) safeUnlink(file.path);
      return res.status(400).json({ success: false, error: "Missing required fields: entityType, entityId, docType" });
    }

    if (!VALID_ENTITY_TYPES.includes(entityType) || !VALID_DOC_TYPES.includes(docType)) {
      for (const file of req.files) safeUnlink(file.path);
      return res.status(400).json({ success: false, error: "Invalid entityType or docType." });
    }

    // Verify magic bytes for every file before inserting any DB record
    for (const file of req.files) {
      const isValidMagic = await verifyFileMagicBytes(file.path, file.mimetype);
      if (!isValidMagic) {
        for (const f of req.files) safeUnlink(f.path);
        return res.status(400).json({ success: false, error: `File '${file.originalname}' content does not match its declared type.` });
      }
    }

    const documents = [];

    for (const file of req.files) {
      const relativePath = path.relative(UPLOADS_DIR, file.path).replace(/\\/g, "/");

      const insertResult = await db.query(
        `INSERT INTO documents (entity_type, entity_id, doc_type, file_path, original_name, mime_type, file_size_bytes, uploaded_by, public_token)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          entityType,
          parseInt(entityId, 10),
          docType,
          relativePath,
          file.originalname,
          file.mimetype,
          file.size,
          req.user.id,
          crypto.randomUUID(),
        ]
      );

      const docResult = await db.query(
        "SELECT id, entity_type, entity_id, doc_type, original_name, mime_type, file_size_bytes, uploaded_at, public_token FROM documents WHERE id = ?",
        [insertResult.insertId]
      );
      documents.push(docResult.rows[0]);
    }

    res.status(201).json({ success: true, message: `${documents.length} file(s) uploaded successfully.`, documents });
  } catch (err) {
    if (req.files) {
      for (const file of req.files) safeUnlink(file.path);
    }
    next(err);
  }
});

// ─── GET /api/uploads/entity/:entityType/:entityId ───────
// List all documents for an entity.
// Defined BEFORE /:id so Express does not match "entity" as a numeric id.
router.get("/entity/:entityType/:entityId", async (req, res, next) => {
  try {
    const { entityType, entityId } = req.params;
    const parsedEntityId = parseInt(entityId, 10);

    if (isNaN(parsedEntityId)) {
      return res.status(400).json({ success: false, error: "Invalid entity ID." });
    }

    // Dealers can only see their own entities' documents
    if (req.user.role !== "admin") {
      let ownershipQuery = "";
      if (entityType === "quotation") {
        ownershipQuery = "SELECT id FROM quotations WHERE id = ? AND dealer_id = ?";
      } else if (entityType === "customer") {
        ownershipQuery = "SELECT id FROM customers WHERE id = ? AND created_by = ?";
      }
      if (ownershipQuery) {
        const ownerCheck = await db.query(ownershipQuery, [parsedEntityId, req.user.id]);
        if (ownerCheck.rows.length === 0) {
          return res.status(403).json({ success: false, error: "You do not have permission to view these documents." });
        }
      }
    }

    const result = await db.query(
      `SELECT id, entity_type, entity_id, doc_type, original_name, mime_type, file_size_bytes, uploaded_by, uploaded_at, public_token
       FROM documents
       WHERE entity_type = ? AND entity_id = ?
       ORDER BY uploaded_at DESC`,
      [entityType, parsedEntityId]
    );

    res.json({ success: true, count: result.rows.length, documents: result.rows });
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/uploads/:id ────────────────────────────────
// Stream a document — only the uploader or an admin can access it.
router.get("/:id", async (req, res, next) => {
  try {
    const docId = parseInt(req.params.id, 10);
    if (isNaN(docId)) {
      return res.status(400).json({ success: false, error: "Invalid document ID." });
    }

    const result = await db.query("SELECT * FROM documents WHERE id = ?", [docId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: "Document not found." });
    }

    const doc = result.rows[0];

    // Access control: only uploader or admin
    if (req.user.role !== "admin" && doc.uploaded_by !== req.user.id) {
      return res.status(403).json({ success: false, error: "You do not have permission to view this document." });
    }

    // Resolve and validate path — safeResolvePath normalises and confirms containment in UPLOADS_DIR.
    // Null-check immediately after guarantees no fs call is made on an unvalidated path.
    const absolutePath = safeResolvePath(doc.file_path);
    if (!absolutePath) {
      return res.status(403).json({ success: false, error: "Access denied." });
    }

    // absolutePath validated by safeResolvePath() above.
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    if (!fs.existsSync(absolutePath)) {
      return res.status(404).json({ success: false, error: "File not found on server. It may have been deleted." });
    }

    const isDownload = req.query.download === "true";
    const safeFilename = encodeURIComponent(doc.original_name);

    res.setHeader("Content-Type", doc.mime_type);
    res.setHeader("Content-Disposition", `${isDownload ? "attachment" : "inline"}; filename="${safeFilename}"`);

    // res.sendFile() reads Content-Length from the actual file on disk (stat()),
    // not from DB — eliminates the Content-Length mismatch that caused
    // ERR_STREAM_WRITE_AFTER_END when DB size differed from actual file size.
    // absolutePath is already validated by safeResolvePath() — safe to send directly.
    const dir = path.dirname(absolutePath);
    const base = path.basename(absolutePath);
    res.sendFile(base, { root: dir }, (err) => {
      if (err && !res.headersSent) {
        next(err);
      }
    });
  } catch (err) {
    next(err);
  }
});

// ─── DELETE /api/uploads/:id ─────────────────────────────
// Delete a document — admin only.
router.delete("/:id", authorize("admin"), async (req, res, next) => {
  try {
    const docId = parseInt(req.params.id, 10);
    if (isNaN(docId)) {
      return res.status(400).json({ success: false, error: "Invalid document ID." });
    }

    const result = await db.query("SELECT * FROM documents WHERE id = ?", [docId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: "Document not found." });
    }

    const doc = result.rows[0];

    // safeResolvePath validates containment within UPLOADS_DIR before we touch the disk.
    const absolutePath = safeResolvePath(doc.file_path);
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    if (absolutePath && fs.existsSync(absolutePath)) {
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      fs.unlinkSync(absolutePath);
    }

    await db.query("DELETE FROM documents WHERE id = ?", [docId]);

    res.json({ success: true, message: `Document '${doc.original_name}' deleted successfully.` });
  } catch (err) {
    next(err);
  }
});

// ─── PATCH /api/uploads/:id/coordinates ──────────────────
// Update GPS coordinates for a document — uploader or admin only.
router.patch("/:id/coordinates", async (req, res, next) => {
  try {
    const docId = parseInt(req.params.id, 10);
    const { latitude, longitude } = req.body;

    if (isNaN(docId)) {
      return res.status(400).json({ success: false, error: "Invalid document ID." });
    }
    if (latitude === undefined || longitude === undefined) {
      return res.status(400).json({ success: false, error: "Missing latitude or longitude in request body." });
    }

    const lat = parseFloat(latitude);
    const lng = parseFloat(longitude);

    if (isNaN(lat) || lat < -90  || lat > 90)  {
      return res.status(400).json({ success: false, error: "Invalid latitude. Must be between -90 and 90." });
    }
    if (isNaN(lng) || lng < -180 || lng > 180) {
      return res.status(400).json({ success: false, error: "Invalid longitude. Must be between -180 and 180." });
    }

    const docResult = await db.query("SELECT * FROM documents WHERE id = ?", [docId]);

    if (docResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: "Document not found." });
    }

    const doc = docResult.rows[0];

    if (req.user.role !== "admin" && doc.uploaded_by !== req.user.id) {
      return res.status(403).json({ success: false, error: "You do not have permission to update coordinates for this document." });
    }

    await db.query(
      "UPDATE documents SET latitude = ?, longitude = ? WHERE id = ?",
      [lat, lng, docId]
    );

    const updateResult = await db.query(
      "SELECT id, entity_type, entity_id, doc_type, original_name, latitude, longitude FROM documents WHERE id = ?",
      [docId]
    );

    res.json({ success: true, message: "Coordinates updated successfully.", document: updateResult.rows[0] });
  } catch (err) {
    next(err);
  }
});

export default router;
