-- #############################################################################
-- ## schema-65-shift-audit-log.sql — Black Box Recorder for Schedule Changes
-- ##
-- ## Every INSERT, UPDATE, DELETE on scheduled_shifts is captured in an
-- ## immutable audit log with:
-- ##   • WHO made the change (auth.uid() → staff name)
-- ##   • WHAT changed (action, old values, new values as JSONB)
-- ##   • WHEN it happened (server-side timestamptz, not client clock)
-- ##
-- ## The trigger fires AFTER the DML so it never blocks the actual operation.
-- ## The log table is append-only: no UPDATE/DELETE policies for anyone.
-- ##
-- ## Use case: "Who changed my shift?" / "I thought I was off" disputes.
-- #############################################################################

-- ═══════════════════════════════════════════════════════════════════════════════
-- 1. Audit log table
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.shift_audit_log (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  shift_id     uuid        NOT NULL,                    -- the scheduled_shifts.id affected
  action       text        NOT NULL CHECK (action IN ('created', 'updated', 'deleted')),
  actor_id     uuid,                                    -- auth.uid() of whoever made the change (NULL = system/service_role)
  actor_name   text,                                    -- denormalized for instant reads
  old_data     jsonb,                                   -- full row snapshot BEFORE (NULL on INSERT)
  new_data     jsonb,                                   -- full row snapshot AFTER  (NULL on DELETE)
  changed_cols text[],                                  -- which columns actually changed (UPDATE only)
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_shift_audit_shift_id  ON shift_audit_log (shift_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_shift_audit_actor     ON shift_audit_log (actor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_shift_audit_created   ON shift_audit_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_shift_audit_action    ON shift_audit_log (action, created_at DESC);

-- ═══════════════════════════════════════════════════════════════════════════════
-- 2. RLS: append-only, managers can read, nobody can update/delete
-- ═══════════════════════════════════════════════════════════════════════════════

ALTER TABLE shift_audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE shift_audit_log FORCE ROW LEVEL SECURITY;

-- Managers can read the full audit trail
DROP POLICY IF EXISTS "Managers can read shift audit" ON shift_audit_log;
CREATE POLICY "Managers can read shift audit"
  ON shift_audit_log FOR SELECT
  USING (is_brewhub_manager());

-- Staff can see audit entries for their own shifts
DROP POLICY IF EXISTS "Staff can read own shift audit" ON shift_audit_log;
CREATE POLICY "Staff can read own shift audit"
  ON shift_audit_log FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM scheduled_shifts ss
      WHERE ss.id = shift_audit_log.shift_id
        AND ss.user_id = auth.uid()
    )
    OR
    -- Also allow if the audit entry itself references the user
    -- (covers deleted shifts where the scheduled_shifts row may be gone)
    (new_data->>'user_id' = auth.uid()::text OR old_data->>'user_id' = auth.uid()::text)
  );

-- No INSERT policy for authenticated — the trigger uses SECURITY DEFINER
-- No UPDATE/DELETE policies at all — the log is truly immutable from the client
GRANT SELECT ON shift_audit_log TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 3. Trigger function — fires AFTER INSERT/UPDATE/DELETE on scheduled_shifts
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION log_shift_change()
RETURNS trigger AS $$
DECLARE
  v_action       text;
  v_shift_id     uuid;
  v_actor_id     uuid;
  v_actor_name   text;
  v_old_data     jsonb := NULL;
  v_new_data     jsonb := NULL;
  v_changed_cols text[] := '{}';
BEGIN
  -- Determine action
  IF TG_OP = 'INSERT' THEN
    v_action   := 'created';
    v_shift_id := NEW.id;
    v_new_data := to_jsonb(NEW);
  ELSIF TG_OP = 'UPDATE' THEN
    v_action   := 'updated';
    v_shift_id := NEW.id;
    v_old_data := to_jsonb(OLD);
    v_new_data := to_jsonb(NEW);

    -- Compute which columns actually changed (ignore updated_at noise)
    SELECT array_agg(key) INTO v_changed_cols
    FROM (
      SELECT key
      FROM jsonb_each(to_jsonb(NEW)) n
      FULL OUTER JOIN jsonb_each(to_jsonb(OLD)) o USING (key)
      WHERE n.value IS DISTINCT FROM o.value
        AND key NOT IN ('updated_at')
    ) diff;
  ELSIF TG_OP = 'DELETE' THEN
    v_action   := 'deleted';
    v_shift_id := OLD.id;
    v_old_data := to_jsonb(OLD);
  END IF;

  -- Resolve actor (the authenticated user who made the change)
  v_actor_id := auth.uid();
  IF v_actor_id IS NOT NULL THEN
    SELECT COALESCE(full_name, name, email, 'Unknown')
      INTO v_actor_name
      FROM staff_directory
     WHERE id = v_actor_id;
  ELSE
    v_actor_name := 'System';
  END IF;

  -- Write the audit row (bypasses RLS because SECURITY DEFINER)
  INSERT INTO shift_audit_log (shift_id, action, actor_id, actor_name, old_data, new_data, changed_cols)
  VALUES (v_shift_id, v_action, v_actor_id, v_actor_name, v_old_data, v_new_data, v_changed_cols);

  -- AFTER trigger — always return NULL (row is already committed)
  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 4. Attach trigger to scheduled_shifts
-- ═══════════════════════════════════════════════════════════════════════════════

DROP TRIGGER IF EXISTS trg_shift_audit ON public.scheduled_shifts;
CREATE TRIGGER trg_shift_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.scheduled_shifts
  FOR EACH ROW
  EXECUTE FUNCTION log_shift_change();

-- ═══════════════════════════════════════════════════════════════════════════════
-- 5. View for easy querying (human-readable, pre-formatted)
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW public.v_shift_audit_trail AS
SELECT
  sal.id,
  sal.shift_id,
  sal.action,
  sal.actor_name,
  sal.changed_cols,
  sal.created_at,
  -- Pull employee name from the shift data for context
  COALESCE(
    sal.new_data->>'user_id',
    sal.old_data->>'user_id'
  ) AS affected_user_id,
  COALESCE(
    sd.full_name, sd.name, sd.email, 'Unknown'
  ) AS affected_employee,
  -- Human-readable time range from the shift
  COALESCE(
    sal.new_data->>'start_time',
    sal.old_data->>'start_time'
  ) AS shift_start,
  COALESCE(
    sal.new_data->>'end_time',
    sal.old_data->>'end_time'
  ) AS shift_end,
  sal.old_data,
  sal.new_data
FROM public.shift_audit_log sal
LEFT JOIN public.staff_directory sd
  ON sd.id = COALESCE(
    (sal.new_data->>'user_id')::uuid,
    (sal.old_data->>'user_id')::uuid
  )
ORDER BY sal.created_at DESC;

ALTER VIEW public.v_shift_audit_trail SET (security_invoker = true);
GRANT SELECT ON public.v_shift_audit_trail TO authenticated;

COMMENT ON TABLE shift_audit_log IS
  'Immutable black-box recorder for every schedule change. '
  'Populated by the trg_shift_audit AFTER trigger on scheduled_shifts. '
  'No UPDATE or DELETE is possible from any role except service_role bypass.';

COMMENT ON VIEW v_shift_audit_trail IS
  'Human-readable audit trail joining shift changes with employee names. '
  'Inherits RLS from shift_audit_log — staff see own, managers see all.';
