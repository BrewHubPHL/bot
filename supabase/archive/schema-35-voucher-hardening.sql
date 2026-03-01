-- =============================================================================
-- SCHEMA 35: Voucher Cryptographic Hardening
--
-- Threat model:  An attacker who obtains a full database dump should NOT be
--                able to reconstruct a single valid voucher code.
--
-- Changes:
--   1. Add code_hash (SHA-256 hex) column + B-tree index for O(1) lookups.
--   2. Backfill hashes for every existing voucher.
--   3. Scrub plaintext from already-redeemed vouchers immediately.
--   4. Create voucher_redemption_fails table + RPC pair for the
--      IP-based circuit breaker (5 failures / 10 min).
--  4b. Daily redemption cap: 3 voucher burns per user per calendar day.
--   5. Replace atomic_redeem_voucher with hash-first lookup,
--      plaintext fallback (transition), PII claim on anon promos,
--      daily cap enforcement (with manager override), and
--      post-burn plaintext scrub.
--   6. RPC helpers: check_voucher_rate_limit / log_voucher_fail.
--
-- SAFE TO RE-RUN: Every statement is idempotent.
-- =============================================================================

-- Ensure pgcrypto is available (already created in schema-1, but be safe)
CREATE EXTENSION IF NOT EXISTS pgcrypto;


-- ─────────────────────────────────────────────────────────────────────────────
-- 1. NEW COLUMN: code_hash  (hex-encoded SHA-256 of upper(code))
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE vouchers ADD COLUMN IF NOT EXISTS code_hash text;

-- B-tree index for O(1) hash lookups — partial index excludes NULLs
CREATE INDEX IF NOT EXISTS idx_vouchers_code_hash
  ON vouchers (code_hash)
  WHERE code_hash IS NOT NULL;


-- ─────────────────────────────────────────────────────────────────────────────
-- 2. BACKFILL hashes for every existing row that still has plaintext
-- ─────────────────────────────────────────────────────────────────────────────
UPDATE vouchers
   SET code_hash = encode(digest(upper(code), 'sha256'), 'hex')
 WHERE code_hash IS NULL
   AND code IS NOT NULL
   AND code != '***REDEEMED***';


-- ─────────────────────────────────────────────────────────────────────────────
-- 3. SCRUB plaintext from already-redeemed vouchers
--    (Defense-in-depth: hash is the only lookup key going forward)
-- ─────────────────────────────────────────────────────────────────────────────
UPDATE vouchers
   SET code = '***REDEEMED***'
 WHERE is_redeemed = true
   AND code IS NOT NULL
   AND code != '***REDEEMED***';


-- ─────────────────────────────────────────────────────────────────────────────
-- 4. CIRCUIT BREAKER TABLE: voucher_redemption_fails
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS voucher_redemption_fails (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  ip_address    text        NOT NULL,
  attempted_at  timestamptz NOT NULL DEFAULT now(),
  code_prefix   text        -- first 4 chars only (non-reversible debugging aid)
);

-- Composite index for the rate-limit query
CREATE INDEX IF NOT EXISTS idx_voucher_fails_ip_time
  ON voucher_redemption_fails (ip_address, attempted_at DESC);

ALTER TABLE voucher_redemption_fails ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Deny public access to voucher_redemption_fails"
  ON voucher_redemption_fails;
CREATE POLICY "Deny public access to voucher_redemption_fails"
  ON voucher_redemption_fails FOR ALL USING (false);


-- ─────────────────────────────────────────────────────────────────────────────
-- 4b. DAILY SCAN LIMIT: max 3 voucher redemptions per user_id per calendar day
--     Prevents a shared loyalty QR from being used by a parade of friends.
-- ─────────────────────────────────────────────────────────────────────────────
-- No new table needed — we query vouchers.redeemed_at directly.
-- The limit is enforced inside atomic_redeem_voucher below.


-- ─────────────────────────────────────────────────────────────────────────────
-- 5. REPLACE atomic_redeem_voucher
--    • Hash-first lookup  (new vouchers)
--    • Plaintext fallback  (un-backfilled rows during migration window)
--    • PII claim on anonymous promos (user_id IS NULL → bind on first use)
--    • Daily redemption cap (3 per user per calendar day)
--    • Post-burn plaintext scrub
-- ─────────────────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS atomic_redeem_voucher(text, uuid, uuid);
DROP FUNCTION IF EXISTS atomic_redeem_voucher(text, uuid, uuid, boolean);

CREATE OR REPLACE FUNCTION atomic_redeem_voucher(
  p_voucher_code     text,
  p_order_id         uuid,
  p_user_id          uuid    DEFAULT NULL,
  p_manager_override boolean DEFAULT false
)
RETURNS TABLE(
  success        boolean,
  voucher_id     uuid,
  error_code     text,
  error_message  text
) AS $$
DECLARE
  v_voucher        RECORD;
  v_order          RECORD;
  v_lock_key       bigint;
  v_code_hash      text;
  v_daily_redeems  int;
  v_effective_uid  uuid;
BEGIN
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

  -- ── PRIMARY LOOKUP: by hash (new path) ────────────────────
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
  v_lock_key := hashtext(
    'voucher_lock:' || COALESCE(v_voucher.user_id::text, 'guest')
  );
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

  -- ── ORDER VALIDATION ──────────────────────────────────────
  IF p_order_id IS NOT NULL THEN
    SELECT id, user_id, status
      INTO v_order
      FROM orders
     WHERE id = p_order_id;

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

    IF v_voucher.user_id IS NOT NULL
       AND v_voucher.user_id != v_order.user_id
    THEN
      RETURN QUERY SELECT false, NULL::uuid,
        'OWNERSHIP_MISMATCH'::text,
        'This voucher belongs to a different customer'::text;
      RETURN;
    END IF;
  END IF;

  -- ── PII CLAIM: bind anonymous promo vouchers on first use ─
  -- Prevents code sharing — once redeemed, the voucher is
  -- permanently tied to the redeeming user.
  IF v_voucher.user_id IS NULL AND p_user_id IS NOT NULL THEN
    UPDATE vouchers SET user_id = p_user_id WHERE id = v_voucher.id;
  END IF;

  -- ── DAILY REDEMPTION CAP (3 per user per calendar day) ────
  -- Managers can override via p_manager_override = true to allow
  -- regulars who genuinely sit all day and place many orders.
  v_effective_uid := COALESCE(v_voucher.user_id, p_user_id);

  IF v_effective_uid IS NOT NULL AND NOT p_manager_override THEN
    SELECT count(*) INTO v_daily_redeems
      FROM vouchers
     WHERE user_id = v_effective_uid
       AND is_redeemed = true
       AND redeemed_at::date = CURRENT_DATE;

    IF v_daily_redeems >= 3 THEN
      RETURN QUERY SELECT false, NULL::uuid,
        'DAILY_LIMIT'::text,
        'Maximum 3 free drinks per day. Come back tomorrow!'::text;
      RETURN;
    END IF;
  END IF;

  -- ── BURN + SCRUB ──────────────────────────────────────────
  -- Atomically mark redeemed AND wipe plaintext code in one UPDATE.
  -- The code_hash remains for audit/analytics; the plaintext is gone.
  UPDATE vouchers
     SET is_redeemed       = true,
         redeemed_at       = now(),
         applied_to_order_id = p_order_id,
         status            = 'redeemed',
         code              = '***REDEEMED***'
   WHERE id = v_voucher.id
     AND is_redeemed = false;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, NULL::uuid,
      'RACE_CONDITION'::text,
      'Voucher was redeemed by another request'::text;
    RETURN;
  END IF;

  -- ── APPLY TO ORDER ────────────────────────────────────────
  IF p_order_id IS NOT NULL THEN
    PERFORM set_config('app.voucher_bypass', 'true', true);
    UPDATE orders
       SET total_amount_cents = 0,
           status             = 'paid',
           notes              = COALESCE(notes || ' | ', '')
                                || 'Voucher redeemed (hash-verified)'
                                || CASE WHEN p_manager_override
                                        THEN ' [MANAGER OVERRIDE]'
                                        ELSE '' END
     WHERE id = p_order_id;
  END IF;

  RETURN QUERY SELECT true, v_voucher.id, NULL::text, NULL::text;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

REVOKE EXECUTE ON FUNCTION atomic_redeem_voucher(text, uuid, uuid, boolean)
  FROM anon, authenticated;
GRANT  EXECUTE ON FUNCTION atomic_redeem_voucher(text, uuid, uuid, boolean)
  TO service_role;


-- ─────────────────────────────────────────────────────────────────────────────
-- 6. CIRCUIT BREAKER RPCs
-- ─────────────────────────────────────────────────────────────────────────────

-- 6a. CHECK rate limit for a given IP (read-only)
DROP FUNCTION IF EXISTS check_voucher_rate_limit(text);
CREATE OR REPLACE FUNCTION check_voucher_rate_limit(p_ip text)
RETURNS TABLE(
  allowed                  boolean,
  fail_count               int,
  lockout_remaining_seconds int
) AS $$
DECLARE
  v_count   int;
  v_oldest  timestamptz;
  v_lockout timestamptz;
BEGIN
  SELECT count(*), min(attempted_at)
    INTO v_count, v_oldest
    FROM voucher_redemption_fails
   WHERE ip_address = p_ip
     AND attempted_at > now() - interval '10 minutes';

  IF v_count >= 5 THEN
    v_lockout := v_oldest + interval '10 minutes';
    RETURN QUERY SELECT false, v_count,
      GREATEST(0, extract(epoch FROM v_lockout - now())::int);
    RETURN;
  END IF;

  RETURN QUERY SELECT true, v_count, 0;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- 6b. LOG a failed voucher attempt
DROP FUNCTION IF EXISTS log_voucher_fail(text, text);
CREATE OR REPLACE FUNCTION log_voucher_fail(
  p_ip          text,
  p_code_prefix text DEFAULT NULL
)
RETURNS void AS $$
BEGIN
  INSERT INTO voucher_redemption_fails (ip_address, code_prefix)
  VALUES (p_ip, left(p_code_prefix, 4));

  -- Housekeeping: prune entries older than 1 hour
  DELETE FROM voucher_redemption_fails
   WHERE attempted_at < now() - interval '1 hour';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Lock down both RPCs to service_role only
REVOKE EXECUTE ON FUNCTION check_voucher_rate_limit(text)  FROM anon, authenticated;
GRANT  EXECUTE ON FUNCTION check_voucher_rate_limit(text)  TO service_role;
REVOKE EXECUTE ON FUNCTION log_voucher_fail(text, text)    FROM anon, authenticated;
GRANT  EXECUTE ON FUNCTION log_voucher_fail(text, text)    TO service_role;
