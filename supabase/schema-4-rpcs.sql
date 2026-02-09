-- ============================================================
-- BREWHUB SCHEMA PART 4: Complex RPCs
-- ============================================================

-- Atomic parcel check-in with notification queue
DROP FUNCTION IF EXISTS atomic_parcel_checkin(text, text, text, text, text, text, text);
CREATE OR REPLACE FUNCTION atomic_parcel_checkin(
  p_tracking_number text, p_carrier text, p_recipient_name text,
  p_recipient_phone text DEFAULT NULL, p_recipient_email text DEFAULT NULL,
  p_unit_number text DEFAULT NULL, p_match_type text DEFAULT 'manual'
)
RETURNS TABLE(parcel_id uuid, queue_task_id uuid) AS $$
DECLARE
  v_parcel_id uuid; v_queue_id uuid;
BEGIN
  INSERT INTO parcels (tracking_number, carrier, recipient_name, recipient_phone, unit_number, status, received_at, match_type)
  VALUES (p_tracking_number, p_carrier, p_recipient_name, p_recipient_phone, p_unit_number, 'pending_notification', now(), p_match_type)
  RETURNING id INTO v_parcel_id;

  INSERT INTO notification_queue (task_type, payload, source_table, source_id)
  VALUES ('parcel_arrived', jsonb_build_object(
    'recipient_name', p_recipient_name, 'recipient_phone', p_recipient_phone,
    'recipient_email', p_recipient_email, 'tracking_number', p_tracking_number,
    'carrier', p_carrier, 'unit_number', p_unit_number
  ), 'parcels', v_parcel_id)
  RETURNING id INTO v_queue_id;

  RETURN QUERY SELECT v_parcel_id, v_queue_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Loyalty points increment
DROP FUNCTION IF EXISTS increment_loyalty(uuid, int, uuid);
CREATE OR REPLACE FUNCTION increment_loyalty(target_user_id uuid, amount_cents int, p_order_id uuid DEFAULT NULL)
RETURNS TABLE(loyalty_points int, voucher_earned boolean, points_awarded int) AS $$
DECLARE
  v_new_points int; v_voucher_earned boolean := false; v_points_delta int; v_previous int := 0;
BEGIN
  IF p_order_id IS NOT NULL THEN
    SELECT COALESCE(paid_amount_cents, 0) INTO v_previous FROM orders WHERE id = p_order_id;
  END IF;
  v_points_delta := GREATEST(0, floor(amount_cents / 100)::int - floor(v_previous / 100)::int);
  IF v_points_delta <= 0 THEN
    RETURN QUERY SELECT COALESCE((SELECT profiles.loyalty_points FROM profiles WHERE id = target_user_id), 0), false, 0;
    RETURN;
  END IF;
  UPDATE profiles SET loyalty_points = COALESCE(loyalty_points, 0) + v_points_delta WHERE id = target_user_id
  RETURNING profiles.loyalty_points INTO v_new_points;
  IF v_new_points IS NOT NULL AND v_new_points >= 500 AND (v_new_points - v_points_delta) % 500 > (v_new_points % 500) THEN
    v_voucher_earned := true;
  END IF;
  RETURN QUERY SELECT v_new_points, v_voucher_earned, v_points_delta;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Atomic voucher redemption
DROP FUNCTION IF EXISTS atomic_redeem_voucher(text, uuid, uuid);
CREATE OR REPLACE FUNCTION atomic_redeem_voucher(p_voucher_code text, p_order_id uuid, p_user_id uuid DEFAULT NULL)
RETURNS TABLE(success boolean, voucher_id uuid, error_code text, error_message text) AS $$
DECLARE
  v_voucher RECORD; v_order RECORD; v_lock_key bigint;
BEGIN
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
    UPDATE orders SET total_amount_cents = 0, status = 'paid', notes = COALESCE(notes || ' | ', '') || 'Voucher: ' || p_voucher_code WHERE id = p_order_id;
  END IF;
  
  RETURN QUERY SELECT true, v_voucher.id, NULL::text, NULL::text;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Sales report view (only counts COMPLETED orders for revenue)
DROP VIEW IF EXISTS daily_sales_report;
CREATE OR REPLACE VIEW daily_sales_report AS
SELECT 
  COUNT(*) FILTER (WHERE created_at::date = CURRENT_DATE) AS total_orders,
  COALESCE(SUM(total_amount_cents) FILTER (WHERE created_at::date = CURRENT_DATE AND status = 'completed'), 0) AS gross_revenue,
  COUNT(*) FILTER (WHERE created_at::date = CURRENT_DATE AND status = 'completed') AS completed_orders
FROM orders;
