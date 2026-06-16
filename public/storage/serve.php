<?php
/**
 * Remote File Serve Handler — cPanel Server
 * 
 * Serves stored files with proper Content-Type headers.
 * Requires secret parameter for authentication.
 * 
 * Endpoint: GET /storage/serve.php?path=<relative>&secret=<key>
 */

// ─── Configuration ───────────────────────────────────────────
$config = require __DIR__ . '/config.php';
$STORAGE_SECRET = $config['secret'];
$STORAGE_DIR = __DIR__ . '/files';  // /storage/files/

// ─── Security: Validate Secret ───────────────────────────────
$secret = isset($_GET['secret']) ? $_GET['secret'] : '';

if (empty($secret) || $secret !== $STORAGE_SECRET) {
    http_response_code(403);
    echo json_encode(['success' => false, 'error' => 'Unauthorized']);
    exit;
}

// ─── Validate Request ────────────────────────────────────────
if (empty($_GET['path'])) {
    http_response_code(400);
    echo json_encode(['success' => false, 'error' => 'Missing path parameter']);
    exit;
}

$relativePath = $_GET['path'];

// ─── Security: Path Traversal Protection ─────────────────────
$relativePath = str_replace('\\', '/', $relativePath);
$relativePath = ltrim($relativePath, '/');

if (strpos($relativePath, '..') !== false || strpos($relativePath, "\0") !== false) {
    http_response_code(400);
    echo json_encode(['success' => false, 'error' => 'Invalid path']);
    exit;
}

$targetPath = $STORAGE_DIR . '/' . $relativePath;

// Ensure storage directory exists
if (!is_dir($STORAGE_DIR)) {
    mkdir($STORAGE_DIR, 0755, true);
}

$realPath = realpath($targetPath);
$realStorageDir = realpath($STORAGE_DIR);

// Verify storage dir is resolvable
if ($realStorageDir === false) {
    http_response_code(500);
    echo json_encode(['success' => false, 'error' => 'Storage directory not accessible']);
    exit;
}

// Verify file exists
if ($realPath === false || !file_exists($realPath)) {
    http_response_code(404);
    echo json_encode(['success' => false, 'error' => 'File not found']);
    exit;
}

// Verify file is within storage directory (prevents traversal)
if (strpos($realPath, $realStorageDir) !== 0) {
    http_response_code(403);
    echo json_encode(['success' => false, 'error' => 'Access denied']);
    exit;
}

// ─── Serve File ──────────────────────────────────────────────
$finfo = finfo_open(FILEINFO_MIME_TYPE);
$mimeType = finfo_file($finfo, $realPath);
finfo_close($finfo);

$fileSize = filesize($realPath);

header('Content-Type: ' . $mimeType);
header('Content-Length: ' . $fileSize);
header('Cache-Control: private, max-age=3600');

// Stream file (memory-efficient for large files)
readfile($realPath);
