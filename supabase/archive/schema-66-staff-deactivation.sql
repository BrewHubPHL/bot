-- ═══════════════════════════════════════════════════════════════════════════
-- SCHEMA 66: Staff Deactivation Guard
-- ═══════════════════════════════════════════════════════════════════════════
-- When a staff member is fired / let go, setting is_active = false will:
--   1. Block PIN login  (verify_staff_pin checks is_active)
--   2. Block passkey login (webauthn-login.js checks is_active)
--   3. Revoke all WebAuthn credentials (trigger auto-deletes them)
--   4. Null out their PIN hash (trigger clears it)
--
-- The manager just flips one boolean — everything else is automatic.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── 1. Add is_active column to staff_directory ─────────────────────────────
-- Default true so all existing staff remain active. Safe for reruns.
ALTER TABLE public.staff_directory
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.staff_directory.is_active IS
  'false = staff has been terminated / deactivated. '
  'PIN and passkey login are blocked. WebAuthn credentials are auto-revoked.';

-- Optional: partial index for fast "active staff only" queries
CREATE INDEX IF NOT EXISTS idx_staff_directory_active
  ON public.staff_directory (is_active)
  WHERE is_active = true;

-- ─── 2. Update verify_staff_pin to reject inactive staff ────────────────────
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
    sd.is_working,
    CASE
      WHEN sd.pin_rotation_days = 0 THEN false
      WHEN sd.pin_changed_at IS NULL THEN true
      ELSE EXTRACT(DAY FROM now() - sd.pin_changed_at)::int > sd.pin_rotation_days
    END AS needs_pin_rotation
  FROM staff_directory sd
  WHERE sd.pin_hash IS NOT NULL
    AND sd.is_active = true                          -- ← NEW: reject fired staff
    AND sd.pin_hash = crypt(p_pin, sd.pin_hash);     -- bcrypt verify
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

REVOKE EXECUTE ON FUNCTION verify_staff_pin(text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION verify_staff_pin(text) TO service_role;

-- ─── 3. Auto-revoke credentials & clear PIN when staff is deactivated ───────
-- This trigger fires AFTER UPDATE on staff_directory. When is_active flips to
-- false it:
--   a) Deletes all webauthn_credentials for the staff member
--   b) Nulls out pin_hash so the PIN can never be brute-forced offline
--
-- Re-activating a staff member requires the manager to issue them a new PIN
-- and have them re-enroll passkeys — this is intentional (defense-in-depth).

CREATE OR REPLACE FUNCTION trg_staff_deactivated()
RETURNS trigger AS $$
BEGIN
  -- Only act when is_active transitions from true → false
  IF OLD.is_active = true AND NEW.is_active = false THEN
    -- Revoke all passkey credentials
    DELETE FROM public.webauthn_credentials
     WHERE staff_id = NEW.id;

    -- Clear PIN hash so it cannot be used even if is_active is bypassed
    NEW.pin_hash := NULL;
    NEW.pin      := NULL;   -- legacy plaintext column (if still present)

    -- Also force clock-out if they were on the clock
    IF NEW.is_working = true THEN
      NEW.is_working := false;
    END IF;

    RAISE NOTICE '[DEACTIVATION] Staff % (%) deactivated — credentials revoked',
                 NEW.full_name, NEW.id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_staff_deactivated ON public.staff_directory;
CREATE TRIGGER trg_staff_deactivated
  BEFORE UPDATE ON public.staff_directory
  FOR EACH ROW
  EXECUTE FUNCTION trg_staff_deactivated();

-- ─── 4. Update the staff_directory_safe view to include is_active ───────────
-- (Safe view already excludes pin and hourly_rate; managers see all via RLS.)
-- Must DROP + CREATE because adding a column changes the view signature.
-- CASCADE needed because v_attendance_report depends on it — we recreate it below.
DROP VIEW IF EXISTS staff_directory_safe CASCADE;
CREATE VIEW staff_directory_safe AS
SELECT
  id,
  name,
  full_name,
  email,
  role,
  is_working,
  is_active,
  created_at,
  token_version,
  version_updated_at
FROM staff_directory;

GRANT SELECT ON staff_directory_safe TO authenticated;

COMMENT ON VIEW staff_directory_safe IS
  'Restricted view of staff_directory excluding pin, pin_hash, and hourly_rate. '
  'Exposes is_active so the UI can show deactivated staff appropriately.';

-- ─── 5. Recreate v_attendance_report (dropped by CASCADE above) ─────────────
CREATE OR REPLACE VIEW public.v_attendance_report AS
SELECT DISTINCT ON (ss.id)
    ss.id AS shift_id,
    ss.user_id,
    sd.email AS employee_email,
    ss.start_time AS scheduled_start,
    ss.end_time AS scheduled_end,
    tl.clock_in AS actual_clock_in,
    EXTRACT(EPOCH FROM (tl.clock_in - ss.start_time)) / 60 AS minutes_late,
    CASE
        WHEN tl.clock_in IS NULL AND NOW() > (ss.start_time + INTERVAL '30 minutes') THEN 'No-Show'
        WHEN tl.clock_in IS NULL THEN 'Pending'
        WHEN (tl.clock_in - ss.start_time) > INTERVAL '10 minutes' THEN 'Tardy'
        WHEN (tl.clock_in - ss.start_time) < INTERVAL '-15 minutes' THEN 'Early Clock-in'
        ELSE 'On-Time'
    END AS attendance_status
FROM public.scheduled_shifts ss
LEFT JOIN public.staff_directory_safe sd ON ss.user_id = sd.id
LEFT JOIN public.time_logs tl ON LOWER(sd.email) = LOWER(tl.employee_email)
    AND tl.clock_in BETWEEN (ss.start_time - INTERVAL '3 hours') AND (ss.start_time + INTERVAL '3 hours')
ORDER BY ss.id, ABS(EXTRACT(EPOCH FROM (tl.clock_in - ss.start_time))) ASC;

-- ═══════════════════════════════════════════════════════════════════════════
-- HOW TO FIRE SOMEONE:
--   UPDATE staff_directory SET is_active = false WHERE id = '<staff-uuid>';
--
-- That single statement will:
--   ✓ Block their PIN login immediately
--   ✓ Block their passkey/Face ID login immediately
--   ✓ Delete all their registered passkey credentials
--   ✓ Clear their PIN hash
--   ✓ Clock them out if they were on the clock
-- ═══════════════════════════════════════════════════════════════════════════
