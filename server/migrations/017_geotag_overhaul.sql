-- ═══════════════════════════════════════════════════════════════
-- HIGHLIGHT PRO — Migration 017
-- Feature: Geo-Tag Workflow Overhaul
--   • geotag_uploaded: tracks whether dealer has submitted any geo-tag photos
--   • geotag_reupload_slots: CSV of specific slots admin wants re-uploaded
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE quotations
  ADD COLUMN geotag_uploaded       TINYINT(1)   NOT NULL DEFAULT 0   AFTER geotag_reupload_reason,
  ADD COLUMN geotag_reupload_slots VARCHAR(100) NULL                  AFTER geotag_uploaded;

-- Back-fill: mark quotations that already have geotag docs as uploaded
UPDATE quotations q
SET q.geotag_uploaded = 1
WHERE EXISTS (
  SELECT 1 FROM documents d
  WHERE d.entity_type = 'quotation'
    AND d.entity_id = q.id
    AND d.doc_type IN ('geotag_1', 'geotag_2', 'geotag_3')
);
