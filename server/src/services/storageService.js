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
 *
 * ── Circuit Breaker ─────────────────────────────────────────────
 * After CIRCUIT_THRESHOLD consecutive fetch failures, the service
 * stops trying remote storage for CIRCUIT_COOLDOWN_MS milliseconds.
 * This prevents 30-second timeout hangs on every file access when
 * the cPanel server is temporarily unreachable.
 */

const PERSIST_TIMEOUT_MS = 30_000; // 30s timeout for uploads (can be slow)
const FETCH_TIMEOUT_MS   =  8_000; //  8s timeout for reads (local fallback is faster)
const DELETE_TIMEOUT_MS  = 15_000; // 15s timeout for deletes

// ── Circuit breaker state ────────────────────────────────────────
const CIRCUIT_THRESHOLD   = 3;              // Open after N consecutive failures
const CIRCUIT_COOLDOWN_MS = 5 * 60 * 1000;  // 5 minutes before retrying

let consecutiveFailures = 0;
let circuitOpenUntil    = 0; // timestamp (ms) when circuit will close

/**
 * Check if the circuit breaker is currently open (tripped).
 * When open, all remote storage calls are skipped → instant local fallback.
 */
function isCircuitOpen() {
  if (consecutiveFailures < CIRCUIT_THRESHOLD) return false;

  if (Date.now() >= circuitOpenUntil) {
    // Cooldown expired — reset and allow one probe attempt
    consecutiveFailures = 0;
    console.log("[STORAGE] Circuit breaker reset — will retry remote storage.");
    return false;
  }

  return true; // still in cooldown
}

/** Record a successful remote operation → reset the breaker. */
function recordSuccess() {
  if (consecutiveFailures > 0) {
    console.log("[STORAGE] Remote storage recovered after", consecutiveFailures, "failures.");
  }
  consecutiveFailures = 0;
}

/** Record a failed remote operation → increment and possibly trip the breaker. */
function recordFailure() {
  consecutiveFailures++;
  if (consecutiveFailures >= CIRCUIT_THRESHOLD) {
    circuitOpenUntil = Date.now() + CIRCUIT_COOLDOWN_MS;
    console.warn(
      `[STORAGE] Circuit breaker OPEN — ${consecutiveFailures} consecutive failures. ` +
      `Skipping remote storage for ${CIRCUIT_COOLDOWN_MS / 1000}s. ` +
      `All file requests will use local disk until ${new Date(circuitOpenUntil).toISOString()}.`
    );
  }
}

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

  // Circuit breaker — don't waste time if remote is known to be down.
  // persistFile is fire-and-forget so this just avoids pointless network calls.
  if (isCircuitOpen()) {
    console.warn(`[STORAGE] Circuit open — skipping persist for ${relativePath}`);
    return false;
  }

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
      signal: AbortSignal.timeout(PERSIST_TIMEOUT_MS),
    });

    if (!response.ok) {
      const text = await response.text();
      console.error(
        `[STORAGE] Upload failed for ${relativePath}: ${response.status} ${text}`
      );
      recordFailure();
      return false;
    }

    const result = await response.json();
    if (result.success) {
      recordSuccess();
      // Keep local copy as fallback — getFileStream will try cPanel first,
      // then fall back to local disk. On Railway's ephemeral filesystem,
      // local files clean up naturally on redeploy.
      return true;
    }

    console.error(
      `[STORAGE] Upload response error for ${relativePath}:`,
      result.error
    );
    recordFailure();
    return false;
  } catch (err) {
    console.error(
      `[STORAGE] persistFile error for ${relativePath}:`,
      err.message
    );
    recordFailure();
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
  if (isConfigured() && !isCircuitOpen()) {
    try {
      const url = `${env.storage.url}/serve.php?path=${encodeURIComponent(relativePath)}&secret=${encodeURIComponent(env.storage.secret)}`;

      const response = await fetch(url, {
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });

      if (response.ok && response.body) {
        recordSuccess();
        // Convert web ReadableStream to Node.js Readable
        return Readable.fromWeb(response.body);
      }

      console.warn(
        `[STORAGE] Remote fetch failed for ${relativePath}: ${response.status}, trying local fallback`
      );
      recordFailure();
    } catch (err) {
      console.warn(
        `[STORAGE] Remote fetch error for ${relativePath}: ${err.message}, trying local fallback`
      );
      recordFailure();
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

  // Circuit breaker — deletes are fire-and-forget, skip if remote is down
  if (isCircuitOpen()) return false;

  try {
    const response = await fetch(`${env.storage.url}/delete.php`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        path: relativePath,
        secret: env.storage.secret,
      }),
      signal: AbortSignal.timeout(DELETE_TIMEOUT_MS),
    });

    if (!response.ok) {
      const text = await response.text();
      console.warn(
        `[STORAGE] Delete failed for ${relativePath}: ${response.status} ${text}`
      );
      recordFailure();
      return false;
    }

    recordSuccess();
    return true;
  } catch (err) {
    console.warn(
      `[STORAGE] deleteFile error for ${relativePath}:`,
      err.message
    );
    recordFailure();
    return false;
  }
}

/**
 * Startup health check — probe cPanel on server boot.
 * If it fails, trip the circuit breaker immediately for 10 minutes
 * so no request wastes time on a dead remote storage server.
 * Call this once from index.js after the server starts.
 */
async function probeHealth() {
  if (!isConfigured()) {
    console.log("[STORAGE] Remote storage not configured — using local disk only.");
    return;
  }

  console.log(`[STORAGE] Probing remote storage at ${env.storage.url}...`);
  try {
    const response = await fetch(`${env.storage.url}/serve.php?path=__health_check__&secret=${encodeURIComponent(env.storage.secret)}`, {
      signal: AbortSignal.timeout(8_000),
    });
    // 404 is fine — means the server IS reachable, just the file doesn't exist
    if (response.ok || response.status === 404) {
      console.log(`[STORAGE] ✓ Remote storage is reachable (status ${response.status}).`);
      recordSuccess();
    } else {
      console.warn(`[STORAGE] ✗ Remote storage returned ${response.status}. Circuit breaker will trip after ${CIRCUIT_THRESHOLD} failures.`);
      recordFailure();
    }
  } catch (err) {
    console.error(`[STORAGE] ✗ Remote storage UNREACHABLE: ${err.message}`);
    console.warn("[STORAGE] Tripping circuit breaker immediately — skipping remote storage for 10 minutes.");
    // Force-trip the breaker for 10 minutes (longer than normal cooldown)
    consecutiveFailures = CIRCUIT_THRESHOLD;
    circuitOpenUntil = Date.now() + 10 * 60 * 1000;
  }
}

export default {
  isConfigured,
  persistFile,
  getFileStream,
  deleteFile,
  probeHealth,
};
