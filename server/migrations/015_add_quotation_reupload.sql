-- ═══════════════════════════════════════════════════════════════
-- HIGHLIGHT PRO — Migration 015
-- Feature: Customer Quotation Site Photos Re-upload
-- ═══════════════════════════════════════════════════════════════

-- 1. Expand the status ENUM on quotations to include 'ReuploadRequested'
ALTER TABLE quotations
  MODIFY COLUMN status
    ENUM('Pending', 'Approved', 'Rejected', 'ReuploadRequested')
    NOT NULL DEFAULT 'Pending';

-- 2. Add rejection_reason column to quotations
ALTER TABLE quotations
  ADD COLUMN rejection_reason TEXT NULL AFTER delivery_status;

-- 3. Create the quotation_reupload_tokens table
CREATE TABLE IF NOT EXISTS quotation_reupload_tokens (
    id               INT UNSIGNED NOT NULL AUTO_INCREMENT,
    quotation_id     INT UNSIGNED NOT NULL,
    token            VARCHAR(255) NOT NULL,          -- SHA-256 hash of the raw token
    reason           TEXT NOT NULL,                  -- Admin's reason for requesting re-upload
    required_docs    VARCHAR(500) NOT NULL DEFAULT '', -- Comma-separated doc types e.g. 'geotag_1,geotag_2'
    expires_at       DATETIME NOT NULL,              -- 72 hours from creation
    used             TINYINT(1) NOT NULL DEFAULT 0,
    created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_q_reupload_token (token),
    INDEX idx_reupload_q_id (quotation_id),
    CONSTRAINT fk_reupload_q
        FOREIGN KEY (quotation_id) REFERENCES quotations(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
