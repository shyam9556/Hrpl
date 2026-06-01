-- Migration 019: Add aadhaar_front and aadhaar_back to doc_type ENUM
-- Required for the two-photo Aadhaar upload feature (front side + back side).
ALTER TABLE documents
  MODIFY COLUMN doc_type ENUM(
    'aadhaar',
    'aadhaar_front',
    'aadhaar_back',
    'pan',
    'passbook',
    'site_photo',
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
