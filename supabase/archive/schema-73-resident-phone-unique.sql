-- schema-73-resident-phone-unique.sql
-- Fix: Resident Identity Duplication
--
-- Adds a UNIQUE constraint on residents.phone so the Supabase JS upsert
-- (onConflict: 'phone') in process-quick-add.js and the registration page
-- can resolve conflicts correctly.
--
-- Before applying, deduplicate any existing rows that share a phone number.
-- We keep the OLDEST row (lowest id) and merge the newest unit_number + email.

BEGIN;

-- ── 1. Merge duplicates: keep earliest row, update its unit/email from latest ──
WITH dupes AS (
  SELECT phone,
         min(id) AS keep_id,
         max(id) AS latest_id
  FROM residents
  WHERE phone IS NOT NULL AND phone <> ''
  GROUP BY phone
  HAVING count(*) > 1
)
UPDATE residents r
SET unit_number = COALESCE(dup_latest.unit_number, r.unit_number),
    email       = COALESCE(dup_latest.email, r.email)
FROM dupes d
JOIN residents dup_latest ON dup_latest.id = d.latest_id
WHERE r.id = d.keep_id;

-- ── 2. Delete the duplicate rows (keep the one with min id) ──
DELETE FROM residents
WHERE id NOT IN (
  SELECT min(id)
  FROM residents
  WHERE phone IS NOT NULL AND phone <> ''
  GROUP BY phone
)
AND phone IS NOT NULL
AND phone <> ''
AND EXISTS (
  SELECT 1 FROM residents r2
  WHERE r2.phone = residents.phone
    AND r2.id < residents.id
);

-- ── 3. Add the UNIQUE constraint ──
-- NULLs are excluded (Postgres: nulls are distinct) so residents without
-- a phone number are not affected.
ALTER TABLE residents
  ADD CONSTRAINT residents_phone_unique UNIQUE (phone);

COMMENT ON CONSTRAINT residents_phone_unique ON residents IS
  'Prevents duplicate resident records for the same phone number. '
  'Used by process-quick-add.js upsert and the /resident registration page.';

COMMIT;
