-- ═══════════════════════════════════════════════════════════════
-- HIGHLIGHT PRO — Migration 014
-- Feature: Store rejection_reason on dealer_registrations
-- ═══════════════════════════════════════════════════════════════

-- Add rejection_reason column — stored whenever an admin rejects a registration.
-- NULL means not yet rejected or reason was not collected (legacy rows).
-- Guard: only add the column if it does not already exist.
SET @col_exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME   = 'dealer_registrations'
    AND COLUMN_NAME  = 'rejection_reason'
);

SET @sql = IF(
  @col_exists = 0,
  'ALTER TABLE dealer_registrations ADD COLUMN rejection_reason TEXT NULL AFTER reviewed_at',
  'SELECT 1 -- column already exists, nothing to do'
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
