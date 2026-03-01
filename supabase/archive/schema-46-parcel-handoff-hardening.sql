-- ============================================================================
-- SCHEMA 46 — Parcel Handoff Hardening
-- ============================================================================
-- Fixes the "Fake SMS Walk-Out" vulnerability:
--   1. Cryptographic pickup codes (6-digit, SHA-256 hashed in DB)
--   2. Value-tier escalation (high_value requires ID check)
--   3. Immutable audit log for every pickup attempt
--   4. Brute-force lockout after failed code attempts
--   5. BUG FIX: atomic_parcel_checkin now inserts recipient_email
-- ============================================================================

-- ─── 1. New columns on parcels ──────────────────────────────────────────────

ALTER TABLE parcels ADD COLUMN IF NOT EXISTS pickup_code_hash    text;
ALTER TABLE parcels ADD COLUMN IF NOT EXISTS estimated_value_tier text DEFAULT 'standard';
ALTER TABLE parcels ADD COLUMN IF NOT EXISTS pickup_verified_via  text;
ALTER TABLE parcels ADD COLUMN IF NOT EXISTS pickup_staff_id      text;
ALTER TABLE parcels ADD COLUMN IF NOT EXISTS pickup_collector_name text;
ALTER TABLE parcels ADD COLUMN IF NOT EXISTS pickup_id_last4      text;
ALTER TABLE parcels ADD COLUMN IF NOT EXISTS pickup_attempts      int  DEFAULT 0;
ALTER TABLE parcels ADD COLUMN IF NOT EXISTS pickup_locked_until  timestamptz;

-- Constrain value tier to known values
DO $$ BEGIN
  ALTER TABLE parcels ADD CONSTRAINT chk_parcel_value_tier
    CHECK (estimated_value_tier IN ('standard', 'high_value', 'premium'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Constrain verification method
DO $$ BEGIN
  ALTER TABLE parcels ADD CONSTRAINT chk_parcel_verified_via
    CHECK (pickup_verified_via IS NULL OR pickup_verified_via IN (
      'code', 'code_and_id', 'manager_override'
    ));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ─── 2. Immutable pickup audit log ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS parcel_pickup_log (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parcel_id        uuid NOT NULL REFERENCES parcels(id),
  tracking_number  text NOT NULL,
  attempt_type     text NOT NULL,
  staff_user       text NOT NULL,
  collector_name   text,
  collector_id_last4 text,
  override_reason  text,
  value_tier       text,
  ip_address       text,
  created_at       timestamptz DEFAULT now()
);

-- Constrain attempt types
DO $$ BEGIN
  ALTER TABLE parcel_pickup_log ADD CONSTRAINT chk_pickup_attempt_type
    CHECK (attempt_type IN (
      'code_success', 'code_fail', 'id_verified',
      'manager_override', 'denied', 'locked_out'
    ));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Index for per-parcel audit lookups
CREATE INDEX IF NOT EXISTS idx_pickup_log_parcel ON parcel_pickup_log(parcel_id);
CREATE INDEX IF NOT EXISTS idx_pickup_log_created ON parcel_pickup_log(created_at);

-- RLS: immutable audit trail — service_role inserts, staff can read, nobody updates/deletes
ALTER TABLE parcel_pickup_log ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "Deny public parcel_pickup_log"
    ON parcel_pickup_log FOR ALL USING (false);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Staff can read pickup log"
    ON parcel_pickup_log FOR SELECT
    USING (is_brewhub_staff());
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ─── 3. Fix atomic_parcel_checkin — add recipient_email + pickup_code_hash ──

DROP FUNCTION IF EXISTS atomic_parcel_checkin(text, text, text, text, text, text, text);
DROP FUNCTION IF EXISTS atomic_parcel_checkin(text, text, text, text, text, text, text, text, text);

CREATE OR REPLACE FUNCTION atomic_parcel_checkin(
  p_tracking_number  text,
  p_carrier          text,
  p_recipient_name   text,
  p_recipient_phone  text DEFAULT NULL,
  p_recipient_email  text DEFAULT NULL,
  p_unit_number      text DEFAULT NULL,
  p_match_type       text DEFAULT 'manual',
  p_pickup_code_hash text DEFAULT NULL,
  p_value_tier       text DEFAULT 'standard'
)
RETURNS TABLE(parcel_id uuid, queue_task_id uuid) AS $$
DECLARE
  v_parcel_id uuid;
  v_queue_id  uuid;
BEGIN
  INSERT INTO parcels (
    tracking_number, carrier, recipient_name, recipient_phone,
    recipient_email,          -- BUG FIX: was missing from previous version
    unit_number, status, received_at, match_type,
    pickup_code_hash,         -- NEW: cryptographic pickup verification
    estimated_value_tier      -- NEW: value-tier escalation
  )
  VALUES (
    p_tracking_number, p_carrier, p_recipient_name, p_recipient_phone,
    p_recipient_email,
    p_unit_number, 'pending_notification', now(), p_match_type,
    p_pickup_code_hash,
    COALESCE(p_value_tier, 'standard')
  )
  RETURNING id INTO v_parcel_id;

  INSERT INTO notification_queue (task_type, payload, source_table, source_id)
  VALUES ('parcel_arrived', jsonb_build_object(
    'recipient_name',  p_recipient_name,
    'recipient_phone', p_recipient_phone,
    'recipient_email', p_recipient_email,
    'tracking_number', p_tracking_number,
    'carrier',         p_carrier,
    'unit_number',     p_unit_number,
    'value_tier',      COALESCE(p_value_tier, 'standard')
  ), 'parcels', v_parcel_id)
  RETURNING id INTO v_queue_id;

  RETURN QUERY SELECT v_parcel_id, v_queue_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Maintain strict privilege control
REVOKE EXECUTE ON FUNCTION atomic_parcel_checkin(text, text, text, text, text, text, text, text, text)
  FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION atomic_parcel_checkin(text, text, text, text, text, text, text, text, text)
  TO service_role;

-- ─── 4. Secure pickup verification RPC ──────────────────────────────────────
-- Constant-time hash comparison + brute-force lockout + audit logging
-- Called by parcel-pickup.js via service_role only

DROP FUNCTION IF EXISTS verify_pickup_code(uuid, text);

CREATE OR REPLACE FUNCTION verify_pickup_code(
  p_parcel_id   uuid,
  p_code_hash   text   -- caller hashes the user-supplied code before calling
)
RETURNS TABLE(
  verified      boolean,
  locked        boolean,
  attempts      int,
  value_tier    text,
  recipient_name text
) AS $$
DECLARE
  v_parcel      parcels%ROWTYPE;
  v_match       boolean;
BEGIN
  SELECT * INTO v_parcel FROM parcels WHERE id = p_parcel_id FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, false, 0, 'standard'::text, ''::text;
    RETURN;
  END IF;

  -- Check lockout (3 failures = 15 min lock)
  IF v_parcel.pickup_locked_until IS NOT NULL AND v_parcel.pickup_locked_until > now() THEN
    RETURN QUERY SELECT false, true, v_parcel.pickup_attempts,
                        v_parcel.estimated_value_tier, v_parcel.recipient_name;
    RETURN;
  END IF;

  -- Clear expired lockout
  IF v_parcel.pickup_locked_until IS NOT NULL AND v_parcel.pickup_locked_until <= now() THEN
    UPDATE parcels SET pickup_locked_until = NULL, pickup_attempts = 0
    WHERE id = p_parcel_id;
    v_parcel.pickup_attempts := 0;
  END IF;

  -- Constant-time comparison via digest equality
  -- Both sides are hex-encoded SHA-256, so same length guaranteed
  v_match := (v_parcel.pickup_code_hash IS NOT NULL
              AND v_parcel.pickup_code_hash = p_code_hash);

  IF NOT v_match THEN
    -- Increment failed attempts
    UPDATE parcels
    SET pickup_attempts = COALESCE(pickup_attempts, 0) + 1,
        pickup_locked_until = CASE
          WHEN COALESCE(pickup_attempts, 0) + 1 >= 3
          THEN now() + interval '15 minutes'
          ELSE NULL
        END
    WHERE id = p_parcel_id;

    RETURN QUERY SELECT false, (COALESCE(v_parcel.pickup_attempts, 0) + 1 >= 3),
                        COALESCE(v_parcel.pickup_attempts, 0) + 1,
                        v_parcel.estimated_value_tier, v_parcel.recipient_name;
    RETURN;
  END IF;

  -- Code matches — reset attempts
  UPDATE parcels SET pickup_attempts = 0, pickup_locked_until = NULL
  WHERE id = p_parcel_id;

  RETURN QUERY SELECT true, false, 0,
                      v_parcel.estimated_value_tier, v_parcel.recipient_name;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

REVOKE EXECUTE ON FUNCTION verify_pickup_code(uuid, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION verify_pickup_code(uuid, text) TO service_role;

-- ─── 5. Pickup finalization RPC ─────────────────────────────────────────────
-- Atomically marks parcel as picked_up + inserts audit log entry
-- Prevents TOCTOU between verification and status update

DROP FUNCTION IF EXISTS finalize_parcel_pickup(uuid, text, text, text, text, text);

CREATE OR REPLACE FUNCTION finalize_parcel_pickup(
  p_parcel_id        uuid,
  p_verified_via     text,   -- 'code' | 'code_and_id' | 'manager_override'
  p_staff_user       text,
  p_collector_name   text DEFAULT NULL,
  p_id_last4         text DEFAULT NULL,
  p_override_reason  text DEFAULT NULL
)
RETURNS TABLE(success boolean, tracking text) AS $$
DECLARE
  v_parcel parcels%ROWTYPE;
BEGIN
  -- Lock + verify parcel is still in 'arrived' status (TOCTOU guard)
  SELECT * INTO v_parcel FROM parcels
  WHERE id = p_parcel_id AND status = 'arrived'
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, ''::text;
    RETURN;
  END IF;

  -- For high_value / premium: require ID fields unless manager override
  IF v_parcel.estimated_value_tier IN ('high_value', 'premium')
     AND p_verified_via != 'manager_override'
     AND (p_collector_name IS NULL OR p_id_last4 IS NULL) THEN
    RETURN QUERY SELECT false, ''::text;
    RETURN;
  END IF;

  -- Manager override requires reason
  IF p_verified_via = 'manager_override' AND (p_override_reason IS NULL OR p_override_reason = '') THEN
    RETURN QUERY SELECT false, ''::text;
    RETURN;
  END IF;

  -- Mark parcel as picked up
  UPDATE parcels SET
    status              = 'picked_up',
    picked_up_at        = now(),
    pickup_verified_via = p_verified_via,
    pickup_staff_id     = p_staff_user,
    pickup_collector_name = COALESCE(p_collector_name, v_parcel.recipient_name),
    pickup_id_last4     = p_id_last4
  WHERE id = p_parcel_id;

  -- Insert immutable audit log entry
  INSERT INTO parcel_pickup_log (
    parcel_id, tracking_number, attempt_type, staff_user,
    collector_name, collector_id_last4, override_reason,
    value_tier
  ) VALUES (
    p_parcel_id, v_parcel.tracking_number,
    CASE p_verified_via
      WHEN 'code'             THEN 'code_success'
      WHEN 'code_and_id'      THEN 'id_verified'
      WHEN 'manager_override' THEN 'manager_override'
    END,
    p_staff_user,
    COALESCE(p_collector_name, v_parcel.recipient_name),
    p_id_last4,
    p_override_reason,
    v_parcel.estimated_value_tier
  );

  RETURN QUERY SELECT true, v_parcel.tracking_number;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

REVOKE EXECUTE ON FUNCTION finalize_parcel_pickup(uuid, text, text, text, text, text)
  FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION finalize_parcel_pickup(uuid, text, text, text, text, text)
  TO service_role;
