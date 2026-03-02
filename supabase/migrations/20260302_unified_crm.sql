-- ═══════════════════════════════════════════════════════════════════════════
-- Schema Migration: Unified CRM
-- Date: 2026-03-02
--
-- Merges `profiles` and `residents` into the single `customers` table.
--   • auth_id (nullable) links to auth.users for app users
--   • unit_number absorbs the residents mailbox field
--   • Walk-ins (no app) have auth_id = NULL
--   • The handle_new_user() trigger now targets customers
--
-- ORDER OF OPERATIONS:
--   1. Add new columns to customers
--   2. Backfill from profiles (using profile id as customer id for FK compat)
--   3. Backfill from residents (merge by phone/email or insert new)
--   4. Migrate FK references (orders, coffee_orders, vouchers) → customers
--   5. Rewrite handle_new_user() trigger
--   6. Rewrite RLS policies
--   7. Drop profiles & residents
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────
-- 1. ADD NEW COLUMNS TO CUSTOMERS
-- ─────────────────────────────────────────────────────────────────────────

-- Make email nullable (walk-ins may only have a phone)
ALTER TABLE public.customers ALTER COLUMN email DROP NOT NULL;

-- Add auth_id link (nullable — NULL for walk-ins)
ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS auth_id uuid REFERENCES auth.users(id) UNIQUE;

-- Add unit_number (from residents)
ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS unit_number text;

-- Add profile-originated fields
ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS is_vip boolean DEFAULT false;

ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS barcode_id text;

ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS favorite_drink text DEFAULT 'Black Coffee';

ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS total_orders integer DEFAULT 0;

ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

-- Consolidate name columns: coalesce `name` into `full_name`, then drop `name`
UPDATE public.customers
SET full_name = COALESCE(NULLIF(full_name, ''), name, 'Guest')
WHERE full_name IS NULL OR full_name = '';

ALTER TABLE public.customers ALTER COLUMN full_name SET NOT NULL;
ALTER TABLE public.customers ALTER COLUMN full_name SET DEFAULT '';

-- ─────────────────────────────────────────────────────────────────────────
-- 2. BACKFILL FROM PROFILES
--
-- Strategy: For each profiles row, either merge into an existing customers
-- row (matched by email), or INSERT a new row with id = profiles.id so
-- that orders.user_id / coffee_orders.customer_id / vouchers.user_id FKs
-- remain valid without remapping data.
-- ─────────────────────────────────────────────────────────────────────────

-- 2a. Merge profiles that match an existing customer row by email.
--     Update the existing customer with auth_id + profile fields.
--     We'll remap FKs for these rows in step 4.
UPDATE public.customers c
SET
  auth_id        = p.id,
  is_vip         = COALESCE(p.is_vip, false),
  barcode_id     = COALESCE(p.barcode_id, c.barcode_id),
  favorite_drink = COALESCE(NULLIF(p.favorite_drink, ''), c.favorite_drink, 'Black Coffee'),
  total_orders   = GREATEST(COALESCE(p.total_orders, 0), COALESCE(c.total_orders, 0)),
  loyalty_points = GREATEST(COALESCE(p.loyalty_points, 0), COALESCE(c.loyalty_points, 0)),
  full_name      = COALESCE(NULLIF(c.full_name, ''), NULLIF(p.full_name, ''), 'Guest'),
  updated_at     = now()
FROM public.profiles p
WHERE LOWER(TRIM(c.email)) = LOWER(TRIM(p.email))
  AND p.email IS NOT NULL;

-- 2b. Insert profiles that have NO matching customer row.
--     Use profiles.id as the customer id to preserve FK references.
INSERT INTO public.customers (
  id, auth_id, email, full_name, phone, loyalty_points,
  is_vip, barcode_id, favorite_drink, total_orders,
  created_at, updated_at
)
SELECT
  p.id,
  p.id,  -- auth_id = auth.users.id = profiles.id
  LOWER(TRIM(p.email)),
  COALESCE(NULLIF(p.full_name, ''), 'Guest'),
  p.phone_number,
  COALESCE(p.loyalty_points, 0),
  COALESCE(p.is_vip, false),
  p.barcode_id,
  COALESCE(NULLIF(p.favorite_drink, ''), 'Black Coffee'),
  COALESCE(p.total_orders, 0),
  COALESCE(p.created_at, now()),
  now()
FROM public.profiles p
WHERE NOT EXISTS (
  SELECT 1 FROM public.customers c
  WHERE LOWER(TRIM(c.email)) = LOWER(TRIM(p.email))
);

-- ─────────────────────────────────────────────────────────────────────────
-- 3. BACKFILL FROM RESIDENTS
--
-- Merge residents by phone (primary) or email (fallback).
-- Residents without a match get a fresh UUID row.
-- ─────────────────────────────────────────────────────────────────────────

-- 3a. Merge residents that match an existing customer by phone
UPDATE public.customers c
SET
  unit_number = COALESCE(NULLIF(r.unit_number, ''), c.unit_number),
  full_name   = COALESCE(NULLIF(c.full_name, ''), NULLIF(c.full_name, 'Guest'), NULLIF(r.name, ''), c.full_name),
  updated_at  = now()
FROM public.residents r
WHERE c.phone IS NOT NULL
  AND r.phone IS NOT NULL
  AND REPLACE(c.phone, '-', '') = REPLACE(r.phone, '-', '');

-- 3b. Merge residents that match by email (and weren't caught by phone)
UPDATE public.customers c
SET
  unit_number = COALESCE(NULLIF(r.unit_number, ''), c.unit_number),
  full_name   = COALESCE(NULLIF(c.full_name, ''), NULLIF(c.full_name, 'Guest'), NULLIF(r.name, ''), c.full_name),
  updated_at  = now()
FROM public.residents r
WHERE c.email IS NOT NULL
  AND r.email IS NOT NULL
  AND LOWER(TRIM(c.email)) = LOWER(TRIM(r.email))
  AND c.unit_number IS NULL;  -- only if not already set by phone match

-- 3c. Insert residents that have no match in customers
INSERT INTO public.customers (
  id, full_name, phone, email, unit_number, loyalty_points, created_at, updated_at
)
SELECT
  gen_random_uuid(),
  COALESCE(NULLIF(r.name, ''), 'Guest'),
  r.phone,
  LOWER(TRIM(r.email)),
  r.unit_number,
  0,
  now(),
  now()
FROM public.residents r
WHERE NOT EXISTS (
  SELECT 1 FROM public.customers c
  WHERE (c.phone IS NOT NULL AND r.phone IS NOT NULL AND REPLACE(c.phone, '-', '') = REPLACE(r.phone, '-', ''))
     OR (c.email IS NOT NULL AND r.email IS NOT NULL AND LOWER(TRIM(c.email)) = LOWER(TRIM(r.email)))
);

-- ─────────────────────────────────────────────────────────────────────────
-- 4. MIGRATE FK REFERENCES
--
-- For profiles rows that were MERGED into an existing customer row
-- (step 2a), the customer.id ≠ profiles.id. We need to remap
-- orders/coffee_orders/vouchers user_id → the customer's actual id.
-- For profiles that were INSERTED (step 2b), customer.id = profiles.id
-- already, so no remapping needed.
-- ─────────────────────────────────────────────────────────────────────────

-- Remap orders.user_id: profiles.id → customers.id (via auth_id match)
UPDATE public.orders o
SET user_id = c.id
FROM public.customers c
WHERE c.auth_id = o.user_id
  AND c.id != o.user_id;

-- Remap coffee_orders.customer_id
UPDATE public.coffee_orders co
SET customer_id = c.id
FROM public.customers c
WHERE c.auth_id = co.customer_id
  AND c.id != co.customer_id;

-- Remap vouchers.user_id
UPDATE public.vouchers v
SET user_id = c.id
FROM public.customers c
WHERE c.auth_id = v.user_id
  AND c.id != v.user_id;

-- Drop old FK constraints pointing to profiles
ALTER TABLE public.orders         DROP CONSTRAINT IF EXISTS orders_user_id_fkey;
ALTER TABLE public.coffee_orders  DROP CONSTRAINT IF EXISTS coffee_orders_customer_id_fkey;
ALTER TABLE public.vouchers       DROP CONSTRAINT IF EXISTS vouchers_user_id_fkey;

-- Create new FK constraints pointing to customers
ALTER TABLE public.orders
  ADD CONSTRAINT orders_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES public.customers(id);

ALTER TABLE public.coffee_orders
  ADD CONSTRAINT coffee_orders_customer_id_fkey
  FOREIGN KEY (customer_id) REFERENCES public.customers(id);

ALTER TABLE public.vouchers
  ADD CONSTRAINT vouchers_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES public.customers(id);

-- ─────────────────────────────────────────────────────────────────────────
-- 5. REWRITE handle_new_user() TRIGGER
--
-- When a new auth.users row is created (sign-up), upsert into customers.
-- If a walk-in customer with the same phone/email already exists, we
-- link their existing row (the "Account Upgrade" scenario). Otherwise,
-- we create a new row.
-- ─────────────────────────────────────────────────────────────────────────

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP FUNCTION IF EXISTS handle_new_user() CASCADE;

CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  v_existing_id uuid;
  v_meta        jsonb;
  v_name        text;
  v_phone       text;
  v_unit        text;
BEGIN
  v_meta  := COALESCE(NEW.raw_user_meta_data, '{}'::jsonb);
  v_name  := COALESCE(v_meta->>'full_name', '');
  v_phone := COALESCE(v_meta->>'phone', '');
  v_unit  := COALESCE(v_meta->>'unit_number', '');

  -- "Account Upgrade" — check if a walk-in customer already exists
  -- by email (primary) or phone (secondary).
  SELECT id INTO v_existing_id
  FROM public.customers
  WHERE (email IS NOT NULL AND LOWER(TRIM(email)) = LOWER(TRIM(NEW.email)))
     OR (phone IS NOT NULL AND v_phone != '' AND phone = v_phone)
  LIMIT 1;

  IF v_existing_id IS NOT NULL THEN
    -- Link the existing walk-in row to this new auth account
    UPDATE public.customers
    SET
      auth_id     = NEW.id,
      email       = COALESCE(NULLIF(email, ''), LOWER(TRIM(NEW.email))),
      full_name   = CASE WHEN full_name = '' OR full_name = 'Guest' THEN COALESCE(NULLIF(v_name, ''), full_name) ELSE full_name END,
      unit_number = COALESCE(NULLIF(unit_number, ''), NULLIF(v_unit, '')),
      updated_at  = now()
    WHERE id = v_existing_id;
  ELSE
    -- Brand new customer — create a fresh row
    INSERT INTO public.customers (id, auth_id, email, full_name, phone, unit_number, loyalty_points, created_at, updated_at)
    VALUES (
      gen_random_uuid(),
      NEW.id,
      LOWER(TRIM(NEW.email)),
      COALESCE(NULLIF(v_name, ''), ''),
      NULLIF(v_phone, ''),
      NULLIF(v_unit, ''),
      0,
      now(),
      now()
    )
    ON CONFLICT (email) DO UPDATE SET
      auth_id    = EXCLUDED.auth_id,
      full_name  = CASE WHEN customers.full_name = '' OR customers.full_name = 'Guest' THEN COALESCE(NULLIF(EXCLUDED.full_name, ''), customers.full_name) ELSE customers.full_name END,
      updated_at = now();
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- ─────────────────────────────────────────────────────────────────────────
-- 6. RLS POLICIES ON CUSTOMERS
--
-- • App users (authenticated) can read/update their own row (via auth_id)
-- • Staff (service_role) can read/write all rows
-- • Anonymous has no access
-- ─────────────────────────────────────────────────────────────────────────

ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;

-- Drop stale policies
DROP POLICY IF EXISTS "Deny public access to customers" ON public.customers;
DROP POLICY IF EXISTS "Staff can read customers" ON public.customers;
DROP POLICY IF EXISTS "Users can read own customer row" ON public.customers;
DROP POLICY IF EXISTS "Users can update own customer row" ON public.customers;

-- Deny anon
CREATE POLICY "Deny public access to customers"
  ON public.customers FOR ALL
  TO anon
  USING (false);

-- Authenticated users can read their own row
CREATE POLICY "Users can read own customer row"
  ON public.customers FOR SELECT
  TO authenticated
  USING (auth_id = auth.uid());

-- Authenticated users can update their own row (name, phone, favorite_drink, etc.)
CREATE POLICY "Users can update own customer row"
  ON public.customers FOR UPDATE
  TO authenticated
  USING  (auth_id = auth.uid())
  WITH CHECK (auth_id = auth.uid());

-- ─────────────────────────────────────────────────────────────────────────
-- 7. DROP LEGACY TABLES
-- ─────────────────────────────────────────────────────────────────────────

-- Drop RLS policies on tables we're about to drop
DROP POLICY IF EXISTS "Deny public access to profiles" ON public.profiles;
DROP POLICY IF EXISTS "Users can read own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
DROP POLICY IF EXISTS "Staff can read all profiles" ON public.profiles;
DROP POLICY IF EXISTS "Deny public access to residents" ON public.residents;
DROP POLICY IF EXISTS "Staff can read residents" ON public.residents;

-- Drop the legacy name column from customers (consolidated into full_name)
ALTER TABLE public.customers DROP COLUMN IF EXISTS name;
-- Drop the legacy address column (address_street is canonical)
ALTER TABLE public.customers DROP COLUMN IF EXISTS address;

-- profiles FK
ALTER TABLE public.customers DROP CONSTRAINT IF EXISTS profiles_id_fkey;

DROP TABLE IF EXISTS public.profiles CASCADE;
DROP TABLE IF EXISTS public.residents CASCADE;
DROP SEQUENCE IF EXISTS public.residents_id_seq;

COMMIT;
