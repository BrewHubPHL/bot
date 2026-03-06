-- ═══════════════════════════════════════════════════════════════════════════
-- Schema 93 — Fix pgcrypto Extension Accessibility for verify_staff_pin
-- ═══════════════════════════════════════════════════════════════════════════
-- BUG:   PIN-LOGIN failures: "function crypt(text, text) does not exist"
-- CAUSE: pgcrypto lives in the `extensions` schema (Supabase convention)
--        but verify_staff_pin has `SET search_path = public`, making
--        crypt() invisible. Schema 81 pinned all functions to public-only;
--        schema 85 recreated verify_staff_pin with the same narrow path.
--
-- FIX:
--   1. Ensure pgcrypto is enabled (idempotent). On Supabase, extensions
--      are created in the `extensions` schema by default.
--   2. Widen verify_staff_pin's search_path to include `extensions`.
--
-- CONSTRAINT: No table structure changes. Only extension + function fix.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. Ensure the extensions schema exists (Supabase default) ────────────
CREATE SCHEMA IF NOT EXISTS extensions;

-- ── 2. Enable pgcrypto in the extensions schema ──────────────────────────
-- If pgcrypto already exists in `public`, move it to `extensions` for
-- consistency with Supabase conventions (same pattern schema 81 used
-- for btree_gist). If it doesn't exist at all, create it fresh.
DO $$
BEGIN
  -- Check if pgcrypto is currently installed in any schema
  IF EXISTS (
    SELECT 1 FROM pg_extension WHERE extname = 'pgcrypto'
  ) THEN
    -- Move to extensions schema if not already there
    IF NOT EXISTS (
      SELECT 1
      FROM pg_extension e
      JOIN pg_namespace n ON e.extnamespace = n.oid
      WHERE e.extname = 'pgcrypto' AND n.nspname = 'extensions'
    ) THEN
      ALTER EXTENSION pgcrypto SET SCHEMA extensions;
      RAISE NOTICE 'pgcrypto moved to extensions schema';
    ELSE
      RAISE NOTICE 'pgcrypto already in extensions schema';
    END IF;
  ELSE
    -- Not installed at all — create in extensions schema
    CREATE EXTENSION pgcrypto SCHEMA extensions;
    RAISE NOTICE 'pgcrypto created in extensions schema';
  END IF;
END$$;

-- ── 3. Widen verify_staff_pin search_path to include extensions ──────────
-- DROP first: Postgres cannot change OUT-parameter return types via
-- CREATE OR REPLACE. The old signature may lack contract_signed /
-- onboarding_complete columns (Schema 79 vs 85).
DROP FUNCTION IF EXISTS verify_staff_pin(text);

CREATE FUNCTION verify_staff_pin(p_pin text)
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
   SET search_path = public, extensions;

-- ── 4. Restore strict permissions (unchanged from schema 85) ─────────────
REVOKE EXECUTE ON FUNCTION verify_staff_pin(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION verify_staff_pin(text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION verify_staff_pin(text) TO service_role;

COMMIT;
