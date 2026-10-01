-- ============================================================
-- Migration 030 — Restructure Stock Categories
-- ============================================================
-- Date: 2026-10-01
-- Author: Admin
--
-- PURPOSE:
--   The stock_items table previously used 4 categories:
--     Panel, Inverter, Accessory, Wire
--
--   This migration consolidates them into 3 display groups:
--     1. PANEL AND INVERTER  — Panel & Inverter stay unchanged in DB
--                              (auto-sync logic depends on exact values)
--     2. STRUCTURE MATERIAL  — Structural/mounting hardware (from Accessory)
--     3. ELECTRICAL MATERIAL — Electrical components + all wires (from Accessory + Wire)
--
-- IDEMPOTENT: Yes — safe to re-run.
--   - Steps 1 & 2 use WHERE id IN (...) — if category is already changed, it
--     just sets it again (no harm, 0 rows affected on re-run for already-done items).
--   - Step 3 uses WHERE category = 'Wire' — once all Wires are gone, 0 rows affected.
--   - Step 4 is a safety net — if no straggler Accessory items exist, 0 rows affected.
--
-- The migrate.js runner tracks this file in schema_migrations.
-- Once recorded, it will NOT execute again on subsequent server starts.
-- ============================================================


-- ── Step 1: Structural items (was Accessory) → Structure Material ────────────
-- Items: GI pipes, zinc rode, nut washer, J bolt, anchor fastner,
--        zinc spray, foundation dry mix, foundation PP sheet, MS L angle
UPDATE stock_items
SET category = 'Structure Material'
WHERE id IN (475, 476, 477, 478, 479, 480, 481, 483, 484, 485, 689)
  AND category = 'Accessory';


-- ── Step 2: Electrical items (was Accessory) → Electrical Material ──────────
-- Items: ACDB, DCDB, earthing electrode, earthing chemical,
--        MC4 connector, conduit pipe, PVC elbow, PVC tee, PVC clip
UPDATE stock_items
SET category = 'Electrical Material'
WHERE id IN (486, 487, 488, 489, 497, 499, 500, 501, 502)
  AND category = 'Accessory';


-- ── Step 3: All Wire items → Electrical Material ─────────────────────────────
-- Catches all existing + any Wire items added between planning and deployment
UPDATE stock_items
SET category = 'Electrical Material'
WHERE category = 'Wire';


-- ── Step 4: Safety net — catch any remaining Accessory items ─────────────────
-- If any new Accessory items were added to production between when we planned
-- the migration and when it actually runs, they would be stranded as 'Accessory'.
-- The frontend no longer shows that category, so they'd be invisible.
-- Default them to 'Electrical Material' so nothing is lost.
UPDATE stock_items
SET category = 'Electrical Material'
WHERE category = 'Accessory';
