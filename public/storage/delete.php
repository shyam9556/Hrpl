<?php
/**
 * Remote File Delete Handler — cPanel Server
 * 
 * Deletes stored files. Requires secret for authentication.
 * 
 * Endpoint: POST /storage/delete.php
 * Body:     JSON { "path": "<relative>", "secret": "<key>" }
 */

// ─── Configuration ───────────────────────────────────────────
$config = require __DIR__ . '/config.php';
$STORAGE_SECRET = $config['secret'];
$STORAGE_DIR = __DIR__ . '/files';  // /storage/files/

// ─── Read JSON Body ──────────────────────────────────────────
$input = json_decode(file_get_contents('php://input'), true);

if (!$input) {
    http_response_code(400);
    echo json_encode(['success' => false, 'error' => 'Invalid JSON body']);
    exit;
}

// ─── Security: Validate Secret ───────────────────────────────
$secret = isset($input['secret']) ? $input['secret'] : '';

if (empty($secret) || $secret !== $STORAGE_SECRET) {
    http_response_code(403);
    echo json_encode(['success' => false, 'error' => 'Unauthorized']);
    exit;
}

// ─── Validate Request ────────────────────────────────────────
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['success' => false, 'error' => 'Method not allowed']);
    exit;
}

if (empty($input['path'])) {
    http_response_code(400);
    echo json_encode(['success' => false, 'error' => 'Missing path']);
    exit;
}

$relativePath = $input['path'];

// ─── Security: Path Traversal Protection ─────────────────────
$relativePath = str_replace('\\', '/', $relativePath);
$relativePath = ltrim($relativePath, '/');

if (strpos($relativePath, '..') !== false || strpos($relativePath, "\0") !== false) {
    http_response_code(400);
    echo json_encode(['success' => false, 'error' => 'Invalid path']);
    exit;
}

$targetPath = $STORAGE_DIR . '/' . $relativePath;
$realPath = realpath($targetPath);
$realStorageDir = realpath($STORAGE_DIR);

// ─── Delete File ─────────────────────────────────────────────

// File doesn't exist — treat as success (idempotent)
if ($realPath === false || !file_exists($realPath)) {
    header('Content-Type: application/json');
    echo json_encode(['success' => true, 'message' => 'File already deleted']);
    exit;
}

// Verify file is within storage directory
if (strpos($realPath, $realStorageDir) !== 0) {
    http_response_code(403);
    echo json_encode(['success' => false, 'error' => 'Access denied']);
    exit;
}

if (!unlink($realPath)) {
    http_response_code(500);
    echo json_encode(['success' => false, 'error' => 'Failed to delete file']);
    exit;
}

// Clean up empty directories (optional)
$dir = dirname($realPath);
while ($dir !== $realStorageDir && is_dir($dir) && count(scandir($dir)) <= 2) {
    rmdir($dir);
    $dir = dirname($dir);
}

// ─── Success Response ────────────────────────────────────────
header('Content-Type: application/json');
echo json_encode(['success' => true, 'path' => $relativePath]);
