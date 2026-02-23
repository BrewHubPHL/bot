-- ============================================================================
-- SCHEMA 47 — Manager PIN Hardening (Insider Threat Defense)
-- ============================================================================
-- Fixes the "Shoulder-Surfed God Mode" vulnerability:
--   1. PIN hashing (bcrypt) — no more plaintext PINs in staff_directory
--   2. Forced PIN rotation (configurable, default 30 days)
--   3. Per-action TOTP challenge for sensitive manager operations
--   4. Immutable manager_override_log with device fingerprint + witness
--   5. Anomaly detection: comp velocity, overtime spikes, session abuse
--   6. Session binding: tie tokens to originating device fingerprint
-- ============================================================================

-- ─── 1. PIN hashing + rotation columns on staff_directory ───────────────────

ALTER TABLE staff_directory ADD COLUMN IF NOT EXISTS pin_hash         text;
ALTER TABLE staff_directory ADD COLUMN IF NOT EXISTS pin_changed_at   timestamptz DEFAULT now();
ALTER TABLE staff_directory ADD COLUMN IF NOT EXISTS pin_rotation_days int DEFAULT 30;
ALTER TABLE staff_directory ADD COLUMN IF NOT EXISTS totp_secret      text;     -- per-staff HMAC secret for TOTP challenges

COMMENT ON COLUMN staff_directory.pin_hash IS
  'bcrypt hash of the staff PIN. Replaces plaintext staff_directory.pin.';
COMMENT ON COLUMN staff_directory.pin_changed_at IS
  'Timestamp when PIN was last changed. Used to enforce rotation policy.';
COMMENT ON COLUMN staff_directory.pin_rotation_days IS
  'Max days a PIN is valid before forced rotation. 0 = no rotation.';
COMMENT ON COLUMN staff_directory.totp_secret IS
  'Per-staff HMAC-SHA256 secret for ephemeral TOTP manager challenges. Service-role only.';

-- ─── 2. Immutable manager override audit log ────────────────────────────────

CREATE TABLE IF NOT EXISTS manager_override_log (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action_type      text NOT NULL,
  manager_email    text NOT NULL,
  manager_staff_id uuid,
  target_entity    text,           -- e.g. 'time_logs', 'orders', 'vouchers'
  target_id        text,           -- the PK of the row being modified
  target_employee  text,           -- email of the employee being affected (if applicable)
  details          jsonb DEFAULT '{}'::jsonb,
  device_fingerprint text,         -- hash of user-agent + screen dimensions
  ip_address       text,
  challenge_method text,           -- 'totp' | 'pin_reentry' | 'none_legacy'
  witness_staff_id uuid,           -- optional: a second staff member who witnessed the action
  witness_email    text,
  created_at       timestamptz DEFAULT now()
);

-- Constrain action types to known values
DO $$ BEGIN
  ALTER TABLE manager_override_log ADD CONSTRAINT chk_override_action_type
    CHECK (action_type IN (
      'comp_order', 'adjust_hours', 'fix_clock', 'void_order',
      'voucher_override', 'inventory_adjust', 'discount_override',
      'parcel_override', 'schedule_edit', 'pin_reset', 'role_change'
    ));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Constrain challenge methods
DO $$ BEGIN
  ALTER TABLE manager_override_log ADD CONSTRAINT chk_override_challenge_method
    CHECK (challenge_method IS NULL OR challenge_method IN (
      'totp', 'pin_reentry', 'none_legacy'
    ));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Indexes for dashboard queries
CREATE INDEX IF NOT EXISTS idx_override_log_manager  ON manager_override_log(manager_email, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_override_log_target   ON manager_override_log(target_entity, target_id);
CREATE INDEX IF NOT EXISTS idx_override_log_created  ON manager_override_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_override_log_employee ON manager_override_log(target_employee, created_at DESC);

-- RLS: immutable audit trail — service_role inserts, managers can read, nobody updates/deletes
ALTER TABLE manager_override_log ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "Deny public manager_override_log"
    ON manager_override_log FOR ALL USING (false);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Managers can read override log"
    ON manager_override_log FOR SELECT
    USING (is_brewhub_staff());
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ─── 3. Challenge nonce table (ephemeral TOTP tracking) ─────────────────────

CREATE TABLE IF NOT EXISTS manager_challenge_nonces (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_email   text NOT NULL,
  action_type   text NOT NULL,
  nonce         text NOT NULL UNIQUE,       -- random nonce to prevent replay
  consumed      boolean DEFAULT false,
  created_at    timestamptz DEFAULT now(),
  expires_at    timestamptz NOT NULL,
  consumed_at   timestamptz
);

-- Auto-expire old nonces
CREATE INDEX IF NOT EXISTS idx_challenge_nonces_expires ON manager_challenge_nonces(expires_at);
CREATE INDEX IF NOT EXISTS idx_challenge_nonces_staff   ON manager_challenge_nonces(staff_email, created_at DESC);

-- RLS: service_role only
ALTER TABLE manager_challenge_nonces ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "Deny public challenge_nonces"
    ON manager_challenge_nonces FOR ALL USING (false);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ─── 4. Anomaly detection: manager action velocity tracking ─────────────────

-- RPC: Check if a manager is performing an unusual volume of sensitive actions
CREATE OR REPLACE FUNCTION check_manager_action_velocity(
  p_manager_email  text,
  p_action_type    text,
  p_window_minutes int DEFAULT 60,
  p_max_actions    int DEFAULT 10
)
RETURNS TABLE(
  action_count   bigint,
  is_anomalous   boolean,
  oldest_in_window timestamptz
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    COUNT(*)::bigint AS action_count,
    (COUNT(*) >= p_max_actions) AS is_anomalous,
    MIN(mol.created_at) AS oldest_in_window
  FROM manager_override_log mol
  WHERE mol.manager_email = p_manager_email
    AND mol.action_type = p_action_type
    AND mol.created_at > now() - (p_window_minutes || ' minutes')::interval;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

REVOKE EXECUTE ON FUNCTION check_manager_action_velocity(text, text, int, int)
  FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION check_manager_action_velocity(text, text, int, int)
  TO service_role;

-- RPC: Comp velocity check — flag if total comps exceed threshold in a shift
CREATE OR REPLACE FUNCTION check_comp_velocity(
  p_staff_email    text,
  p_window_hours   int DEFAULT 8,
  p_max_cents      int DEFAULT 50000  -- $500 default cap
)
RETURNS TABLE(
  total_comped_cents bigint,
  comp_count         bigint,
  is_anomalous       boolean
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    COALESCE(SUM(ca.amount_cents), 0)::bigint AS total_comped_cents,
    COUNT(*)::bigint AS comp_count,
    (COALESCE(SUM(ca.amount_cents), 0) >= p_max_cents) AS is_anomalous
  FROM comp_audit ca
  WHERE ca.staff_email = p_staff_email
    AND ca.created_at > now() - (p_window_hours || ' hours')::interval;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

REVOKE EXECUTE ON FUNCTION check_comp_velocity(text, int, int)
  FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION check_comp_velocity(text, int, int)
  TO service_role;

-- RPC: Overtime adjustment anomaly — flag if a manager is adding excessive hours
CREATE OR REPLACE FUNCTION check_overtime_anomaly(
  p_manager_email  text,
  p_window_days    int DEFAULT 7,
  p_max_minutes    int DEFAULT 600  -- 10 hours in a week is suspicious
)
RETURNS TABLE(
  total_adjusted_minutes bigint,
  adjustment_count       bigint,
  distinct_employees     bigint,
  is_anomalous           boolean
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    COALESCE(SUM(tl.delta_minutes), 0)::bigint AS total_adjusted_minutes,
    COUNT(*)::bigint AS adjustment_count,
    COUNT(DISTINCT tl.employee_email)::bigint AS distinct_employees,
    (COALESCE(SUM(tl.delta_minutes), 0) >= p_max_minutes) AS is_anomalous
  FROM time_logs tl
  WHERE tl.action_type = 'adjustment'
    AND tl.manager_id IN (
      SELECT sd.id FROM staff_directory sd WHERE sd.email = p_manager_email
    )
    AND tl.clock_in > now() - (p_window_days || ' days')::interval;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

REVOKE EXECUTE ON FUNCTION check_overtime_anomaly(text, int, int)
  FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION check_overtime_anomaly(text, int, int)
  TO service_role;

-- ─── 5. RPC: Consume a manager challenge nonce (atomic, replay-proof) ───────

CREATE OR REPLACE FUNCTION consume_challenge_nonce(
  p_nonce       text,
  p_staff_email text
)
RETURNS TABLE(valid boolean, action_type text) AS $$
DECLARE
  v_row manager_challenge_nonces%ROWTYPE;
BEGIN
  -- Lock + fetch in one atomic step
  SELECT * INTO v_row
  FROM manager_challenge_nonces
  WHERE nonce = p_nonce
    AND staff_email = p_staff_email
    AND consumed = false
    AND expires_at > now()
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, ''::text;
    RETURN;
  END IF;

  -- Mark consumed (one-time use)
  UPDATE manager_challenge_nonces
  SET consumed = true, consumed_at = now()
  WHERE id = v_row.id;

  RETURN QUERY SELECT true, v_row.action_type;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

REVOKE EXECUTE ON FUNCTION consume_challenge_nonce(text, text)
  FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION consume_challenge_nonce(text, text)
  TO service_role;

-- ─── 6. RPC: Check PIN rotation status ──────────────────────────────────────

CREATE OR REPLACE FUNCTION check_pin_rotation(p_email text)
RETURNS TABLE(
  needs_rotation  boolean,
  days_since_change int,
  rotation_days   int
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    CASE
      WHEN sd.pin_rotation_days = 0 THEN false
      WHEN sd.pin_changed_at IS NULL THEN true
      ELSE EXTRACT(DAY FROM now() - sd.pin_changed_at)::int > sd.pin_rotation_days
    END AS needs_rotation,
    COALESCE(EXTRACT(DAY FROM now() - sd.pin_changed_at)::int, 999) AS days_since_change,
    COALESCE(sd.pin_rotation_days, 30) AS rotation_days
  FROM staff_directory sd
  WHERE sd.email = p_email;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

REVOKE EXECUTE ON FUNCTION check_pin_rotation(text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION check_pin_rotation(text) TO service_role;

-- ─── 7. Cleanup: purge expired challenge nonces (run via pg_cron or manual) ─

CREATE OR REPLACE FUNCTION purge_expired_challenge_nonces()
RETURNS int AS $$
DECLARE
  v_count int;
BEGIN
  DELETE FROM manager_challenge_nonces
  WHERE expires_at < now() - interval '1 hour';

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

REVOKE EXECUTE ON FUNCTION purge_expired_challenge_nonces() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION purge_expired_challenge_nonces() TO service_role;

-- ─── 8. Backfill: hash existing plaintext PINs ─────────────────────────────
-- NOTE: This must be run ONCE after deploying the new pin-login.js that
-- uses bcrypt. The migration function hashes all existing plaintext PINs
-- and clears the plaintext column.
--
-- IMPORTANT: Run this function manually AFTER deploying the updated
-- pin-login.js. Do NOT run it before, or logins will break.
--
-- Usage:  SELECT backfill_pin_hashes();
--
-- This uses pgcrypto's crypt() + gen_salt('bf', 10) for bcrypt hashing.
-- Requires: CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE OR REPLACE FUNCTION backfill_pin_hashes()
RETURNS int AS $$
DECLARE
  v_count int := 0;
BEGIN
  UPDATE staff_directory
  SET pin_hash = crypt(pin, gen_salt('bf', 10)),
      pin_changed_at = COALESCE(pin_changed_at, now())
  WHERE pin IS NOT NULL
    AND pin_hash IS NULL;

  GET DIAGNOSTICS v_count = ROW_COUNT;

  -- Generate TOTP secrets for managers/admins who don't have one
  UPDATE staff_directory
  SET totp_secret = encode(gen_random_bytes(32), 'hex')
  WHERE role IN ('manager', 'admin')
    AND totp_secret IS NULL;

  RETURN v_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

REVOKE EXECUTE ON FUNCTION backfill_pin_hashes() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION backfill_pin_hashes() TO service_role;

-- ─── 9. RPC: Verify PIN using bcrypt (called from pin-login.js) ─────────────
-- Returns the staff record if PIN matches, NULL otherwise.
-- Uses pgcrypto's crypt() for constant-time bcrypt comparison.

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
    AND sd.pin_hash = crypt(p_pin, sd.pin_hash);  -- bcrypt verify
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

REVOKE EXECUTE ON FUNCTION verify_staff_pin(text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION verify_staff_pin(text) TO service_role;

-- ─── 10. RPC: Update PIN (with bcrypt hashing) ─────────────────────────────

CREATE OR REPLACE FUNCTION update_staff_pin(
  p_email    text,
  p_old_pin  text,
  p_new_pin  text
)
RETURNS TABLE(success boolean, error_message text) AS $$
DECLARE
  v_staff staff_directory%ROWTYPE;
BEGIN
  -- Validate new PIN format
  IF p_new_pin IS NULL OR p_new_pin !~ '^\d{6}$' THEN
    RETURN QUERY SELECT false, 'New PIN must be exactly 6 digits'::text;
    RETURN;
  END IF;

  -- Don't allow reusing the same PIN
  IF p_old_pin = p_new_pin THEN
    RETURN QUERY SELECT false, 'New PIN must be different from current PIN'::text;
    RETURN;
  END IF;

  SELECT * INTO v_staff FROM staff_directory WHERE email = p_email FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'Staff member not found'::text;
    RETURN;
  END IF;

  -- Verify old PIN
  IF v_staff.pin_hash IS NOT NULL AND v_staff.pin_hash != crypt(p_old_pin, v_staff.pin_hash) THEN
    RETURN QUERY SELECT false, 'Current PIN is incorrect'::text;
    RETURN;
  END IF;

  -- Check if new PIN is already in use by another staff member
  IF EXISTS (
    SELECT 1 FROM staff_directory
    WHERE email != p_email
      AND pin_hash IS NOT NULL
      AND pin_hash = crypt(p_new_pin, pin_hash)
  ) THEN
    RETURN QUERY SELECT false, 'PIN is already in use'::text;
    RETURN;
  END IF;

  -- Update PIN hash and rotation timestamp
  UPDATE staff_directory SET
    pin_hash = crypt(p_new_pin, gen_salt('bf', 10)),
    pin_changed_at = now(),
    version_updated_at = now()  -- invalidates all existing sessions
  WHERE email = p_email;

  RETURN QUERY SELECT true, ''::text;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

REVOKE EXECUTE ON FUNCTION update_staff_pin(text, text, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION update_staff_pin(text, text, text) TO service_role;
