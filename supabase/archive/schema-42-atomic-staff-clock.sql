-- ============================================================
-- Schema 42: Atomic Staff Clock — Decoupled from PIN Login
-- ============================================================
-- Creates atomic_staff_clock() RPC that is the ONLY way to
-- change is_working and write to time_logs.
--
-- Key guarantees:
--   • Advisory lock per staff member prevents double-clock races
--   • Idempotent: clock-in when already in → returns success (no dup row)
--   • 16h shift auto-flag for manager review
--   • is_working is ONLY modified here, never by login
--   • SECURITY DEFINER, revoked from public — called by service_role only
--
-- Idempotent: safe to re-run in the Supabase SQL Editor.
-- ============================================================

BEGIN;

-- ─────────────────────────────────────────────────────────────
-- 1. atomic_staff_clock(p_staff_id, p_action, p_ip)
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
  SELECT id, email, role, is_working
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

    -- Atomically set is_working
    UPDATE public.staff_directory
       SET is_working = true
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
      IF NOT COALESCE(v_staff.is_working, false) THEN
        RETURN jsonb_build_object(
          'success', true,
          'action', 'out',
          'time', v_now,
          'is_working', false,
          'idempotent', true
        );
      END IF;

      -- is_working was stale (e.g., browser crash) — fix it
      UPDATE public.staff_directory
         SET is_working = false
       WHERE id = p_staff_id;

      RETURN jsonb_build_object(
        'success', true,
        'action', 'out',
        'time', v_now,
        'is_working', false,
        'warning', 'No open shift found but is_working was stale. Corrected.'
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

    -- Atomically clear is_working
    UPDATE public.staff_directory
       SET is_working = false
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
  'is_working or writes to time_logs. Called by pin-clock.js via service_role. '
  'Advisory-locked per staff member. Idempotent. 16h auto-flag.';

-- ─────────────────────────────────────────────────────────────
-- 2. Safety net: remove any stale auto-clock triggers
-- ─────────────────────────────────────────────────────────────
-- If any trigger was auto-clocking on login, drop it now.
DROP TRIGGER IF EXISTS trg_auto_clock_on_login ON public.staff_directory;
DROP TRIGGER IF EXISTS trg_auto_clock_on_pin_login ON public.staff_directory;

COMMIT;
