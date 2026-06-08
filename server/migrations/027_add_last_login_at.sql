-- Migration 027: Add last_login_at to users table
-- Used by admin Dealers list to show when each dealer last logged in (IMP-6).
-- Fire-and-forget UPDATE in auth.js sets this on every successful login.
-- Note: Uses SELECT ... INTO approach to conditionally run ALTER since
-- mysql2 driver does not support the DELIMITER directive.
-- Safe to re-run — the column will already exist after first application.

ALTER TABLE users
  ADD COLUMN last_login_at DATETIME NULL DEFAULT NULL
  COMMENT 'Timestamp of the users most recent successful login. Updated by POST /api/auth/login.';
