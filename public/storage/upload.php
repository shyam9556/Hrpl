<?php
/**
 * Remote File Upload Handler — cPanel Server
 * 
 * Receives files from Railway backend and stores them permanently.
 * Requires X-Storage-Secret header for authentication.
 * 
 * Endpoint: POST /storage/upload.php
 * Fields:   file (uploaded file), path (relative storage path), secret (auth key)
 */

// ─── Configuration ───────────────────────────────────────────
$config = require __DIR__ . '/config.php';
$STORAGE_SECRET = $config['secret'];
$STORAGE_DIR = __DIR__ . '/files';  // /storage/files/
$maxSize = $config['max_file_size'];
$allowedTypes = $config['allowed_types'];

// All responses are JSON
header('Content-Type: application/json');

// ─── Security: Validate Secret ───────────────────────────────
$secret = '';
if (isset($_SERVER['HTTP_X_STORAGE_SECRET'])) {
    $secret = $_SERVER['HTTP_X_STORAGE_SECRET'];
} elseif (isset($_POST['secret'])) {
    $secret = $_POST['secret'];
}

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

if (empty($_FILES['file']) || empty($_POST['path'])) {
    http_response_code(400);
    echo json_encode(['success' => false, 'error' => 'Missing file or path']);
    exit;
}

$file = $_FILES['file'];
$relativePath = $_POST['path'];

// ─── Security: Validate File ─────────────────────────────────

// Check upload errors
if ($file['error'] !== UPLOAD_ERR_OK) {
    http_response_code(400);
    echo json_encode(['success' => false, 'error' => 'Upload error: ' . $file['error']]);
    exit;
}

// File size limit
if ($file['size'] > $maxSize) {
    http_response_code(413);
    echo json_encode(['success' => false, 'error' => 'File too large (max 10MB)']);
    exit;
}

// MIME type whitelist
$finfo = finfo_open(FILEINFO_MIME_TYPE);
$mimeType = finfo_file($finfo, $file['tmp_name']);
finfo_close($finfo);

if (!in_array($mimeType, $allowedTypes)) {
    http_response_code(400);
    echo json_encode(['success' => false, 'error' => 'File type not allowed: ' . $mimeType]);
    exit;
}

// ─── Security: Path Traversal Protection ─────────────────────

// Normalize and validate the relative path
$relativePath = str_replace('\\', '/', $relativePath);
$relativePath = ltrim($relativePath, '/');

// Block path traversal attempts
if (strpos($relativePath, '..') !== false || strpos($relativePath, "\0") !== false) {
    http_response_code(400);
    echo json_encode(['success' => false, 'error' => 'Invalid path']);
    exit;
}

// ─── Save File ───────────────────────────────────────────────

$targetPath = $STORAGE_DIR . '/' . $relativePath;
$targetDir = dirname($targetPath);

// Create directory if it doesn't exist
if (!is_dir($targetDir)) {
    if (!mkdir($targetDir, 0755, true)) {
        http_response_code(500);
        echo json_encode(['success' => false, 'error' => 'Failed to create directory']);
        exit;
    }
}

// Move uploaded file to permanent location
if (!move_uploaded_file($file['tmp_name'], $targetPath)) {
    http_response_code(500);
    echo json_encode(['success' => false, 'error' => 'Failed to save file']);
    exit;
}

// ─── Success Response ────────────────────────────────────────
echo json_encode([
    'success' => true,
    'path' => $relativePath,
    'size' => $file['size'],
    'mime' => $mimeType,
]);
