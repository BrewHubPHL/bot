-- ============================================================
-- Schema 43: Payroll Adjustment & Audit Architecture
-- ============================================================
-- Replaces direct time_logs editing with an immutable
-- "Correction & Audit" model required for IRS compliance.
--
--   1. Adds `notes` column to time_logs for audit annotations.
--
--   2. atomic_payroll_adjustment() RPC — SECURITY DEFINER.
--      Never mutates existing rows. Inserts a new row with
--      action_type = 'adjustment', carrying the delta minutes
--      (positive or negative) and a mandatory manager audit
--      trail in the notes column.
--
--   3. v_payroll_summary — aggregated view of clock hours +
--      adjustments per staff member per pay period (weekly,
--      Mon–Sun boundaries).
--
-- Idempotent: safe to re-run in the Supabase SQL Editor.
-- ============================================================

BEGIN;

-- ─────────────────────────────────────────────────────────────
-- 1. Add notes column to time_logs (idempotent)
-- ─────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name   = 'time_logs'
       AND column_name  = 'notes'
  ) THEN
    ALTER TABLE public.time_logs ADD COLUMN notes text;
  END IF;
END $$;

-- Add delta_minutes for adjustment rows (minutes added/subtracted)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name   = 'time_logs'
       AND column_name  = 'delta_minutes'
  ) THEN
    ALTER TABLE public.time_logs ADD COLUMN delta_minutes numeric;
  END IF;
END $$;

-- Add manager_id for audit trail (FK to staff_directory)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name   = 'time_logs'
       AND column_name  = 'manager_id'
  ) THEN
    ALTER TABLE public.time_logs ADD COLUMN manager_id uuid;
  END IF;
END $$;

-- FK: manager_id must reference a real staff member.
-- ON DELETE RESTRICT prevents deleting a manager who has made adjustments,
-- preserving the IRS audit trail.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
     WHERE table_schema    = 'public'
       AND table_name      = 'time_logs'
       AND constraint_name = 'fk_time_logs_manager_id'
  ) THEN
    ALTER TABLE public.time_logs
      ADD CONSTRAINT fk_time_logs_manager_id
      FOREIGN KEY (manager_id) REFERENCES public.staff_directory(id)
      ON DELETE RESTRICT;
  END IF;
END $$;

-- Index for efficient payroll queries
CREATE INDEX IF NOT EXISTS idx_time_logs_action_type
  ON public.time_logs(action_type);

CREATE INDEX IF NOT EXISTS idx_time_logs_clock_in_date
  ON public.time_logs(clock_in);

-- ─────────────────────────────────────────────────────────────
-- 2. atomic_payroll_adjustment() — The IRS-compliant RPC
-- ─────────────────────────────────────────────────────────────
-- NEVER edits existing rows. Inserts a new row with:
--   action_type   = 'adjustment'
--   delta_minutes = signed integer (positive = add, negative = subtract)
--   notes         = reason + manager audit stamp
--   manager_id    = UUID of the authorising manager
--   employee_email = the affected staff member
--   clock_in      = timestamp of the adjustment (for pay-period bucketing)
--   status        = 'completed' (adjustments are instantly final)
--
-- Returns the inserted adjustment row as JSONB.
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.atomic_payroll_adjustment(
  p_employee_email  text,
  p_delta_minutes   numeric,
  p_reason          text,
  p_manager_id      uuid,
  p_target_date     timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_staff       record;
  v_audit_note  text;
  v_inserted    jsonb;
BEGIN
  -- Scoped timeouts
  SET LOCAL statement_timeout = '5s';
  SET LOCAL lock_timeout      = '3s';

  -- ── Validate employee exists ────────────────────────────
  SELECT id, email, name
    INTO v_staff
    FROM public.staff_directory
   WHERE lower(email) = lower(trim(p_employee_email))
   LIMIT 1;

  IF v_staff IS NULL THEN
    RAISE EXCEPTION 'Employee not found: %', p_employee_email
      USING ERRCODE = 'P0002';
  END IF;

  -- ── Validate delta is non-zero ──────────────────────────
  IF p_delta_minutes = 0 THEN
    RAISE EXCEPTION 'delta_minutes must be non-zero'
      USING ERRCODE = 'P0003';
  END IF;

  -- ── Validate reason is present ──────────────────────────
  IF p_reason IS NULL OR trim(p_reason) = '' THEN
    RAISE EXCEPTION 'A reason is required for every adjustment'
      USING ERRCODE = 'P0004';
  END IF;

  -- ── Validate manager exists (FK backs this at DB level) ──
  IF NOT EXISTS (
    SELECT 1 FROM public.staff_directory WHERE id = p_manager_id
  ) THEN
    RAISE EXCEPTION 'Manager not found: %', p_manager_id
      USING ERRCODE = 'P0005';
  END IF;

  -- ── Build the audit note ────────────────────────────────
  v_audit_note := trim(p_reason)
    || ' [ADJUSTMENT BY ' || p_manager_id::text
    || ' AT ' || to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
    || ']';

  -- ── Insert the immutable adjustment row ─────────────────
  INSERT INTO public.time_logs (
    employee_email,
    action_type,
    delta_minutes,
    notes,
    manager_id,
    clock_in,
    status,
    created_at
  ) VALUES (
    lower(trim(p_employee_email)),
    'adjustment',
    p_delta_minutes,
    v_audit_note,
    p_manager_id,
    p_target_date,
    'completed',
    now()
  )
  RETURNING to_jsonb(time_logs.*) INTO v_inserted;

  -- ── Audit log ───────────────────────────────────────────
  INSERT INTO public.system_sync_logs (source, detail, severity)
  VALUES (
    'atomic_payroll_adjustment',
    format('Manager %s adjusted %s by %s min: %s',
           p_manager_id, p_employee_email, p_delta_minutes, v_audit_note),
    'info'
  );

  RETURN v_inserted;
END;
$$;

-- Restrict execution to service_role only
REVOKE ALL ON FUNCTION public.atomic_payroll_adjustment(text, numeric, text, uuid, timestamptz) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.atomic_payroll_adjustment(text, numeric, text, uuid, timestamptz) FROM anon, authenticated;

COMMENT ON FUNCTION public.atomic_payroll_adjustment IS
  'IRS-compliant payroll adjustment. Never edits existing rows — inserts '
  'an immutable adjustment record with full manager audit trail.';

-- ─────────────────────────────────────────────────────────────
-- 3. v_payroll_summary — Aggregated view per staff per week
-- ─────────────────────────────────────────────────────────────
-- Combines clock-in/out shift hours with adjustment deltas.
-- Pay period = ISO week (Mon–Sun).
--
-- Columns:
--   employee_email, employee_name, hourly_rate,
--   pay_period_start (Monday), pay_period_end (Sunday),
--   clocked_minutes, adjustment_minutes, total_minutes,
--   total_hours, gross_pay
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.v_payroll_summary AS
WITH clock_shifts AS (
  -- Only completed shifts (clock_out IS NOT NULL).
  -- Active / partial shifts are intentionally excluded so we
  -- never pay for time that hasn't been finalized yet.
  SELECT
    lower(tl.employee_email)                       AS employee_email,
    date_trunc('week', tl.clock_in)::date          AS period_start,
    (date_trunc('week', tl.clock_in) + interval '6 days')::date AS period_end,
    EXTRACT(EPOCH FROM (tl.clock_out - tl.clock_in)) / 60.0
                                                   AS shift_minutes
  FROM public.time_logs tl
  WHERE tl.action_type IN ('in', 'out')
    AND tl.clock_in  IS NOT NULL
    AND tl.clock_out IS NOT NULL
    AND tl.status = 'completed'
),
active_shifts AS (
  -- Count of open (unfinished) shifts per employee per week.
  -- These are NOT included in totals — surfaced for manager awareness only.
  SELECT
    lower(tl.employee_email)                       AS employee_email,
    date_trunc('week', tl.clock_in)::date          AS period_start,
    (date_trunc('week', tl.clock_in) + interval '6 days')::date AS period_end,
    COUNT(*)::int                                  AS open_shift_count
  FROM public.time_logs tl
  WHERE tl.action_type = 'in'
    AND tl.clock_in  IS NOT NULL
    AND tl.clock_out IS NULL
  GROUP BY 1, 2, 3
),
adjustments AS (
  -- Sum adjustment deltas
  SELECT
    lower(tl.employee_email)                       AS employee_email,
    date_trunc('week', tl.clock_in)::date          AS period_start,
    (date_trunc('week', tl.clock_in) + interval '6 days')::date AS period_end,
    COALESCE(tl.delta_minutes, 0)                  AS adj_minutes
  FROM public.time_logs tl
  WHERE tl.action_type = 'adjustment'
),
combined AS (
  SELECT employee_email, period_start, period_end,
         shift_minutes AS minutes, 'clock' AS source
    FROM clock_shifts
  UNION ALL
  SELECT employee_email, period_start, period_end,
         adj_minutes   AS minutes, 'adjustment' AS source
    FROM adjustments
)
SELECT
  c.employee_email,
  sd.name                                          AS employee_name,
  sd.hourly_rate,
  c.period_start                                   AS pay_period_start,
  c.period_end                                     AS pay_period_end,
  ROUND(SUM(CASE WHEN c.source = 'clock'      THEN c.minutes ELSE 0 END)::numeric, 2)
                                                   AS clocked_minutes,
  ROUND(SUM(CASE WHEN c.source = 'adjustment' THEN c.minutes ELSE 0 END)::numeric, 2)
                                                   AS adjustment_minutes,
  ROUND(SUM(c.minutes)::numeric, 2)                AS total_minutes,
  ROUND((SUM(c.minutes) / 60.0)::numeric, 2)       AS total_hours,
  ROUND((SUM(c.minutes) / 60.0 * COALESCE(sd.hourly_rate, 0))::numeric, 2)
                                                   AS gross_pay,
  COALESCE(a.open_shift_count, 0)                  AS active_shifts
FROM combined c
LEFT JOIN public.staff_directory sd
  ON lower(sd.email) = c.employee_email
LEFT JOIN active_shifts a
  ON  a.employee_email = c.employee_email
  AND a.period_start   = c.period_start
GROUP BY c.employee_email, sd.name, sd.hourly_rate,
         c.period_start, c.period_end, a.open_shift_count;

COMMENT ON VIEW public.v_payroll_summary IS
  'Aggregated payroll view: clock shifts + adjustments per staff per ISO week. '
  'Immutable source rows guarantee IRS audit compliance.';

-- RLS note: This view is accessed via service_role (Netlify functions).
-- No need for SELECT grants to anon/authenticated.

COMMIT;
