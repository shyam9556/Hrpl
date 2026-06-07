-- Migration 021: Rename doc_type 'site_photo' → 'light_bill'
-- The document previously called "Site Photo" is actually the customer's
-- Latest Electricity (Light) Bill. Renaming for clarity at all levels.
--
-- ORDER MATTERS:
-- Step 1: Expand ENUM to include BOTH old and new values (so existing rows are still valid)
-- Step 2: UPDATE existing rows from 'site_photo' to 'light_bill'
-- Step 3: Shrink ENUM to remove 'site_photo' now that no rows use it

-- Step 1: Add 'light_bill' to the ENUM (keep 'site_photo' for now so existing rows stay valid)
ALTER TABLE documents
  MODIFY COLUMN doc_type ENUM(
    'aadhaar',
    'aadhaar_front',
    'aadhaar_back',
    'pan',
    'passbook',
    'site_photo',
    'light_bill',
    'passport_photo',
    'other',
    'geotag_1',
    'geotag_2',
    'geotag_3',
    'vera_bill',
    'house_photo_1',
    'house_photo_2',
    'house_photo_3'
  ) NOT NULL;

-- Step 2: Migrate existing rows to the new value
UPDATE documents
SET doc_type = 'light_bill'
WHERE doc_type = 'site_photo';

-- Step 3: Remove 'site_photo' from the ENUM now that no rows use it
ALTER TABLE documents
  MODIFY COLUMN doc_type ENUM(
    'aadhaar',
    'aadhaar_front',
    'aadhaar_back',
    'pan',
    'passbook',
    'light_bill',
    'passport_photo',
    'other',
    'geotag_1',
    'geotag_2',
    'geotag_3',
    'vera_bill',
    'house_photo_1',
    'house_photo_2',
    'house_photo_3'
  ) NOT NULL;
