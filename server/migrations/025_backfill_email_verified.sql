-- ═══════════════════════════════════════════════════════════════
-- Migration 025: Backfill email_verified for existing registrations
--
-- Context:
--   Migration 024 added the email_verified column (default 0).
--   All dealer registrations that existed BEFORE the OTP feature was
--   introduced were submitted legitimately via the old flow.
--   This migration marks all of them as verified so they are not
--   incorrectly treated as unverified in any future logic.
--
-- Run ONCE immediately after deploying migration 024 to production.
-- Safe to run multiple times (WHERE email_verified = 0 is idempotent).
-- ═══════════════════════════════════════════════════════════════

UPDATE dealer_registrations
SET email_verified = 1
WHERE email_verified = 0;

-- Confirm how many rows were updated
SELECT
    COUNT(*)            AS total_registrations,
    SUM(email_verified) AS verified_count
FROM dealer_registrations;
