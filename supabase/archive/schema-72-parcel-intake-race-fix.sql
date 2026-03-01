-- ============================================================
-- SCHEMA 72: Parcel Intake Race Condition Fix
-- Date: 2026-02-27
-- Critical: Prevents duplicate parcel rows + "Double Flip"
--           notification glitch on concurrent check-ins.
-- ============================================================
--
-- PROBLEMS FIXED:
--   1. idx_parcels_tracking_arrived only covers status='arrived',
--      but atomic_parcel_checkin inserts 'pending_notification'.
--      Two concurrent non-notification check-ins bypass the index.
--   2. expected_parcels lookup in JS is non-locking. Two workers
--      can both read status='pending', both flip to 'arrived',
--      and both insert duplicate parcel rows + notifications.
--   3. The flip + insert happen in separate transactions / calls.
--
-- SOLUTION:
--   • Widen unique partial index to cover ALL active statuses.
--   • New safe_parcel_checkin RPC with row-level FOR UPDATE locks
--     on both parcels and expected_parcels inside ONE transaction.
--   • Achieves effectively SERIALIZABLE isolation for the parcel
--     intake hot path without the spurious retry overhead of true
--     SERIALIZABLE mode.
-- ============================================================

BEGIN;

-- ═══════════════════════════════════════════════════════════════════
-- 1. Widen unique partial index to cover all active parcel statuses
-- ═══════════════════════════════════════════════════════════════════
-- The legacy index from schema-37 only prevented duplicate 'arrived'
-- rows. Concurrent 'pending_notification' inserts slipped through.

DROP INDEX IF EXISTS idx_parcels_tracking_arrived;

CREATE UNIQUE INDEX idx_parcels_tracking_active
  ON parcels (tracking_number)
  WHERE (status IN ('arrived', 'pending_notification'));

-- ═══════════════════════════════════════════════════════════════════
-- 2. safe_parcel_checkin — race-condition-hardened replacement for
--    atomic_parcel_checkin. Supersedes schema-46 version.
-- ═══════════════════════════════════════════════════════════════════
-- Transaction flow:
--   LOCK 1  → SELECT ... FOR UPDATE on parcels (same tracking, active)
--           → RAISE if duplicate found
--   LOCK 2  → SELECT ... FOR UPDATE on expected_parcels (pending)
--           → Flip to 'arrived' if found (prevents Double Flip)
--   INSERT  → parcels row (status depends on skip_notification)
--   INSERT  → notification_queue (unless skip_notification)
--   RETURN  → parcel_id, queue_task_id, match info
-- ═══════════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS safe_parcel_checkin(text,text,text,text,text,text,text,text,text,boolean);

CREATE OR REPLACE FUNCTION safe_parcel_checkin(
  p_tracking_number   text,
  p_carrier           text,
  p_recipient_name    text DEFAULT NULL,
  p_recipient_phone   text DEFAULT NULL,
  p_recipient_email   text DEFAULT NULL,
  p_unit_number       text DEFAULT NULL,
  p_match_type        text DEFAULT 'manual',
  p_pickup_code_hash  text DEFAULT NULL,
  p_value_tier        text DEFAULT 'standard',
  p_skip_notification boolean DEFAULT false
)
RETURNS TABLE(
  parcel_id               uuid,
  queue_task_id           uuid,
  resolved_match_type     text,
  expected_customer_name  text,
  expected_customer_phone text,
  expected_customer_email text,
  expected_unit_number    text
) AS $$
DECLARE
  v_parcel_id  uuid;
  v_queue_id   uuid;
  v_existing   uuid;
  v_expected   RECORD;
  v_name       text;
  v_phone      text;
  v_email      text;
  v_unit       text;
  v_match      text;
BEGIN
  -- ── LOCK 1: Acquire exclusive lock on any existing active parcel ──
  -- Blocks concurrent check-ins for the same tracking_number until
  -- this transaction commits. If found, the parcel is a duplicate.
  SELECT p.id INTO v_existing
  FROM parcels p
  WHERE p.tracking_number = p_tracking_number
    AND p.status IN ('arrived', 'pending_notification')
  FOR UPDATE;

  IF v_existing IS NOT NULL THEN
    RAISE EXCEPTION 'Parcel already checked in'
      USING ERRCODE = 'unique_violation', HINT = 'DUPLICATE_PARCEL';
  END IF;

  -- ── LOCK 2: Acquire exclusive lock on expected_parcels row ────────
  -- Prevents the "Double Flip" glitch: two concurrent workers both
  -- reading status='pending' and both flipping to 'arrived'.
  SELECT ep.* INTO v_expected
  FROM expected_parcels ep
  WHERE ep.tracking_number = p_tracking_number
    AND ep.status = 'pending'
  FOR UPDATE;

  -- ── Resolve final recipient info ──────────────────────────────────
  IF v_expected IS NOT NULL THEN
    -- Pre-registered match: use expected parcel data + flip status
    UPDATE expected_parcels
    SET status = 'arrived', arrived_at = now()
    WHERE id = v_expected.id;

    v_name  := COALESCE(NULLIF(trim(p_recipient_name), ''), v_expected.customer_name);
    v_phone := COALESCE(p_recipient_phone, v_expected.customer_phone);
    v_email := COALESCE(p_recipient_email, v_expected.customer_email);
    v_unit  := COALESCE(p_unit_number, v_expected.unit_number);
    v_match := 'pre-registered';
  ELSE
    -- Manual / Philly Way match
    v_name  := p_recipient_name;
    v_phone := p_recipient_phone;
    v_email := p_recipient_email;
    v_unit  := p_unit_number;
    v_match := COALESCE(p_match_type, 'manual');
  END IF;

  -- ── Guard: must have a recipient name from SOME source ────────────
  IF v_name IS NULL OR trim(v_name) = '' THEN
    RAISE EXCEPTION 'No pre-registration found and no recipient name provided'
      USING ERRCODE = 'P0002', HINT = 'MISSING_RECIPIENT';
  END IF;

  -- ── INSERT parcel ─────────────────────────────────────────────────
  INSERT INTO parcels (
    tracking_number, carrier, recipient_name, recipient_phone,
    recipient_email, unit_number, status, received_at, match_type,
    pickup_code_hash, estimated_value_tier
  )
  VALUES (
    p_tracking_number, p_carrier, v_name, v_phone,
    v_email, v_unit,
    CASE WHEN p_skip_notification THEN 'arrived' ELSE 'pending_notification' END,
    now(), v_match, p_pickup_code_hash,
    COALESCE(p_value_tier, 'standard')
  )
  RETURNING id INTO v_parcel_id;

  -- ── QUEUE notification (unless skip_notification) ─────────────────
  IF NOT COALESCE(p_skip_notification, false) THEN
    INSERT INTO notification_queue (task_type, payload, source_table, source_id)
    VALUES ('parcel_arrived', jsonb_build_object(
      'recipient_name',  v_name,
      'recipient_phone', v_phone,
      'recipient_email', v_email,
      'tracking_number', p_tracking_number,
      'carrier',         p_carrier,
      'unit_number',     v_unit,
      'value_tier',      COALESCE(p_value_tier, 'standard')
    ), 'parcels', v_parcel_id)
    RETURNING id INTO v_queue_id;
  END IF;

  RETURN QUERY SELECT
    v_parcel_id,
    v_queue_id,
    v_match,
    v_expected.customer_name,
    v_expected.customer_phone,
    v_expected.customer_email,
    v_expected.unit_number;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ═══════════════════════════════════════════════════════════════════
-- 3. Permissions: service_role only (same policy as atomic_parcel_checkin)
-- ═══════════════════════════════════════════════════════════════════
REVOKE EXECUTE ON FUNCTION safe_parcel_checkin(text,text,text,text,text,text,text,text,text,boolean)
  FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION safe_parcel_checkin(text,text,text,text,text,text,text,text,text,boolean)
  TO service_role;

COMMIT;
