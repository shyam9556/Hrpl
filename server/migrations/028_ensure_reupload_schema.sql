-- =================================================================
-- HIGHLIGHT PRO -- Migration 028
-- Fix: Ensure all reupload-related tables and columns exist
-- on production cPanel MySQL database.
--
-- Uses information_schema guard pattern (idempotent -- safe to
-- re-run even if objects already exist).
-- =================================================================

-- Token Tables
-- These are referenced in every quotation and registration list
-- query. If missing, the entire list endpoint returns HTTP 500
-- causing blank status, no banners, no buttons on both sides.

CREATE TABLE IF NOT EXISTS dealer_reupload_tokens (
  id               INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  registration_id  INT UNSIGNED  NOT NULL,
  token            VARCHAR(255)  NOT NULL,
  reason           TEXT          NOT NULL,
  required_docs    VARCHAR(500)  NOT NULL DEFAULT '',
  expires_at       DATETIME      NOT NULL,
  used             TINYINT(1)    NOT NULL DEFAULT 0,
  created_at       DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_reupload_token (token),
  INDEX idx_reupload_reg_id (registration_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS quotation_reupload_tokens (
  id               INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  quotation_id     INT UNSIGNED  NOT NULL,
  token            VARCHAR(255)  NOT NULL,
  reason           TEXT          NOT NULL,
  required_docs    VARCHAR(500)  NOT NULL DEFAULT '',
  expires_at       DATETIME      NOT NULL,
  used             TINYINT(1)    NOT NULL DEFAULT 0,
  created_at       DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_q_reupload_token (token),
  INDEX idx_reupload_q_id (quotation_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Quotation status ENUM
ALTER TABLE quotations
  MODIFY COLUMN status
    ENUM('Pending', 'Approved', 'Rejected', 'ReuploadRequested')
    NOT NULL DEFAULT 'Pending';

-- dealer_registrations status ENUM
ALTER TABLE dealer_registrations
  MODIFY COLUMN status
    ENUM('Pending', 'Approved', 'Rejected', 'ReuploadRequested')
    NOT NULL DEFAULT 'Pending';

-- Missing columns guard (idempotent)
DROP PROCEDURE IF EXISTS _m028_ensure_columns;

CREATE PROCEDURE _m028_ensure_columns()
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'quotations' AND COLUMN_NAME = 'rejection_reason') THEN
    ALTER TABLE quotations ADD COLUMN rejection_reason TEXT NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'quotations' AND COLUMN_NAME = 'reupload_required_docs') THEN
    ALTER TABLE quotations ADD COLUMN reupload_required_docs VARCHAR(500) NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'quotations' AND COLUMN_NAME = 'geotag_reupload_requested') THEN
    ALTER TABLE quotations ADD COLUMN geotag_reupload_requested TINYINT(1) NOT NULL DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'quotations' AND COLUMN_NAME = 'geotag_reupload_reason') THEN
    ALTER TABLE quotations ADD COLUMN geotag_reupload_reason TEXT NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'quotations' AND COLUMN_NAME = 'geotag_uploaded') THEN
    ALTER TABLE quotations ADD COLUMN geotag_uploaded TINYINT(1) NOT NULL DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'quotations' AND COLUMN_NAME = 'geotag_reupload_slots') THEN
    ALTER TABLE quotations ADD COLUMN geotag_reupload_slots VARCHAR(100) NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'quotations' AND COLUMN_NAME = 'geotag_submitted') THEN
    ALTER TABLE quotations ADD COLUMN geotag_submitted TINYINT(1) NOT NULL DEFAULT 0;
    UPDATE quotations SET geotag_submitted = 1 WHERE geotag_uploaded = 1;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'quotations' AND COLUMN_NAME = 'needs_review_after_reupload') THEN
    ALTER TABLE quotations ADD COLUMN needs_review_after_reupload TINYINT(1) NOT NULL DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'quotations' AND COLUMN_NAME = 'geotag_needs_review') THEN
    ALTER TABLE quotations ADD COLUMN geotag_needs_review TINYINT(1) NOT NULL DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'dealer_registrations' AND COLUMN_NAME = 'needs_review_after_reupload') THEN
    ALTER TABLE dealer_registrations ADD COLUMN needs_review_after_reupload TINYINT(1) NOT NULL DEFAULT 0;
  END IF;
END;

CALL _m028_ensure_columns();
DROP PROCEDURE IF EXISTS _m028_ensure_columns;
