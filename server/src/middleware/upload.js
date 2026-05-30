import multer from "multer";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import crypto from "crypto";

import env from "../config/env.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ─── Allowed File Types ──────────────────────────────────
// Only these MIME types are accepted (security whitelist)
const ALLOWED_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
];

const ALLOWED_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp", ".pdf"];

// ─── Storage Configuration ───────────────────────────────
// Files are saved to: uploads/YYYY-MM/<uuid>.<ext>
// The entity type/ID mapping is tracked in the database, not the folder structure.
// This avoids the multipart form-data ordering issue where body fields
// may not be available when multer's destination callback runs.
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    // Create year-month subfolder for organization (e.g., "2026-05")
    const now = new Date();
    const yearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

    const uploadDir = path.resolve(__dirname, "../..", env.upload.dir, yearMonth);

    // Create directory if it doesn't exist
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }

    cb(null, uploadDir);
  },

  filename: (req, file, cb) => {
    // Generate UUID-based filename to prevent collisions and path traversal
    const uuid = crypto.randomUUID();
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${uuid}${ext}`);
  },
});

// ─── File Filter ─────────────────────────────────────────
// Magic byte signatures for file type verification
const MAGIC_BYTES = {
  "image/jpeg": [Buffer.from([0xFF, 0xD8, 0xFF])],
  "image/png": [Buffer.from([0x89, 0x50, 0x4E, 0x47])],
  "image/webp": [Buffer.from("RIFF")], // RIFF....WEBP
  "application/pdf": [Buffer.from("%PDF")],
};

const fileFilter = (req, file, cb) => {
  // Check MIME type
  if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
    const error = new Error(
      `File type '${file.mimetype}' is not allowed. Accepted types: JPG, PNG, WebP, PDF`
    );
    error.code = "INVALID_FILE_TYPE";
    return cb(error, false);
  }

  // Check file extension
  const ext = path.extname(file.originalname).toLowerCase();
  if (!ALLOWED_EXTENSIONS.includes(ext)) {
    const error = new Error(
      `File extension '${ext}' is not allowed. Accepted: .jpg, .jpeg, .png, .webp, .pdf`
    );
    error.code = "INVALID_FILE_TYPE";
    return cb(error, false);
  }

  cb(null, true);
};

// ─── Create Multer Instance ──────────────────────────────
const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: env.upload.maxFileSizeBytes, // Default 10MB
    files: 5, // Maximum 5 files per request
  },
});

/**
 * Upload middleware for single file.
 * Usage: router.post("/upload", uploadSingle("file"), handler);
 */
export const uploadSingle = (fieldName = "file") => upload.single(fieldName);

/**
 * Upload middleware for multiple files (same field).
 * Usage: router.post("/upload", uploadMultiple("files", 5), handler);
 */
export const uploadMultiple = (fieldName = "files", maxCount = 5) =>
  upload.array(fieldName, maxCount);

/**
 * Upload middleware for specific named fields.
 * Usage: router.post("/upload", uploadFields([
 *   { name: "aadhaar", maxCount: 1 },
 *   { name: "pan", maxCount: 1 },
 * ]), handler);
 */
export const uploadFields = (fields) => upload.fields(fields);

/**
 * Error handler middleware for multer errors.
 * Place after upload middleware to catch file errors gracefully.
 */
export function handleUploadError(err, req, res, next) {
  if (err.code === "LIMIT_FILE_SIZE") {
    return res.status(413).json({
      success: false,
      error: `File too large. Maximum size is ${env.upload.maxFileSizeMB}MB.`,
    });
  }

  if (err.code === "LIMIT_FILE_COUNT" || err.code === "LIMIT_UNEXPECTED_FILE") {
    return res.status(400).json({
      success: false,
      error: "Too many files. Maximum 5 files per upload.",
    });
  }

  if (err.code === "INVALID_FILE_TYPE") {
    return res.status(400).json({
      success: false,
      error: err.message,
    });
  }

  if (err instanceof multer.MulterError) {
    return res.status(400).json({
      success: false,
      error: `Upload error: ${err.message}`,
    });
  }

  next(err);
}

export default upload;
