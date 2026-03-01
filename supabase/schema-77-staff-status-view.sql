-- ============================================================
-- SCHEMA 77: Phase 2 — Staff Status "View-ification"
-- ============================================================
-- Goal: Move from a manual `is_working` boolean on staff_directory
-- to a dynamic VIEW derived from time_logs (open shifts).
--
-- Safe Strategy:
--   1. Rename staff_directory.is_working → is_working_legacy
--   2. Create v_staff_status (dynamic, derived from time_logs)
--   3. Update verify_staff_pin() to compute is_working on-the-fly
--   4. Update atomic_staff_clock() to write is_working_legacy
--      (keeps the denormalized cache in sync for any legacy consumers)
--
-- What could break & mitigations:
--   • verify_staff_pin() references sd.is_working → UPDATED in this tx
--   • atomic_staff_clock() writes is_working → UPDATED to write is_working_legacy
--   • pin-verify.js reads is_working from staff_directory → CODE PATCH
--     switches to v_staff_status
--   • pin-login.js admin path reads is_working → CODE PATCH switches to
--     v_staff_status
--   • webauthn-login.js reads is_working from staff_directory → CODE PATCH
--     switches to v_staff_status
--   • fix-clock.js writes is_working → CODE PATCH writes is_working_legacy
--   • Frontend OpsGate.tsx receives is_working from API → NO CHANGE
--     (API response key name stays the same)
--
-- Rollback:
--   ALTER TABLE staff_directory RENAME COLUMN is_working_legacy TO is_working;
--   DROP VIEW IF EXISTS v_staff_status;
--   Then re-run schema-66 to restore original verify_staff_pin.
--   Then re-run schema-42 to restore original atomic_staff_clock.
-- ============================================================

BEGIN;

-- ─────────────────────────────────────────────────────────────
-- 1. Rename the column (backward-incompatible at SQL level,
--    but we update all consumers in this same transaction)
-- ─────────────────────────────────────────────────────────────
ALTER TABLE staff_directory
  RENAME COLUMN is_working TO is_working_legacy;

COMMENT ON COLUMN staff_directory.is_working_legacy IS
  'Deprecated denormalized cache. Ground truth is now v_staff_status.is_working '
  'derived from time_logs. Kept in sync by atomic_staff_clock() for transition period.';

-- ─────────────────────────────────────────────────────────────
-- 2. Create v_staff_status VIEW
--    Computes is_working dynamically from time_logs (open shift).
--    Queryable via PostgREST: .from('v_staff_status')
-- ─────────────────────────────────────────────────────────────
DROP VIEW IF EXISTS v_staff_status;

CREATE VIEW v_staff_status
  WITH (security_invoker = false)
AS
SELECT
  sd.*,
  EXISTS (
    SELECT 1
    FROM time_logs tl
    WHERE tl.employee_email = lower(sd.email)
      AND tl.clock_out IS NULL
      AND tl.action_type = 'in'
  ) AS is_working
FROM staff_directory sd;

COMMENT ON VIEW v_staff_status IS
  'Compatibility view over staff_directory. is_working is computed '
  'dynamically from time_logs (presence of an open shift with clock_out IS NULL). '
  'Created in schema-77 as Phase 2 of the DB refactor.';

-- Grant service_role access (Netlify functions)
GRANT SELECT ON v_staff_status TO service_role;

-- ─────────────────────────────────────────────────────────────
-- 3. Update verify_staff_pin() to compute is_working on-the-fly
--    instead of reading the now-renamed column.
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION verify_staff_pin(p_pin text)
RETURNS TABLE(
  staff_id    uuid,
  staff_name  text,
  full_name   text,
  staff_email text,
  staff_role  text,
  is_working  boolean,
  needs_pin_rotation boolean
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    sd.id,
    sd.name,
    sd.full_name,
    sd.email,
    sd.role,
    -- Compute is_working dynamically from time_logs (schema 77)
    EXISTS (
      SELECT 1 FROM time_logs tl
      WHERE tl.employee_email = lower(sd.email)
        AND tl.clock_out IS NULL
        AND tl.action_type = 'in'
    ) AS is_working,
    CASE
      WHEN sd.pin_rotation_days = 0 THEN false
      WHEN sd.pin_changed_at IS NULL THEN true
      ELSE EXTRACT(DAY FROM now() - sd.pin_changed_at)::int > sd.pin_rotation_days
    END AS needs_pin_rotation
  FROM staff_directory sd
  WHERE sd.pin_hash IS NOT NULL
    AND sd.is_active = true
    AND sd.pin_hash = crypt(p_pin, sd.pin_hash);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

REVOKE EXECUTE ON FUNCTION verify_staff_pin(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION verify_staff_pin(text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION verify_staff_pin(text) TO service_role;

-- ─────────────────────────────────────────────────────────────
-- 4. Update atomic_staff_clock() to write is_working_legacy
--    instead of the now-renamed column.
--    The denormalized cache is kept in sync for the transition period.
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.atomic_staff_clock(
  p_staff_id uuid,
  p_action   text,       -- 'in' or 'out'
  p_ip       text DEFAULT 'unknown'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_staff      record;
  v_open_shift record;
  v_lock_key   int;
  v_now        timestamptz := now();
  v_shift_hrs  numeric;
  v_warning    text := NULL;
  v_new_log_id uuid;
  MAX_AUTO_HOURS constant numeric := 16;
BEGIN
  -- Scoped timeouts: never stall the clock UI
  SET LOCAL statement_timeout = '5s';
  SET LOCAL lock_timeout      = '3s';

  -- Validate action
  IF p_action NOT IN ('in', 'out') THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Invalid action. Must be "in" or "out".',
      'error_code', 'INVALID_ACTION'
    );
  END IF;

  -- Fetch staff record (validates p_staff_id exists)
  -- NOTE: is_working_legacy is the renamed column (schema 77)
  SELECT id, email, role, is_working_legacy
    INTO v_staff
    FROM public.staff_directory
   WHERE id = p_staff_id;

  IF v_staff IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Staff member not found.',
      'error_code', 'STAFF_NOT_FOUND'
    );
  END IF;

  -- Advisory lock per staff member: serialize concurrent taps
  v_lock_key := hashtext('staff_clock:' || p_staff_id::text);
  PERFORM pg_advisory_xact_lock(v_lock_key);

  -- ── CLOCK IN ──────────────────────────────────────────────
  IF p_action = 'in' THEN
    -- Check for existing open shift (idempotency)
    SELECT id, clock_in
      INTO v_open_shift
      FROM public.time_logs
     WHERE employee_email = lower(v_staff.email)
       AND clock_out IS NULL
       AND action_type = 'in'
     ORDER BY clock_in DESC
     LIMIT 1;

    IF v_open_shift IS NOT NULL THEN
      -- Already clocked in — return success without a new row
      RETURN jsonb_build_object(
        'success', true,
        'action', 'in',
        'time', v_open_shift.clock_in,
        'is_working', true,
        'idempotent', true
      );
    END IF;

    -- Insert new clock-in row
    INSERT INTO public.time_logs (
      employee_email, action_type, clock_in, clock_out, status
    ) VALUES (
      lower(v_staff.email), 'in', v_now, NULL, 'active'
    )
    RETURNING id INTO v_new_log_id;

    -- Atomically set is_working_legacy (denormalized cache)
    UPDATE public.staff_directory
       SET is_working_legacy = true
     WHERE id = p_staff_id;

    RETURN jsonb_build_object(
      'success', true,
      'action', 'in',
      'time', v_now,
      'is_working', true,
      'log_id', v_new_log_id
    );
  END IF;

  -- ── CLOCK OUT ─────────────────────────────────────────────
  IF p_action = 'out' THEN
    -- Find the open shift
    SELECT id, clock_in
      INTO v_open_shift
      FROM public.time_logs
     WHERE employee_email = lower(v_staff.email)
       AND clock_out IS NULL
       AND action_type = 'in'
     ORDER BY clock_in DESC
     LIMIT 1;

    IF v_open_shift IS NULL THEN
      -- Not clocked in — idempotent: if already off-shift, return success
      IF NOT COALESCE(v_staff.is_working_legacy, false) THEN
        RETURN jsonb_build_object(
          'success', true,
          'action', 'out',
          'time', v_now,
          'is_working', false,
          'idempotent', true
        );
      END IF;

      -- is_working_legacy was stale — fix it
      UPDATE public.staff_directory
         SET is_working_legacy = false
       WHERE id = p_staff_id;

      RETURN jsonb_build_object(
        'success', true,
        'action', 'out',
        'time', v_now,
        'is_working', false,
        'warning', 'No open shift found but is_working_legacy was stale. Corrected.'
      );
    END IF;

    -- Calculate shift duration
    v_shift_hrs := EXTRACT(EPOCH FROM (v_now - v_open_shift.clock_in)) / 3600.0;

    -- Flag abnormally long shifts for manager review
    IF v_shift_hrs > MAX_AUTO_HOURS THEN
      v_warning := format('Shift exceeds %sh (%sh actual). Flagged for manager review.',
                          MAX_AUTO_HOURS, round(v_shift_hrs::numeric, 1));

      UPDATE public.time_logs
         SET action_type          = 'out',
             clock_out            = v_now,
             status               = 'Pending',
             needs_manager_review = true
       WHERE id = v_open_shift.id;
    ELSE
      UPDATE public.time_logs
         SET action_type = 'out',
             clock_out   = v_now,
             status      = 'completed'
       WHERE id = v_open_shift.id;
    END IF;

    -- Atomically clear is_working_legacy (denormalized cache)
    UPDATE public.staff_directory
       SET is_working_legacy = false
     WHERE id = p_staff_id;

    RETURN jsonb_build_object(
      'success', true,
      'action', 'out',
      'time', v_now,
      'is_working', false,
      'shift_hours', round(v_shift_hrs::numeric, 2),
      'warning', v_warning
    );
  END IF;

  -- Should never reach here
  RETURN jsonb_build_object(
    'success', false,
    'error', 'Unexpected state',
    'error_code', 'INTERNAL_ERROR'
  );
END;
$$;

-- Restrict execution: only service_role (Netlify functions)
REVOKE ALL ON FUNCTION public.atomic_staff_clock(uuid, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.atomic_staff_clock(uuid, text, text) FROM anon, authenticated;

COMMENT ON FUNCTION public.atomic_staff_clock IS
  'Atomic clock-in/clock-out RPC. The ONLY code path that modifies '
  'is_working_legacy or writes to time_logs. Called by pin-clock.js via service_role. '
  'is_working is now derived dynamically from time_logs via v_staff_status (schema 77).';

-- ─────────────────────────────────────────────────────────────
-- 5. Performance index: support the EXISTS subquery on time_logs
-- ─────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_time_logs_open_shift
  ON time_logs (employee_email, action_type)
  WHERE clock_out IS NULL;

COMMENT ON INDEX idx_time_logs_open_shift IS
  'Partial index for v_staff_status and verify_staff_pin: fast lookup of '
  'currently-clocked-in staff (open shifts where clock_out IS NULL).';

COMMIT;
