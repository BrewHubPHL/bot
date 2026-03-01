-- ============================================================
-- BREWHUB SCHEMA 31: Drop redundant customers columns
-- Migrates name → full_name, address → address_street,
-- then drops the legacy columns.
-- ============================================================
-- Safe to re-run: every statement is guarded with IF / COALESCE.

BEGIN;

-- 1. Back-fill full_name from name where full_name is NULL or empty
UPDATE customers
SET    full_name = name
WHERE  name IS NOT NULL
  AND  name <> ''
  AND  (full_name IS NULL OR full_name = '');

-- 2. Back-fill address_street from address where address_street is NULL or empty
UPDATE customers
SET    address_street = address
WHERE  address IS NOT NULL
  AND  address <> ''
  AND  (address_street IS NULL OR address_street = '');

-- 3. Drop the redundant columns
ALTER TABLE customers DROP COLUMN IF EXISTS name;
ALTER TABLE customers DROP COLUMN IF EXISTS address;

COMMIT;
