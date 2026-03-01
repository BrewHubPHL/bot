-- ============================================================
-- SCHEMA 16: Reconciliation Cleanup
--
-- Addresses findings from the Schema Alignment Audit (schemas 1–15).
-- Each section maps to a specific audit finding.
--
-- SAFE TO RE-RUN: Every statement is idempotent
--   (IF NOT EXISTS / IF EXISTS / OR REPLACE / ON CONFLICT).
--
-- Run order: This schema must be applied AFTER schemas 1–15.
-- ============================================================


-- ═══════════════════════════════════════════════════════════════
-- FIX 1 (CRITICAL): profiles table missing columns
--
-- handle_new_user() trigger (schema-3) inserts email, created_at,
-- updated_at into profiles — but those columns were never defined
-- in schema-1. Every new auth signup inserts into a missing column,
-- which Postgres silently ignores (Supabase client swallows this).
-- Result: profiles rows lack email, making get-loyalty.js lookups
-- always return nothing.
-- ═══════════════════════════════════════════════════════════════
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS email text;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

-- Backfill email from auth.users for any existing profiles rows
-- (SECURITY DEFINER context required — run as superuser in SQL Editor)
UPDATE profiles p
SET email = u.email
FROM auth.users u
WHERE p.id = u.id
  AND p.email IS NULL;

-- Index for the email lookups in get-loyalty.js
CREATE INDEX IF NOT EXISTS idx_profiles_email ON profiles (lower(email));


-- ═══════════════════════════════════════════════════════════════
-- FIX 2 (CRITICAL): orders table missing paid_at column
--
-- square-webhook.js (line ~341) writes `paid_at` on payment
-- confirmation. The column was never added (schema-10 only added
-- paid_amount_cents). The update silently drops the field →
-- no payment timestamp is recorded.
-- ═══════════════════════════════════════════════════════════════
ALTER TABLE orders ADD COLUMN IF NOT EXISTS paid_at timestamptz;


-- ═══════════════════════════════════════════════════════════════
-- FIX 3 (CRITICAL): vouchers table missing columns for webhook
--
-- square-webhook.js (line ~420) inserts qr_code_base64 and
-- status='active' into vouchers after loyalty threshold is hit.
-- Neither column exists → insert fails → earned vouchers vanish.
-- ═══════════════════════════════════════════════════════════════
ALTER TABLE vouchers ADD COLUMN IF NOT EXISTS qr_code_base64 text;
ALTER TABLE vouchers ADD COLUMN IF NOT EXISTS status text DEFAULT 'active';

-- Backfill status for existing vouchers
UPDATE vouchers SET status = 'redeemed' WHERE is_redeemed = true AND status IS NULL;
UPDATE vouchers SET status = 'active'   WHERE is_redeemed = false AND status IS NULL;


-- ═══════════════════════════════════════════════════════════════
-- FIX 4 (RELATIONAL): coffee_orders → orders foreign key
--
-- cafe-checkout.js and ai-order.js both set coffee_orders.order_id
-- to orders.id, but there's no FK constraint. If an order is
-- deleted (stale cleanup, GDPR), orphaned coffee_orders remain
-- and break the KDS "count drinks" trigger.
-- ═══════════════════════════════════════════════════════════════
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_coffee_orders_order'
      AND table_name = 'coffee_orders'
  ) THEN
    ALTER TABLE coffee_orders
      ADD CONSTRAINT fk_coffee_orders_order
      FOREIGN KEY (order_id) REFERENCES orders(id)
      ON DELETE CASCADE;
  END IF;
END $$;


-- ═══════════════════════════════════════════════════════════════
-- FIX 5 (RELATIONAL): vouchers → orders foreign key
--
-- vouchers.applied_to_order_id references orders.id in the
-- atomic_redeem_voucher RPC, but there's no FK. Deleted orders
-- leave dangling voucher references.
-- ═══════════════════════════════════════════════════════════════
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_vouchers_order'
      AND table_name = 'vouchers'
  ) THEN
    ALTER TABLE vouchers
      ADD CONSTRAINT fk_vouchers_order
      FOREIGN KEY (applied_to_order_id) REFERENCES orders(id)
      ON DELETE SET NULL;
  END IF;
END $$;


-- ═══════════════════════════════════════════════════════════════
-- FIX 6 (TECH DEBT): customers table — duplicate name/address cols
--
-- customers has BOTH:
--   name       + full_name      (create-customer.js writes `name`)
--   address    + address_street  (create-customer.js writes `address`)
--
-- We keep both for backward compat but add a trigger to keep
-- them in sync so either column returns correct data.
-- ═══════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION sync_customer_name_fields()
RETURNS TRIGGER AS $$
BEGIN
  -- Sync name → full_name on insert/update
  IF NEW.name IS NOT NULL AND (NEW.full_name IS NULL OR NEW.full_name = '') THEN
    NEW.full_name := NEW.name;
  ELSIF NEW.full_name IS NOT NULL AND (NEW.name IS NULL OR NEW.name = '') THEN
    NEW.name := NEW.full_name;
  END IF;

  -- Sync address → address_street on insert/update
  IF NEW.address IS NOT NULL AND (NEW.address_street IS NULL OR NEW.address_street = '') THEN
    NEW.address_street := NEW.address;
  ELSIF NEW.address_street IS NOT NULL AND (NEW.address IS NULL OR NEW.address = '') THEN
    NEW.address := NEW.address_street;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_customer_fields ON customers;
CREATE TRIGGER trg_sync_customer_fields
  BEFORE INSERT OR UPDATE ON customers
  FOR EACH ROW EXECUTE FUNCTION sync_customer_name_fields();

-- Backfill existing rows
UPDATE customers SET full_name = name WHERE full_name IS NULL AND name IS NOT NULL;
UPDATE customers SET name = full_name WHERE name IS NULL AND full_name IS NOT NULL;
UPDATE customers SET address_street = address WHERE address_street IS NULL AND address IS NOT NULL;


-- ═══════════════════════════════════════════════════════════════
-- FIX 7 (TECH DEBT): staff_directory — duplicate name/full_name
--
-- staff_directory has both `name` and `full_name`. pin-login.js
-- reads both; the manager dashboard reads `name`. Keep both in
-- sync with a simple trigger.
-- ═══════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION sync_staff_name_fields()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.name IS NOT NULL AND (NEW.full_name IS NULL OR NEW.full_name = '') THEN
    NEW.full_name := NEW.name;
  ELSIF NEW.full_name IS NOT NULL AND (NEW.name IS NULL OR NEW.name = '') THEN
    NEW.name := NEW.full_name;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_staff_name ON staff_directory;
CREATE TRIGGER trg_sync_staff_name
  BEFORE INSERT OR UPDATE ON staff_directory
  FOR EACH ROW EXECUTE FUNCTION sync_staff_name_fields();

-- Backfill
UPDATE staff_directory SET full_name = name WHERE full_name IS NULL AND name IS NOT NULL;
UPDATE staff_directory SET name = full_name WHERE name IS NULL AND full_name IS NOT NULL;


-- ═══════════════════════════════════════════════════════════════
-- FIX 8 (TECH DEBT): time_logs.employee_id is dead weight
--
-- log-time.js and pin-clock.js both write employee_email, never
-- employee_id. The column is text (not uuid) and always NULL.
-- We deprecate it with a comment for now; DROP in a future schema
-- after confirming no analytics queries use it.
-- ═══════════════════════════════════════════════════════════════
COMMENT ON COLUMN time_logs.employee_id IS
  'DEPRECATED (schema-16): Never populated by any workflow. '
  'All lookups use employee_email. Will be dropped in a future migration.';


-- ═══════════════════════════════════════════════════════════════
-- FIX 9 (RLS): Ensure no table the frontend queries lacks a
-- SELECT policy for its intended audience.
--
-- profiles: residents access their own profile via the portal.
-- The deny-all policy from schema-5 blocks this. Add a self-read
-- policy so authenticated users can read their own row.
-- ═══════════════════════════════════════════════════════════════
DROP POLICY IF EXISTS "Users can read own profile" ON profiles;
CREATE POLICY "Users can read own profile" ON profiles
  FOR SELECT
  USING (auth.uid() = id);

-- Allow users to update their own profile (favorite drink, phone, etc.)
DROP POLICY IF EXISTS "Users can update own profile" ON profiles;
CREATE POLICY "Users can update own profile" ON profiles
  FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- Staff can read all profiles (for loyalty lookups in manager dashboard)
DROP POLICY IF EXISTS "Staff can read all profiles" ON profiles;
CREATE POLICY "Staff can read all profiles" ON profiles
  FOR SELECT
  USING (is_brewhub_staff());


-- ═══════════════════════════════════════════════════════════════
-- FIX 10 (RLS): customers table has deny-all but staff dashboard
-- needs to read customer data. Add staff-scoped SELECT.
-- ═══════════════════════════════════════════════════════════════
DROP POLICY IF EXISTS "Staff can read customers" ON customers;
CREATE POLICY "Staff can read customers" ON customers
  FOR SELECT
  USING (is_brewhub_staff());


-- ═══════════════════════════════════════════════════════════════
-- FIX 11 (SAFETY): Add UNIQUE constraint on profiles.email to
-- prevent duplicate loyalty accounts.
-- ═══════════════════════════════════════════════════════════════
CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_email_unique
  ON profiles (lower(email))
  WHERE email IS NOT NULL;
