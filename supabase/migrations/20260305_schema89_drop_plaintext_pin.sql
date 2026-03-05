-- ═══════════════════════════════════════════════════════════════════════════
-- Schema 89 — Drop Legacy Plaintext PIN Column from staff_directory
-- ═══════════════════════════════════════════════════════════════════════════
-- The plaintext `pin` column has been fully superseded by `pin_hash`
-- (bcrypt, verified via the `verify_staff_pin` RPC).
--
-- All application code now uses verify_staff_pin exclusively.
-- The legacy fallback in process-comp.js has been removed.
-- pin-change.js no longer nulls the plaintext column.
--
-- This migration:
--   1) Verifies every active staff member has a pin_hash before dropping
--   2) Drops the v_staff_status view (depends on sd.* which includes pin)
--   3) Drops the plaintext pin column
--   4) Recreates v_staff_status without the pin column
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- Safety check: abort if any active staff still rely on plaintext PIN only
DO $$
DECLARE
  v_count integer;
BEGIN
  SELECT count(*) INTO v_count
    FROM public.staff_directory
    WHERE is_active = true
      AND pin IS NOT NULL
      AND (pin_hash IS NULL OR pin_hash = '');

  IF v_count > 0 THEN
    RAISE EXCEPTION
      'MIGRATION BLOCKED: % active staff member(s) still have a plaintext PIN but no pin_hash. '
      'Run pin-hash backfill before applying this migration.', v_count;
  END IF;
END$$;

-- Drop the dependent view first
DROP VIEW IF EXISTS public.v_staff_status;

-- Drop the plaintext pin column
ALTER TABLE public.staff_directory DROP COLUMN IF EXISTS pin;

-- Recreate v_staff_status (identical to schema 79 definition, now sd.* excludes pin)
CREATE OR REPLACE VIEW public.v_staff_status WITH (security_invoker = false) AS
SELECT sd.*,
  EXISTS (
    SELECT 1 FROM public.time_logs tl
    WHERE tl.employee_email = lower(sd.email)
      AND tl.clock_out IS NULL
      AND tl.action_type = 'in'
  ) AS is_working
FROM public.staff_directory sd;

COMMIT;
