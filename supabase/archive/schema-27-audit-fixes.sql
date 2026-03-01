-- =============================================================================
-- schema-27-audit-fixes.sql
-- Critical fixes identified by 2026-02-20 site audit.
--
-- 1. REVOKE EXECUTE on 5 unprotected SECURITY DEFINER functions
-- 2. Fix prevent_order_amount_tampering trigger to allow voucher redemptions
-- 3. Add updated_at column to orders (required by abandon_stale_orders cron)
-- 4. Add staff SELECT RLS policies for residents and expected_parcels
-- 5. Add performance index on staff_directory(lower(email))
-- 6. Add UNIQUE index on vouchers(upper(code))
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. REVOKE EXECUTE on SECURITY DEFINER functions exposed to anon/authenticated
--    These were callable by anyone via PostgREST RPC, enabling:
--    - cancel_stale_orders: cancel ALL pending orders
--    - atomic_parcel_checkin: inject fake parcels + spam notifications
--    - increment_api_usage: exhaust rate limits (Denial-of-Wallet)
--    - get_low_stock_items: leak inventory intelligence
--    - is_tombstoned: enumerate GDPR-deleted records
-- ─────────────────────────────────────────────────────────────────────────────

REVOKE EXECUTE ON FUNCTION cancel_stale_orders(int) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION cancel_stale_orders(int) TO service_role;

REVOKE EXECUTE ON FUNCTION atomic_parcel_checkin(text, text, text, text, text, text, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION atomic_parcel_checkin(text, text, text, text, text, text, text) TO service_role;

REVOKE EXECUTE ON FUNCTION get_low_stock_items() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION get_low_stock_items() TO service_role;

REVOKE EXECUTE ON FUNCTION increment_api_usage(text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION increment_api_usage(text) TO service_role;

REVOKE EXECUTE ON FUNCTION is_tombstoned(text, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION is_tombstoned(text, text) TO service_role;


-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Fix prevent_order_amount_tampering trigger
--    The trigger unconditionally blocks total_amount_cents changes, but
--    atomic_redeem_voucher legitimately sets total_amount_cents = 0.
--    Fix: Allow the change when the caller is the voucher RPC (detected via
--    a session variable set by the RPC), or when the update is part of a
--    SECURITY DEFINER function context (service_role).
--
--    We use current_setting('app.voucher_bypass', true) which returns NULL
--    if not set, avoiding any error.
-- ─────────────────────────────────────────────────────────────────────────────

DROP TRIGGER IF EXISTS orders_no_amount_tampering ON orders;
DROP FUNCTION IF EXISTS prevent_order_amount_tampering() CASCADE;

CREATE OR REPLACE FUNCTION prevent_order_amount_tampering()
RETURNS TRIGGER AS $$
BEGIN
  -- Allow voucher redemptions: atomic_redeem_voucher sets this before UPDATE
  IF current_setting('app.voucher_bypass', true) = 'true' THEN
    RETURN NEW;
  END IF;

  IF OLD.total_amount_cents IS NOT NULL AND NEW.total_amount_cents <> OLD.total_amount_cents THEN
    RAISE EXCEPTION 'Cannot modify order amount after creation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER orders_no_amount_tampering
  BEFORE UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION prevent_order_amount_tampering();

-- Patch atomic_redeem_voucher to set the bypass flag before the UPDATE
DROP FUNCTION IF EXISTS atomic_redeem_voucher(text, uuid, uuid);
CREATE OR REPLACE FUNCTION atomic_redeem_voucher(p_voucher_code text, p_order_id uuid, p_user_id uuid DEFAULT NULL)
RETURNS TABLE(success boolean, voucher_id uuid, error_code text, error_message text) AS $$
DECLARE
  v_voucher RECORD; v_order RECORD; v_lock_key bigint;
BEGIN
  -- Input validation
  IF length(p_voucher_code) > 100 THEN
    RETURN QUERY SELECT false, NULL::uuid, 'INVALID_CODE'::text, 'Voucher code too long'::text;
    RETURN;
  END IF;

  SELECT id, user_id, is_redeemed INTO v_voucher FROM vouchers WHERE code = upper(p_voucher_code) FOR UPDATE SKIP LOCKED;
  IF v_voucher IS NULL THEN RETURN QUERY SELECT false, NULL::uuid, 'VOUCHER_NOT_FOUND'::text, 'Voucher not found or already being processed'::text; RETURN; END IF;
  IF v_voucher.is_redeemed THEN RETURN QUERY SELECT false, NULL::uuid, 'ALREADY_REDEEMED'::text, 'This voucher has already been used'::text; RETURN; END IF;

  v_lock_key := hashtext('voucher_lock:' || COALESCE(v_voucher.user_id::text, 'guest'));
  PERFORM pg_advisory_xact_lock(v_lock_key);

  IF EXISTS (SELECT 1 FROM refund_locks WHERE user_id = v_voucher.user_id AND locked_at > now() - interval '5 minutes') THEN
    RETURN QUERY SELECT false, NULL::uuid, 'REFUND_IN_PROGRESS'::text, 'Account locked due to pending refund. Please wait.'::text; RETURN;
  END IF;

  IF p_order_id IS NOT NULL THEN
    SELECT id, user_id, status INTO v_order FROM orders WHERE id = p_order_id;
    IF v_order IS NULL THEN RETURN QUERY SELECT false, NULL::uuid, 'ORDER_NOT_FOUND'::text, 'Order not found'::text; RETURN; END IF;
    IF v_order.status IN ('paid', 'refunded') THEN RETURN QUERY SELECT false, NULL::uuid, 'ORDER_COMPLETE'::text, 'Cannot apply voucher to completed order'::text; RETURN; END IF;
    IF v_voucher.user_id IS NOT NULL AND v_voucher.user_id != v_order.user_id THEN
      RETURN QUERY SELECT false, NULL::uuid, 'OWNERSHIP_MISMATCH'::text, 'This voucher belongs to a different customer'::text; RETURN;
    END IF;
  END IF;

  UPDATE vouchers SET is_redeemed = true, redeemed_at = now(), applied_to_order_id = p_order_id WHERE id = v_voucher.id AND is_redeemed = false;
  IF NOT FOUND THEN RETURN QUERY SELECT false, NULL::uuid, 'RACE_CONDITION'::text, 'Voucher was redeemed by another request'::text; RETURN; END IF;

  IF p_order_id IS NOT NULL THEN
    -- Set bypass flag so the anti-tampering trigger allows the price change
    PERFORM set_config('app.voucher_bypass', 'true', true);  -- true = local to transaction
    UPDATE orders SET total_amount_cents = 0, status = 'paid', notes = COALESCE(notes || ' | ', '') || 'Voucher: ' || p_voucher_code WHERE id = p_order_id;
  END IF;

  RETURN QUERY SELECT true, v_voucher.id, NULL::text, NULL::text;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Keep revocation from schema-5
REVOKE EXECUTE ON FUNCTION atomic_redeem_voucher(text, uuid, uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION atomic_redeem_voucher(text, uuid, uuid) TO service_role;


-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Add updated_at column to orders
--    abandon_stale_orders() (schema-25) writes to updated_at but the column
--    didn't exist, causing the cron job to crash every run.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE orders ADD COLUMN IF NOT EXISTS updated_at timestamptz;


-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Staff SELECT RLS policies for residents and expected_parcels
--    Both tables had deny-all but no staff read policy, making parcel
--    check-in and resident search always return empty.
-- ─────────────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "Staff can read residents" ON residents;
CREATE POLICY "Staff can read residents"
  ON residents FOR SELECT
  USING (is_brewhub_staff());

DROP POLICY IF EXISTS "Staff can read expected_parcels" ON expected_parcels;
CREATE POLICY "Staff can read expected_parcels"
  ON expected_parcels FOR SELECT
  USING (is_brewhub_staff());


-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Performance: Index on staff_directory(lower(email))
--    is_brewhub_staff() is evaluated on every RLS-gated query.
--    Without this index, every auth'd request triggers a sequential scan.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_staff_directory_email_lower
  ON staff_directory (lower(email));


-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Voucher code uniqueness + index
--    Prevents duplicate codes and speeds up redemption lookups.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE UNIQUE INDEX IF NOT EXISTS idx_vouchers_code_unique
  ON vouchers (upper(code));
