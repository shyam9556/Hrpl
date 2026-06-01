-- Migration 018: Add re-upload review flags for admin notification system
-- These flags let the admin know when a dealer has completed a re-upload and the item needs review.
--
-- Uses a stored-procedure guard pattern (information_schema check) so the migration
-- is idempotent and works on all MySQL versions (5.7, 8.x, 9.x).

DROP PROCEDURE IF EXISTS _m018_add_reupload_flags;

CREATE PROCEDURE _m018_add_reupload_flags()
BEGIN
  -- dealer_registrations: needs_review_after_reupload
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'dealer_registrations'
      AND COLUMN_NAME  = 'needs_review_after_reupload'
  ) THEN
    ALTER TABLE dealer_registrations
      ADD COLUMN needs_review_after_reupload TINYINT(1) NOT NULL DEFAULT 0;
  END IF;

  -- quotations: needs_review_after_reupload
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'quotations'
      AND COLUMN_NAME  = 'needs_review_after_reupload'
  ) THEN
    ALTER TABLE quotations
      ADD COLUMN needs_review_after_reupload TINYINT(1) NOT NULL DEFAULT 0;
  END IF;

  -- quotations: geotag_needs_review
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'quotations'
      AND COLUMN_NAME  = 'geotag_needs_review'
  ) THEN
    ALTER TABLE quotations
      ADD COLUMN geotag_needs_review TINYINT(1) NOT NULL DEFAULT 0;
  END IF;
END;

CALL _m018_add_reupload_flags();

DROP PROCEDURE IF EXISTS _m018_add_reupload_flags;
