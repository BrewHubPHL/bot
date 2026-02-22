-- ═══════════════════════════════════════════════════════════════
-- SCHEMA-44: Restore hash-first voucher lookup (regression fix)
-- ═══════════════════════════════════════════════════════════════
-- Schema-39 replaced atomic_redeem_voucher with a version that
-- only does plaintext lookup (WHERE code = upper(...)), dropping
-- the hash-first lookup + plaintext fallback + opportunistic
-- backfill that schema-35 introduced.
--
-- This migration restores the hash-first path while preserving
-- schema-39's timeout guards (5s statement, 3s lock).
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION atomic_redeem_voucher(
  p_voucher_code      text,
  p_order_id          uuid,
  p_user_id           uuid    DEFAULT NULL,
  p_manager_override  boolean DEFAULT false
)
RETURNS TABLE(success boolean, voucher_id uuid, error_code text, error_message text) AS $$
DECLARE
  v_voucher   RECORD;
  v_order     RECORD;
  v_lock_key  bigint;
  v_code_hash text;
  v_daily_count int;
BEGIN
  -- DEADLOCK DEFENSE: 5-second cap on the entire voucher flow (from schema-39)
  SET LOCAL statement_timeout = '5s';
  SET LOCAL lock_timeout      = '3s';

  -- ── INPUT VALIDATION ──────────────────────────────────────
  IF p_voucher_code IS NULL OR length(p_voucher_code) < 4 THEN
    RETURN QUERY SELECT false, NULL::uuid, 'INVALID_CODE'::text,
      'Voucher code too short'::text;
    RETURN;
  END IF;

  IF length(p_voucher_code) > 100 THEN
    RETURN QUERY SELECT false, NULL::uuid, 'INVALID_CODE'::text,
      'Voucher code too long'::text;
    RETURN;
  END IF;

  -- ── COMPUTE HASH ──────────────────────────────────────────
  v_code_hash := encode(digest(upper(p_voucher_code), 'sha256'), 'hex');

  -- ── PRIMARY LOOKUP: by hash (new path — from schema-35) ───
  SELECT id, user_id, is_redeemed
    INTO v_voucher
    FROM vouchers
   WHERE code_hash = v_code_hash
     FOR UPDATE SKIP LOCKED;

  -- ── FALLBACK LOOKUP: plaintext for un-backfilled rows ─────
  IF v_voucher IS NULL THEN
    SELECT id, user_id, is_redeemed
      INTO v_voucher
      FROM vouchers
     WHERE upper(code) = upper(p_voucher_code)
       AND code_hash IS NULL
       FOR UPDATE SKIP LOCKED;

    -- Opportunistic backfill while we hold the lock
    IF v_voucher IS NOT NULL THEN
      UPDATE vouchers SET code_hash = v_code_hash WHERE id = v_voucher.id;
    END IF;
  END IF;

  IF v_voucher IS NULL THEN
    RETURN QUERY SELECT false, NULL::uuid,
      'VOUCHER_NOT_FOUND'::text,
      'Voucher not found or already being processed'::text;
    RETURN;
  END IF;

  IF v_voucher.is_redeemed THEN
    RETURN QUERY SELECT false, NULL::uuid,
      'ALREADY_REDEEMED'::text,
      'This voucher has already been used'::text;
    RETURN;
  END IF;

  -- ── ADVISORY LOCK (per-user serialisation) ────────────────
  v_lock_key := hashtext('voucher_lock:' || COALESCE(v_voucher.user_id::text, 'guest'));
  PERFORM pg_advisory_xact_lock(v_lock_key);

  -- ── REFUND-LOCK CHECK ─────────────────────────────────────
  IF EXISTS (
    SELECT 1 FROM refund_locks
     WHERE user_id = v_voucher.user_id
       AND locked_at > now() - interval '5 minutes'
  ) THEN
    RETURN QUERY SELECT false, NULL::uuid,
      'REFUND_IN_PROGRESS'::text,
      'Account locked due to pending refund. Please wait.'::text;
    RETURN;
  END IF;

  -- ── DAILY LIMIT (3 per user per day) unless manager bypass ─
  IF NOT COALESCE(p_manager_override, false) AND v_voucher.user_id IS NOT NULL THEN
    SELECT count(*)::int INTO v_daily_count
      FROM vouchers
     WHERE user_id = v_voucher.user_id
       AND is_redeemed = true
       AND redeemed_at >= (current_date AT TIME ZONE 'America/New_York');
    IF v_daily_count >= 3 THEN
      RETURN QUERY SELECT false, NULL::uuid,
        'DAILY_LIMIT'::text,
        'Free drink limit reached (3 per day)'::text;
      RETURN;
    END IF;
  END IF;

  -- ── ORDER VALIDATION ──────────────────────────────────────
  IF p_order_id IS NOT NULL THEN
    SELECT id, user_id, status INTO v_order FROM orders WHERE id = p_order_id;
    IF v_order IS NULL THEN
      RETURN QUERY SELECT false, NULL::uuid,
        'ORDER_NOT_FOUND'::text, 'Order not found'::text;
      RETURN;
    END IF;
    IF v_order.status IN ('paid', 'refunded') THEN
      RETURN QUERY SELECT false, NULL::uuid,
        'ORDER_COMPLETE'::text,
        'Cannot apply voucher to completed order'::text;
      RETURN;
    END IF;
    IF v_voucher.user_id IS NOT NULL AND v_voucher.user_id != v_order.user_id THEN
      RETURN QUERY SELECT false, NULL::uuid,
        'OWNERSHIP_MISMATCH'::text,
        'This voucher belongs to a different customer'::text;
      RETURN;
    END IF;
  END IF;

  -- ── BURN THE VOUCHER (CAS guard) ─────────────────────────
  UPDATE vouchers
     SET is_redeemed = true,
         redeemed_at = now(),
         applied_to_order_id = p_order_id,
         -- Post-burn plaintext scrub (from schema-35): wipe code, keep hash
         code = '***REDEEMED***'
   WHERE id = v_voucher.id
     AND is_redeemed = false;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, NULL::uuid,
      'RACE_CONDITION'::text,
      'Voucher was redeemed by another request'::text;
    RETURN;
  END IF;

  -- ── ZERO OUT ORDER ────────────────────────────────────────
  IF p_order_id IS NOT NULL THEN
    UPDATE orders
       SET total_amount_cents = 0,
           status = 'paid',
           notes = COALESCE(notes || ' | ', '') || 'Voucher redeemed'
     WHERE id = p_order_id;
  END IF;

  RETURN QUERY SELECT true, v_voucher.id, NULL::text, NULL::text;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ── PERMISSIONS ─────────────────────────────────────────────
REVOKE EXECUTE ON FUNCTION atomic_redeem_voucher(text, uuid, uuid, boolean)
  FROM anon, authenticated;
GRANT  EXECUTE ON FUNCTION atomic_redeem_voucher(text, uuid, uuid, boolean)
  TO service_role;

COMMENT ON FUNCTION atomic_redeem_voucher IS
  'Schema-44: Restored hash-first lookup from schema-35 + timeout guards from schema-39. '
  'Primary path: code_hash index. Fallback: plaintext for un-backfilled rows with opportunistic backfill. '
  'Post-burn scrubs plaintext code. 5s/3s timeout guards.';
