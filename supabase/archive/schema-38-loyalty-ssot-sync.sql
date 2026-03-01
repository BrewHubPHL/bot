-- ============================================================
-- Schema 38: Loyalty Single Source of Truth (SSoT) Sync
-- ============================================================
-- PROBLEM: `profiles.loyalty_points` is the authoritative column
-- (used by increment_loyalty, decrement_loyalty_on_refund, the
-- POS loyalty scanner, and the portal). But the legacy `customers`
-- table also has a `loyalty_points` column that some admin queries
-- reference. Without a sync mechanism the two drift apart,
-- creating support tickets and incorrect voucher issuance.
--
-- SOLUTION: A Postgres trigger on `profiles` that cascades any
-- loyalty_points change into the `customers` row sharing the
-- same email. The trigger is AFTER UPDATE so it does not block
-- the primary write path and fails silently (via EXCEPTION block)
-- to avoid breaking the happy path if no matching customer row
-- exists.
--
-- The trigger is idempotent: re-running this migration replaces
-- the function and trigger without error.
-- ============================================================

-- 1. Add email column to profiles if missing (needed for join)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'email'
  ) THEN
    ALTER TABLE public.profiles ADD COLUMN email text;
    -- Backfill from auth.users
    UPDATE public.profiles p
       SET email = u.email
      FROM auth.users u
     WHERE p.id = u.id AND p.email IS NULL;
  END IF;
END $$;

-- 2. Create the sync function
CREATE OR REPLACE FUNCTION sync_loyalty_to_customers()
RETURNS trigger AS $$
BEGIN
  -- Only fire when loyalty_points actually changed
  IF NEW.loyalty_points IS DISTINCT FROM OLD.loyalty_points THEN
    UPDATE public.customers
       SET loyalty_points = NEW.loyalty_points
     WHERE lower(email) = lower(NEW.email)
       AND NEW.email IS NOT NULL;
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Never break the primary write path; log and continue
  RAISE WARNING 'sync_loyalty_to_customers failed for profile %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. Attach trigger (replace if exists)
DROP TRIGGER IF EXISTS trg_sync_loyalty_to_customers ON public.profiles;
CREATE TRIGGER trg_sync_loyalty_to_customers
  AFTER UPDATE OF loyalty_points ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION sync_loyalty_to_customers();

-- 4. One-time backfill: push current profiles.loyalty_points
--    into matching customers rows so they start in sync.
UPDATE public.customers c
   SET loyalty_points = p.loyalty_points
  FROM public.profiles p
 WHERE lower(c.email) = lower(p.email)
   AND p.loyalty_points IS NOT NULL
   AND c.loyalty_points IS DISTINCT FROM p.loyalty_points;

-- 5. Reverse sync: if customers had points that profiles didn't,
--    pull the MAX into profiles (one-time reconciliation).
UPDATE public.profiles p
   SET loyalty_points = GREATEST(COALESCE(p.loyalty_points, 0), c.loyalty_points)
  FROM public.customers c
 WHERE lower(p.email) = lower(c.email)
   AND c.loyalty_points > COALESCE(p.loyalty_points, 0);
