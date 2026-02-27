-- ============================================================
-- Schema 69: Single Active Shift DB Constraint (Clock-In Guard)
-- ============================================================
-- Belt-and-suspenders defense against double clock-ins.
--
-- The atomic_staff_clock() RPC (schema-42) already uses advisory
-- locks and idempotency checks, but if ANY code path bypasses it
-- and inserts directly into time_logs, this trigger fires and
-- blocks the duplicate.
--
-- Key guarantee:
--   No employee can have more than one open shift (clock_out IS NULL
--   AND action_type = 'in') at any given time. The trigger raises
--   a unique SQLSTATE ('P0409') so the backend can map it to
--   HTTP 409 Conflict rather than a generic 500.
--
-- Idempotent: safe to re-run in the Supabase SQL Editor.
-- ============================================================

BEGIN;

-- ─────────────────────────────────────────────────────────────
-- 1. Trigger function: check_active_shift()
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.check_active_shift()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- Only guard clock-in inserts (action_type = 'in' with no clock_out)
  IF NEW.action_type = 'in' AND NEW.clock_out IS NULL THEN
    IF EXISTS (
      SELECT 1
        FROM public.time_logs
       WHERE employee_email = NEW.employee_email
         AND clock_out IS NULL
         AND action_type = 'in'
         -- Exclude self in case of ON CONFLICT / upsert scenarios
         AND id IS DISTINCT FROM NEW.id
       LIMIT 1
    ) THEN
      RAISE EXCEPTION 'Shift already active for employee %', NEW.employee_email
        USING ERRCODE = 'P0409',
              HINT    = 'Clock out the existing shift before starting a new one.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.check_active_shift() IS
  'BEFORE INSERT trigger guard: prevents a second open shift '
  '(clock_out IS NULL, action_type = ''in'') for the same employee_email. '
  'Raises SQLSTATE P0409 so the API can return HTTP 409.';

-- ─────────────────────────────────────────────────────────────
-- 2. Apply trigger to time_logs (idempotent via DROP IF EXISTS)
-- ─────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_single_active_shift ON public.time_logs;

CREATE TRIGGER trg_single_active_shift
  BEFORE INSERT ON public.time_logs
  FOR EACH ROW
  EXECUTE FUNCTION public.check_active_shift();

-- ─────────────────────────────────────────────────────────────
-- 3. Partial unique index as a secondary safety net
-- ─────────────────────────────────────────────────────────────
-- Even if the trigger is somehow dropped, this index prevents
-- duplicate active shifts at the storage-engine level.
-- The trigger gives a friendlier error message; the index is
-- a last-resort constraint.
-- ─────────────────────────────────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS uq_one_active_shift_per_employee
  ON public.time_logs (employee_email)
  WHERE clock_out IS NULL AND action_type = 'in';

COMMIT;
