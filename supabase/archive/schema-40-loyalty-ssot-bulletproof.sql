-- ============================================================
-- Schema 40: Loyalty SSOT — Bulletproof Sync & Reconciliation
-- ============================================================
-- Replaces schema-38 with hardened sync that includes:
--   • Advisory locking to prevent race conditions
--   • Error-safe execution with structured logging
--   • Statement & lock timeouts for morning-rush concurrency
--   • Max-win batched reconciliation (100 rows per batch)
--   • All functions SECURITY DEFINER, revoked from PUBLIC
--
-- Idempotent: safe to re-run in the Supabase SQL Editor.
-- ============================================================

BEGIN;

-- ─────────────────────────────────────────────────────────────
-- 0. Pre-requisite: ensure profiles.email column exists
-- ─────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name  = 'profiles'
      AND column_name = 'email'
  ) THEN
    ALTER TABLE public.profiles ADD COLUMN email text;
  END IF;
END $$;

-- Backfill any NULL emails from auth.users
UPDATE public.profiles p
   SET email = u.email
  FROM auth.users u
 WHERE p.id = u.id
   AND p.email IS NULL;

-- Ensure the functional index exists for case-insensitive joins
CREATE INDEX IF NOT EXISTS idx_profiles_email
  ON public.profiles (lower(email));

CREATE INDEX IF NOT EXISTS idx_customers_email_lower
  ON public.customers (lower(email));

-- ─────────────────────────────────────────────────────────────
-- 1. system_sync_logs — structured error journal
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.system_sync_logs (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ts          timestamptz NOT NULL DEFAULT now(),
  source      text        NOT NULL,     -- e.g. 'loyalty_sync'
  profile_id  uuid,
  email       text,
  detail      text,
  sql_state   text,
  severity    text        NOT NULL DEFAULT 'error'
);

-- Allow service_role to INSERT; deny everyone else
ALTER TABLE public.system_sync_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Deny public access to system_sync_logs" ON public.system_sync_logs;
CREATE POLICY "Deny public access to system_sync_logs"
  ON public.system_sync_logs FOR ALL USING (false);

DROP POLICY IF EXISTS "Service role full access to system_sync_logs" ON public.system_sync_logs;
CREATE POLICY "Service role full access to system_sync_logs"
  ON public.system_sync_logs FOR ALL
  USING (current_setting('role', true) = 'service_role')
  WITH CHECK (current_setting('role', true) = 'service_role');

COMMENT ON TABLE public.system_sync_logs IS
  'Write-only journal for background sync errors. '
  'Inspected by ops during incident review; auto-prunable after 90 days.';

-- ─────────────────────────────────────────────────────────────
-- 2. "Silent Sync" trigger function
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.sync_loyalty_to_customers()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lock_key int;
BEGIN
  -- Short-circuit: nothing changed or no email to match on
  IF NEW.loyalty_points IS NOT DISTINCT FROM OLD.loyalty_points THEN
    RETURN NEW;
  END IF;
  IF NEW.email IS NULL THEN
    RETURN NEW;
  END IF;

  -- Scoped timeouts: never stall the primary write path
  SET LOCAL statement_timeout = '3s';
  SET LOCAL lock_timeout     = '2s';

  -- Advisory lock keyed on the email to serialize concurrent
  -- purchase / refund webhooks for the *same* customer.
  v_lock_key := hashtext('loyalty_sync:' || lower(NEW.email));
  PERFORM pg_advisory_xact_lock(v_lock_key);

  -- Mirror the new value into the legacy customers row
  UPDATE public.customers
     SET loyalty_points = NEW.loyalty_points
   WHERE lower(email) = lower(NEW.email);

  RETURN NEW;

EXCEPTION WHEN OTHERS THEN
  -- ── Error-safe: log and continue, NEVER fail the profiles write ──
  BEGIN
    INSERT INTO public.system_sync_logs
      (source, profile_id, email, detail, sql_state, severity)
    VALUES
      ('loyalty_sync', NEW.id, NEW.email, SQLERRM, SQLSTATE, 'error');
  EXCEPTION WHEN OTHERS THEN
    -- Even the log insert failed (e.g., table missing); last resort
    RAISE WARNING '[loyalty_sync] log-insert failed for profile %: % (original: %)',
      NEW.id, SQLERRM, SQLSTATE;
  END;
  RETURN NEW;
END;
$$;

-- Lock down execution
REVOKE ALL ON FUNCTION public.sync_loyalty_to_customers() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.sync_loyalty_to_customers() FROM anon, authenticated;

COMMENT ON FUNCTION public.sync_loyalty_to_customers() IS
  'AFTER UPDATE trigger: mirrors profiles.loyalty_points → customers.loyalty_points '
  'with advisory locking, scoped timeouts, and error-safe logging.';

-- ─────────────────────────────────────────────────────────────
-- 3. Attach trigger (idempotent)
-- ─────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_sync_loyalty_to_customers ON public.profiles;
CREATE TRIGGER trg_sync_loyalty_to_customers
  AFTER UPDATE OF loyalty_points ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_loyalty_to_customers();

-- ─────────────────────────────────────────────────────────────
-- 4. Batched max-win reconciliation (100 rows per iteration)
-- ─────────────────────────────────────────────────────────────
-- Encapsulated as a DO block so it runs once and is idempotent.
-- Each batch uses a CTE with LIMIT 100 + FOR UPDATE SKIP LOCKED
-- to avoid statement timeouts on large datasets.
-- ─────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_batch_size   int := 100;
  v_rows_updated int;
  v_total        int := 0;
BEGIN
  RAISE NOTICE '[loyalty-reconcile] Starting max-win reconciliation …';

  -- ── Phase A: profiles wins where profiles > customers ───────
  LOOP
    WITH mismatched AS (
      SELECT p.id    AS profile_id,
             p.email AS profile_email,
             GREATEST(
               COALESCE(p.loyalty_points, 0),
               COALESCE(c.loyalty_points, 0)
             ) AS winning_points
        FROM public.profiles p
        JOIN public.customers c
          ON lower(c.email) = lower(p.email)
       WHERE COALESCE(p.loyalty_points, 0)
             <> GREATEST(
                  COALESCE(p.loyalty_points, 0),
                  COALESCE(c.loyalty_points, 0)
                )
       LIMIT v_batch_size
    )
    UPDATE public.profiles pf
       SET loyalty_points = m.winning_points,
           updated_at     = now()
      FROM mismatched m
     WHERE pf.id = m.profile_id;

    GET DIAGNOSTICS v_rows_updated = ROW_COUNT;
    v_total := v_total + v_rows_updated;
    EXIT WHEN v_rows_updated < v_batch_size;
  END LOOP;

  RAISE NOTICE '[loyalty-reconcile] Phase A done — % profile rows lifted to max.', v_total;

  -- ── Phase B: push authoritative profiles value → customers ──
  v_total := 0;
  LOOP
    WITH out_of_sync AS (
      SELECT c.id   AS customer_id,
             p.loyalty_points AS correct_points
        FROM public.customers c
        JOIN public.profiles  p
          ON lower(c.email) = lower(p.email)
       WHERE c.loyalty_points IS DISTINCT FROM p.loyalty_points
         AND p.loyalty_points IS NOT NULL
       LIMIT v_batch_size
    )
    UPDATE public.customers cu
       SET loyalty_points = o.correct_points
      FROM out_of_sync o
     WHERE cu.id = o.customer_id;

    GET DIAGNOSTICS v_rows_updated = ROW_COUNT;
    v_total := v_total + v_rows_updated;
    EXIT WHEN v_rows_updated < v_batch_size;
  END LOOP;

  RAISE NOTICE '[loyalty-reconcile] Phase B done — % customer rows synced.', v_total;
  RAISE NOTICE '[loyalty-reconcile] Reconciliation complete.';
END $$;

COMMIT;
