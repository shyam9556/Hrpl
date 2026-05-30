-- ═══════════════════════════════════════════════════════════════
-- HIGHLIGHT PRO — Database Schema Migration
-- Version: 012
-- Purpose: Fix inverters.type column — change from ENUM to VARCHAR(50)
--          so real inverter type names can be stored without truncation.
--
-- Old ENUM values (meaningless placeholders from seed data):
--   'String', 'Micro', 'Hybrid', 'Central'
--
-- Valid inverter types used throughout the app (frontend + backend):
--   'Single Phase (Single MPPT)'  — 1-phase, single max power point tracker
--   'Single Phase (Dual MPPT)'    — 1-phase, dual max power point trackers
--   'Three Phase'                 — 3-phase commercial/industrial inverters
--
-- NOTE: After this migration, run `node scripts/update-inverters.js` to
--       replace all placeholder seed data with real Vsole/Polycab inverter
--       catalog entries (covers all three types above).
-- ═══════════════════════════════════════════════════════════════

-- Step 1: Change the type column from ENUM to VARCHAR(50)
--         VARCHAR allows all three real type names without restriction
ALTER TABLE inverters
  MODIFY COLUMN type VARCHAR(50) NOT NULL DEFAULT 'Single Phase (Single MPPT)';

-- Step 2: Update existing seeded placeholder "String" → proper default type
--         "String" was an ENUM placeholder, not a real inverter classification
UPDATE inverters
  SET type = 'Single Phase (Single MPPT)'
  WHERE type = 'String';

-- Step 3: Map remaining old ENUM values to the closest real type
--         'Micro'   → Single Phase (Single MPPT)  (small residential units)
--         'Hybrid'  → Single Phase (Dual MPPT)    (dual-string hybrid units)
--         'Central' → Three Phase                  (large commercial/central)
UPDATE inverters SET type = 'Single Phase (Single MPPT)' WHERE type = 'Micro';
UPDATE inverters SET type = 'Single Phase (Dual MPPT)'   WHERE type = 'Hybrid';
UPDATE inverters SET type = 'Three Phase'                 WHERE type = 'Central';
