-- ═══════════════════════════════════════════════════════════════
-- HIGHLIGHT PRO — Migration 020
-- Feature: Geo-Tag Submit-Before-Lock Workflow
--   • geotag_submitted: dealer must explicitly click "Submit Geo-Tag Photos"
--     before photos are locked. Previously geotag_uploaded=1 (set on first
--     file upload) doubled as the lock trigger — now these are separate.
--   • geotag_submitted = 0 → dealer can still freely replace any photo
--   • geotag_submitted = 1 → photos locked; only admin can view
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE quotations
  ADD COLUMN geotag_submitted TINYINT(1) NOT NULL DEFAULT 0 AFTER geotag_uploaded;

-- Back-fill: any quotation that already has geotag_uploaded=1 was submitted
-- under the old workflow — treat them as already submitted so no regression.
UPDATE quotations SET geotag_submitted = 1 WHERE geotag_uploaded = 1;
