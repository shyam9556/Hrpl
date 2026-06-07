-- Migration 022: Add quotation_type column + clean up Kit Purchase payment_mode values
-- Background: Previously, "Kit Mode" quotations were identified by storing "Kit Purchase"
-- in the payment_mode column (which is meant for customer payment method: Cash/Loan/etc).
-- This migration:
--   1. Adds a proper quotation_type column (ENUM: 'commission', 'kit')
--   2. Back-fills existing Kit quotations as quotation_type = 'kit'
--   3. Cleans payment_mode by replacing "Kit Purchase" with "Cash" (safe default,
--      since kit orders never recorded the actual payment method separately)

-- Step 1: Add quotation_type column (default 'commission' covers all existing rows)
ALTER TABLE quotations
  ADD COLUMN quotation_type ENUM('commission', 'kit') NOT NULL DEFAULT 'commission'
  AFTER payment_mode;

-- Step 2: Tag all existing Kit Mode quotations correctly
UPDATE quotations
SET quotation_type = 'kit'
WHERE payment_mode = 'Kit Purchase';

-- Step 3: Fix payment_mode — "Kit Purchase" is not a valid payment method
UPDATE quotations
SET payment_mode = 'Cash'
WHERE payment_mode = 'Kit Purchase';
