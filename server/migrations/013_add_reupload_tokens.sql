-- ═══════════════════════════════════════════════════════════════
-- HIGHLIGHT PRO — Migration 013
-- Feature: Dealer Document Re-upload
-- ═══════════════════════════════════════════════════════════════

-- 1. Expand the status ENUM on dealer_registrations to include 'ReuploadRequested'
--    This new status is set when admin requests a re-upload from a Rejected registration.
--    After the dealer re-uploads, status returns to 'Pending' for re-review.
ALTER TABLE dealer_registrations
  MODIFY COLUMN status
    ENUM('Pending', 'Approved', 'Rejected', 'ReuploadRequested')
    NOT NULL DEFAULT 'Pending';

-- 2. Create the dealer_reupload_tokens table
--    Stores secure tokens sent via email to authenticate the re-upload page.
--    Only the SHA-256 hash of the token is stored (never the raw token).
CREATE TABLE IF NOT EXISTS dealer_reupload_tokens (
    id               INT UNSIGNED NOT NULL AUTO_INCREMENT,
    registration_id  INT UNSIGNED NOT NULL,
    token            VARCHAR(255) NOT NULL,          -- SHA-256 hash of the raw token
    reason           TEXT NOT NULL,                  -- Admin's reason for requesting re-upload
    required_docs    VARCHAR(500) NOT NULL DEFAULT '', -- Comma-separated doc types e.g. 'aadhaar,pan'
    expires_at       DATETIME NOT NULL,              -- 72 hours from creation
    used             TINYINT(1) NOT NULL DEFAULT 0,
    created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_reupload_token (token),
    INDEX idx_reupload_reg_id (registration_id),
    CONSTRAINT fk_reupload_reg
        FOREIGN KEY (registration_id) REFERENCES dealer_registrations(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
