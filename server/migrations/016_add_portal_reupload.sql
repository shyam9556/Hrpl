-- ═══════════════════════════════════════════════════════════════
-- HIGHLIGHT PRO — Migration 016
-- Feature: Portal-based Reupload for Quotation Docs & Geo-Tags
-- ═══════════════════════════════════════════════════════════════

-- Add columns to quotations for portal-based document reupload tracking.
-- (Stores required docs directly on the quotation — no token link needed.)
-- NOTE: These columns were applied manually before this migration was
--       recorded in schema_migrations, so this file is kept for reference.
ALTER TABLE quotations
  ADD COLUMN reupload_required_docs      VARCHAR(500)   NULL         AFTER rejection_reason,
  ADD COLUMN geotag_reupload_requested   TINYINT(1)     NOT NULL DEFAULT 0 AFTER reupload_required_docs,
  ADD COLUMN geotag_reupload_reason      TEXT           NULL         AFTER geotag_reupload_requested;
