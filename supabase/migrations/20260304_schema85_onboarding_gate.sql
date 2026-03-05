-- ═══════════════════════════════════════════════════════════════════════════
-- Schema 85 — Onboarding Gate: surface contract_signed / onboarding_complete
-- ═══════════════════════════════════════════════════════════════════════════
-- Ensures staff_directory has the two boolean columns and updates
-- verify_staff_pin() to surface them in the login/verify flow so the
-- frontend OpsGate can redirect unsigned employees.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Ensure columns exist on staff_directory ───────────────────────────
-- These may already exist from an earlier schema; ALTER IF NOT EXISTS is
-- simulated with DO blocks for Postgres < 16 compatibility.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'staff_directory' AND column_name = 'contract_signed'
  ) THEN
    ALTER TABLE staff_directory ADD COLUMN contract_signed boolean NOT NULL DEFAULT false;
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'staff_directory' AND column_name = 'onboarding_complete'
  ) THEN
    ALTER TABLE staff_directory ADD COLUMN onboarding_complete boolean NOT NULL DEFAULT false;
  END IF;
END$$;

-- ── 2. Update verify_staff_pin to return the onboarding columns ──────────
CREATE OR REPLACE FUNCTION verify_staff_pin(p_pin text)
RETURNS TABLE(
  staff_id            uuid,
  staff_name          text,
  full_name           text,
  staff_email         text,
  staff_role          text,
  is_working          boolean,
  needs_pin_rotation  boolean,
  token_version       integer,
  contract_signed     boolean,
  onboarding_complete boolean
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
    END AS needs_pin_rotation,
    COALESCE(sd.token_version, 1) AS token_version,
    COALESCE(sd.contract_signed, false) AS contract_signed,
    COALESCE(sd.onboarding_complete, false) AS onboarding_complete
  FROM staff_directory sd
  WHERE sd.pin_hash IS NOT NULL
    AND sd.is_active = true
    AND sd.pin_hash = crypt(p_pin, sd.pin_hash);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
   SET search_path = public;

REVOKE EXECUTE ON FUNCTION verify_staff_pin(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION verify_staff_pin(text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION verify_staff_pin(text) TO service_role;
