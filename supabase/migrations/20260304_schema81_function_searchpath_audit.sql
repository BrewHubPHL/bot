-- ============================================================
-- Schema 81 – Function Search Path + Extension + RLS Audit
-- Date:  2026-03-04
-- Lint:  0011_function_search_path_mutable
--        0014_extension_in_public
--        0024_permissive_rls_policy
--        auth_leaked_password_protection (dashboard-only)
-- ============================================================
--
-- OVERVIEW
-- ────────
-- 1) Pin search_path on ALL public-schema functions (Lint 0011).
--    Uses a DO block to dynamically ALTER every function in the
--    public schema, so even functions with no local SQL file
--    (created via Dashboard) are caught.
--
-- 2) Move btree_gist extension to the extensions schema (Lint 0014).
--
-- 3) Tighten 4 overly-permissive INSERT RLS policies (Lint 0024).
--    Each WITH CHECK(true) is replaced with a scoped predicate.
--
-- 4) auth_leaked_password_protection: requires Supabase Dashboard
--    toggle under Authentication → Settings → Password Security.
--    Cannot be set via SQL migration.
-- ============================================================

BEGIN;

-- ════════════════════════════════════════════════════════════
-- 1) FIX: extension_in_public  (Lint 0014)  — RUN FIRST
-- ════════════════════════════════════════════════════════════
-- btree_gist currently in public schema, used by the
-- no_overlapping_shifts EXCLUDE constraint on scheduled_shifts.
-- Move it to the extensions schema (Supabase convention).
-- Done BEFORE the search_path loop so btree_gist functions
-- are no longer in the public schema when we iterate.

-- Ensure the extensions schema exists (it does on Supabase by default)
CREATE SCHEMA IF NOT EXISTS extensions;

-- ALTER EXTENSION ... SET SCHEMA is the safe, atomic move.
-- All operator classes and functions come along automatically.
ALTER EXTENSION btree_gist SET SCHEMA extensions;


-- ════════════════════════════════════════════════════════════
-- 2) FIX: function_search_path_mutable  (Lint 0011)
-- ════════════════════════════════════════════════════════════
-- Rather than writing 80+ individual ALTER statements (some
-- functions don't even have SQL files), use a DO block that
-- iterates pg_proc and pins search_path = 'public' on every
-- function in the public schema that doesn't already have it.
-- This is idempotent and future-proof.
--
-- We exclude extension-owned functions (e.g. those belonging
-- to pgcrypto, uuid-ossp, etc.) since we don't own them and
-- they don't need search_path pinning.

DO $$
DECLARE
  _fn record;
  _sig text;
BEGIN
  FOR _fn IN
    SELECT p.oid,
           p.proname,
           pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public'
      -- Skip functions that already have search_path pinned
      AND NOT EXISTS (
        SELECT 1
        FROM pg_options_to_table(p.proconfig) AS c(option_name, option_value)
        WHERE c.option_name = 'search_path'
      )
      -- Skip functions owned by extensions (we don't own them)
      AND NOT EXISTS (
        SELECT 1
        FROM pg_depend d
        WHERE d.objid = p.oid
          AND d.deptype = 'e'
      )
  LOOP
    _sig := format('public.%I(%s)', _fn.proname, _fn.args);
    EXECUTE format('ALTER FUNCTION %s SET search_path = public', _sig);
    RAISE NOTICE 'Pinned search_path on %', _sig;
  END LOOP;
END
$$;


-- ════════════════════════════════════════════════════════════
-- 3) FIX: rls_policy_always_true  (Lint 0024)
-- ════════════════════════════════════════════════════════════

-- ── 3a) coffee_orders: "Staff can add items to orders"
-- CURRENT:  FOR INSERT WITH CHECK (true)  TO authenticated
-- ISSUE:    Any authenticated user (including customers) can insert.
-- FIX:      Only allow if the user is a staff member.
DROP POLICY IF EXISTS "Staff can add items to orders" ON public.coffee_orders;
CREATE POLICY "Staff can add items to orders"
  ON public.coffee_orders
  FOR INSERT
  TO authenticated
  WITH CHECK ( public.is_brewhub_staff() );

-- ── 3b) orders: "Staff can create orders"
-- CURRENT:  FOR INSERT WITH CHECK (true)  TO authenticated
-- FIX:      Only allow if the user is a staff member.
DROP POLICY IF EXISTS "Staff can create orders" ON public.orders;
CREATE POLICY "Staff can create orders"
  ON public.orders
  FOR INSERT
  TO authenticated
  WITH CHECK ( public.is_brewhub_staff() );

-- ── 3c) customers: "customers_insert"
-- CURRENT:  FOR INSERT WITH CHECK (true)  TO anon, authenticated
-- PURPOSE:  Self-registration during checkout or loyalty signup.
-- FIX:      Scope inserts so anon/authenticated can only create
--           a row for their own auth.uid(), OR (for anon) require
--           that the row doesn't yet exist (idempotent upsert).
--           However, customers table uses CRM-style server inserts
--           via create-customer.js (service_role). The anon/auth
--           INSERT policy enables the chatbot and self-serve flows
--           that go through the Netlify function. Since the Netlify
--           function uses service_role (which bypasses RLS), and
--           there's no direct client-side INSERT to customers, we
--           can safely restrict this to authenticated users who
--           can only insert their own record, plus keep anon for
--           the public signup flow but require email to be non-null.
DROP POLICY IF EXISTS "customers_insert" ON public.customers;
CREATE POLICY "customers_insert"
  ON public.customers
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (
    -- Authenticated users: must match their own auth.uid()
    -- (or service_role bypasses this entirely)
    CASE
      WHEN current_setting('role', true) = 'authenticated'
        THEN id = auth.uid()
      -- Anon: require at least an email (prevents empty-row spam)
      ELSE (email IS NOT NULL AND email <> '')
    END
  );

-- ── 3d) waitlist: "allow_public_inserts"
-- CURRENT:  FOR INSERT WITH CHECK (true)  TO anon
-- PURPOSE:  Public waitlist signup form.
-- FIX:      Require non-empty, valid-format email to prevent
--           empty-row spam. The regex is deliberately loose
--           (just requires @) since Netlify function does full
--           validation anyway.
DROP POLICY IF EXISTS "allow_public_inserts" ON public.waitlist;
CREATE POLICY "allow_public_inserts"
  ON public.waitlist
  FOR INSERT
  TO anon
  WITH CHECK (
    email IS NOT NULL AND email ~* '^.+@.+\..+$'
  );


COMMIT;
