<?php
/**
 * Storage Configuration — cPanel Server
 * 
 * This file contains the shared secret key for authenticating
 * storage requests from the Railway backend.
 * 
 * ⚠️ IMPORTANT: After uploading to cPanel, edit this file and
 * set a strong random secret key. The same key must be set as
 * STORAGE_SECRET in Railway environment variables.
 * 
 * Generate a key: https://randomkeygen.com/ (use 256-bit WEP Keys)
 */

return [
    // CHANGE THIS to a strong random key (32+ characters)
    // Example: 'a7x9K2mP4wQ8rT6yU1iO3pL5jH0gF4dS'
    'secret' => 'CHANGE_ME_TO_A_STRONG_SECRET_KEY',
    
    // Maximum upload size in bytes (10MB)
    'max_file_size' => 10 * 1024 * 1024,
    
    // Allowed MIME types
    'allowed_types' => [
        'image/jpeg',
        'image/png', 
        'image/webp',
        'application/pdf',
    ],
];
