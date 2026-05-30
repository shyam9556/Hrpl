-- ═══════════════════════════════════════════════════════════════
-- HIGHLIGHT PRO — Migration 014
-- Feature: Store rejection_reason on dealer_registrations
-- ═══════════════════════════════════════════════════════════════

-- Add rejection_reason column — stored whenever an admin rejects a registration.
-- NULL means not yet rejected or reason was not collected (legacy rows).
ALTER TABLE dealer_registrations
  ADD COLUMN rejection_reason TEXT NULL AFTER reviewed_at;
