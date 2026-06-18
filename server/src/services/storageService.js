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
 *
 * ── Retry Queue ─────────────────────────────────────────────────
 * When the circuit breaker is open, failed persist requests are
 * queued in memory. When the circuit recovers (after cooldown),
 * the queue is drained automatically in the background. This
 * prevents file loss on Railway's ephemeral filesystem.
 * Queue is capped at MAX_RETRY_QUEUE to prevent unbounded memory.
 */

const PERSIST_TIMEOUT_MS = 30_000; // 30s timeout for uploads (can be slow)
const FETCH_TIMEOUT_MS   =  8_000; //  8s timeout for reads (local fallback is faster)
const DELETE_TIMEOUT_MS  = 15_000; // 15s timeout for deletes

// ── Circuit breaker state ────────────────────────────────────────
const CIRCUIT_THRESHOLD   = 3;              // Open after N consecutive failures
const CIRCUIT_COOLDOWN_MS = 2 * 60 * 1000;  // 2 minutes before retrying (was 5 min)

let consecutiveFailures = 0;
let circuitOpenUntil    = 0; // timestamp (ms) when circuit will close

// ── Retry queue for failed persists ──────────────────────────────
const MAX_RETRY_QUEUE = 50;  // Cap to prevent unbounded memory growth
const retryQueue = [];       // Array of { localAbsPath, relativePath, addedAt }
let isRetrying = false;      // Prevents concurrent drain loops

/**
 * Check if the circuit breaker is currently open (tripped).
 * When open, all remote storage calls are skipped → instant local fallback.
 * If cooldown has expired, resets the breaker and triggers retry queue drain.
 */
function isCircuitOpen() {
  if (consecutiveFailures < CIRCUIT_THRESHOLD) return false;

  if (Date.now() >= circuitOpenUntil) {
    // Cooldown expired — reset and allow one probe attempt
    consecutiveFailures = 0;
    console.log("[STORAGE] Circuit breaker reset — will retry remote storage.");
    // Drain retry queue in background (non-blocking)
    drainRetryQueue();
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
 * Add a file to the retry queue (when circuit is open and persist was skipped).
 * Only queues if the local file still exists on disk.
 */
function enqueueRetry(localAbsPath, relativePath) {
  // Don't duplicate — if same relativePath is already queued, skip
  if (retryQueue.some(item => item.relativePath === relativePath)) return;

  if (retryQueue.length >= MAX_RETRY_QUEUE) {
    // Drop oldest entry to make room
    const dropped = retryQueue.shift();
    console.warn(`[STORAGE] Retry queue full (${MAX_RETRY_QUEUE}). Dropped oldest: ${dropped.relativePath}`);
  }

  retryQueue.push({ localAbsPath, relativePath, addedAt: Date.now() });
  console.log(`[STORAGE] Queued for retry: ${relativePath} (queue size: ${retryQueue.length})`);
}

/**
 * Drain the retry queue — called when circuit breaker resets.
 * Processes files one-by-one to avoid overwhelming the cPanel server.
 * If any retry fails, stops and lets the circuit breaker trip again naturally.
 */
async function drainRetryQueue() {
  if (isRetrying || retryQueue.length === 0) return;
  isRetrying = true;

  console.log(`[STORAGE] Draining retry queue (${retryQueue.length} files)...`);
  let successCount = 0;
  let failCount = 0;

  while (retryQueue.length > 0) {
    const item = retryQueue[0]; // Peek at first item

    // Check if local file still exists (Railway may have redeployed)
    if (!fs.existsSync(item.localAbsPath)) {
      retryQueue.shift(); // Remove from queue
      console.warn(`[STORAGE] Retry skipped — local file gone: ${item.relativePath}`);
      continue;
    }

    // Attempt the persist
    const ok = await doRemotePersist(item.localAbsPath, item.relativePath);
    if (ok) {
      retryQueue.shift(); // Remove from queue on success
      successCount++;
    } else {
      // Failed again — stop draining, circuit breaker will trip
      failCount++;
      break;
    }
  }

  console.log(
    `[STORAGE] Retry drain complete: ${successCount} succeeded, ${failCount} failed, ${retryQueue.length} remaining.`
  );
  isRetrying = false;
}

/**
 * Check if remote storage is configured
 */
function isConfigured() {
  return env.storage.isConfigured;
}

/**
 * Core remote upload logic — shared by persistFile and retry queue.
 * Does NOT touch the circuit breaker state itself (caller decides).
 *
 * @param {string} localAbsPath - Absolute path to the file on local disk
 * @param {string} relativePath - Relative path to store (e.g. "2026-06/abc.jpg")
 * @returns {Promise<boolean>} true if persisted remotely
 */
async function doRemotePersist(localAbsPath, relativePath) {
  try {
    const fileBuffer = fs.readFileSync(localAbsPath);
    const fileName = path.basename(localAbsPath);

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
      console.error(`[STORAGE] Upload failed for ${relativePath}: ${response.status} ${text}`);
      recordFailure();
      return false;
    }

    const result = await response.json();
    if (result.success) {
      recordSuccess();
      return true;
    }

    console.error(`[STORAGE] Upload response error for ${relativePath}:`, result.error);
    recordFailure();
    return false;
  } catch (err) {
    console.error(`[STORAGE] persistFile error for ${relativePath}:`, err.message);
    recordFailure();
    return false;
  }
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
  // Instead, queue the file for retry when the circuit recovers.
  if (isCircuitOpen()) {
    console.warn(`[STORAGE] Circuit open — queuing for retry: ${relativePath}`);
    enqueueRetry(localAbsPath, relativePath);
    return false;
  }

  return doRemotePersist(localAbsPath, relativePath);
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
 * If it fails, trip the circuit breaker immediately for 5 minutes
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
    } else if (response.status === 403) {
      // 403 means server is reachable but secret is WRONG — critical config error
      console.error(`[STORAGE] ✗ Remote storage returned 403 Unauthorized. STORAGE_SECRET does NOT match config.php on cPanel!`);
      console.error(`[STORAGE] ✗ Fix: Update STORAGE_SECRET in Railway Variables to match the secret in public_html/storage/config.php`);
      // Trip the breaker but with a shorter cooldown — admin should fix this quickly
      consecutiveFailures = CIRCUIT_THRESHOLD;
      circuitOpenUntil = Date.now() + CIRCUIT_COOLDOWN_MS;
    } else {
      console.warn(`[STORAGE] ✗ Remote storage returned ${response.status}. Circuit breaker will trip after ${CIRCUIT_THRESHOLD} failures.`);
      recordFailure();
    }
  } catch (err) {
    console.error(`[STORAGE] ✗ Remote storage UNREACHABLE: ${err.message}`);
    console.warn("[STORAGE] Tripping circuit breaker immediately — skipping remote storage for 5 minutes.");
    // Force-trip the breaker for 5 minutes (longer than normal cooldown for startup)
    consecutiveFailures = CIRCUIT_THRESHOLD;
    circuitOpenUntil = Date.now() + 5 * 60 * 1000;
  }
}

export default {
  isConfigured,
  persistFile,
  getFileStream,
  deleteFile,
  probeHealth,
};
