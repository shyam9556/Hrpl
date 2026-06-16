import fs from "fs";
import path from "path";
import { Readable } from "stream";
import env from "../config/env.js";

/**
 * Remote Storage Service
 *
 * Handles persistent file storage on the cPanel server (hrplpro.com).
 * When STORAGE_URL is configured, files are uploaded to cPanel after
 * being saved locally, then the local copy is removed.
 *
 * In local development (no STORAGE_URL), files stay on local disk
 * as before — zero behavioral change.
 */

const TIMEOUT_MS = 30_000; // 30 second timeout for storage operations

/**
 * Check if remote storage is configured
 */
function isConfigured() {
  return env.storage.isConfigured;
}

/**
 * Upload a file from local disk to remote cPanel storage.
 *
 * @param {string} localAbsPath - Absolute path to the file on local disk
 * @param {string} relativePath - Relative path to store (e.g. "2026-06/abc.jpg")
 * @returns {Promise<boolean>} true if persisted remotely, false if skipped/failed
 */
async function persistFile(localAbsPath, relativePath) {
  if (!isConfigured()) return false;

  try {
    // Read file from local disk
    const fileBuffer = fs.readFileSync(localAbsPath);
    const fileName = path.basename(localAbsPath);

    // Build multipart form data
    const formData = new FormData();
    formData.append("file", new Blob([fileBuffer]), fileName);
    formData.append("path", relativePath);
    formData.append("secret", env.storage.secret);

    const response = await fetch(`${env.storage.url}/upload.php`, {
      method: "POST",
      body: formData,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!response.ok) {
      const text = await response.text();
      console.error(
        `[STORAGE] Upload failed for ${relativePath}: ${response.status} ${text}`
      );
      return false;
    }

    const result = await response.json();
    if (result.success) {
      // Remove local copy — file is now on cPanel
      try {
        fs.unlinkSync(localAbsPath);
      } catch {
        // Local delete failed — not critical, file exists on remote
      }
      return true;
    }

    console.error(
      `[STORAGE] Upload response error for ${relativePath}:`,
      result.error
    );
    return false;
  } catch (err) {
    console.error(
      `[STORAGE] persistFile error for ${relativePath}:`,
      err.message
    );
    // File stays on local disk as fallback
    return false;
  }
}

/**
 * Get a readable stream for a file from remote storage.
 * Falls back to local disk if remote fails.
 *
 * @param {string} relativePath - Relative path of the file
 * @param {string} uploadsDir - Absolute path to local uploads directory
 * @returns {Promise<Readable>} Node.js readable stream
 */
async function getFileStream(relativePath, uploadsDir) {
  if (isConfigured()) {
    try {
      const url = `${env.storage.url}/serve.php?path=${encodeURIComponent(relativePath)}&secret=${encodeURIComponent(env.storage.secret)}`;

      const response = await fetch(url, {
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });

      if (response.ok && response.body) {
        // Convert web ReadableStream to Node.js Readable
        return Readable.fromWeb(response.body);
      }

      console.warn(
        `[STORAGE] Remote fetch failed for ${relativePath}: ${response.status}, trying local fallback`
      );
    } catch (err) {
      console.warn(
        `[STORAGE] Remote fetch error for ${relativePath}: ${err.message}, trying local fallback`
      );
    }
  }

  // Local fallback
  const localPath = path.join(uploadsDir, relativePath);
  if (fs.existsSync(localPath)) {
    return fs.createReadStream(localPath);
  }

  throw new Error(`File not found: ${relativePath}`);
}

/**
 * Delete a file from remote storage.
 *
 * @param {string} relativePath - Relative path of the file to delete
 * @returns {Promise<boolean>} true if deleted, false if failed
 */
async function deleteFile(relativePath) {
  if (!isConfigured()) return false;

  try {
    const response = await fetch(`${env.storage.url}/delete.php`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        path: relativePath,
        secret: env.storage.secret,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!response.ok) {
      const text = await response.text();
      console.warn(
        `[STORAGE] Delete failed for ${relativePath}: ${response.status} ${text}`
      );
      return false;
    }

    return true;
  } catch (err) {
    console.warn(
      `[STORAGE] deleteFile error for ${relativePath}:`,
      err.message
    );
    return false;
  }
}

export default {
  isConfigured,
  persistFile,
  getFileStream,
  deleteFile,
};
