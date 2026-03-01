-- Migration: Add PIN column to staff_directory for ops page authentication
-- Each staff member gets a unique 6-digit numeric PIN for POS/KDS/Scanner login

ALTER TABLE staff_directory
  ADD COLUMN IF NOT EXISTS pin TEXT;

-- Ensure PINs are unique across all staff
CREATE UNIQUE INDEX IF NOT EXISTS idx_staff_directory_pin
  ON staff_directory (pin) WHERE pin IS NOT NULL;

-- Add a check constraint to enforce 6-digit format
ALTER TABLE staff_directory
  ADD CONSTRAINT chk_pin_format CHECK (pin IS NULL OR pin ~ '^\d{6}$');

-- IMPORTANT: After running this migration, assign PINs to each staff member:
-- UPDATE staff_directory SET pin = '123456' WHERE email = 'alice@example.com';
-- UPDATE staff_directory SET pin = '654321' WHERE email = 'bob@example.com';
-- Make sure each PIN is unique!

-- RLS: Ensure the pin column is NOT exposed via the anon key
-- The existing RLS policies should already restrict direct reads to authenticated users.
-- The pin-login.js function uses the service_role key to verify PINs server-side.
-- For extra safety, consider a column-level security policy or a view that excludes the pin column.

COMMENT ON COLUMN staff_directory.pin IS 'Unique 6-digit numeric PIN for ops page (POS/KDS/Scanner) authentication. Verified server-side only via service_role key.';
