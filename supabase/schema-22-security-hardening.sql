-- ============================================================
-- SCHEMA 22: Security Hardening — Pen-Test Remediations
--   A) Atomic loyalty increment with SELECT ... FOR UPDATE
--   B) Atomic loyalty decrement with SELECT ... FOR UPDATE
-- ============================================================

-- ═══════════════════════════════════════════════════════════════
-- A) REWRITE increment_loyalty WITH ROW-LEVEL LOCKING
-- ═══════════════════════════════════════════════════════════════
-- The old version did UPDATE ... SET loyalty_points = loyalty_points + N
-- without locking the row first. Two concurrent requests could both read
-- the old value and produce a double-credit. We now SELECT ... FOR UPDATE
-- to serialise access to the same profile row.

DROP FUNCTION IF EXISTS increment_loyalty(uuid, int, uuid);
CREATE OR REPLACE FUNCTION increment_loyalty(
  target_user_id uuid,
  amount_cents   int,
  p_order_id     uuid DEFAULT NULL
)
RETURNS TABLE(loyalty_points int, voucher_earned boolean, points_awarded int) AS $$
DECLARE
  v_current_points int;
  v_new_points     int;
  v_voucher_earned boolean := false;
  v_points_delta   int;
  v_previous       int := 0;
BEGIN
  -- Re-entry guard: if order already had a partial payment, award only the delta
  IF p_order_id IS NOT NULL THEN
    SELECT COALESCE(paid_amount_cents, 0)
      INTO v_previous
      FROM orders
     WHERE id = p_order_id;
  END IF;

  v_points_delta := GREATEST(0, floor(amount_cents / 100)::int - floor(v_previous / 100)::int);

  IF v_points_delta <= 0 THEN
    RETURN QUERY
      SELECT COALESCE(p.loyalty_points, 0), false, 0
        FROM profiles p
       WHERE p.id = target_user_id;
    RETURN;
  END IF;

  -- ╔═══════════════════════════════════════════════════════════╗
  -- ║ LOCK the profile row to prevent concurrent double-credit ║
  -- ╚═══════════════════════════════════════════════════════════╝
  SELECT p.loyalty_points
    INTO v_current_points
    FROM profiles p
   WHERE p.id = target_user_id
     FOR UPDATE;  -- blocks concurrent transactions on this row

  IF v_current_points IS NULL THEN
    -- Profile doesn't exist; nothing to credit
    RETURN QUERY SELECT 0, false, 0;
    RETURN;
  END IF;

  v_new_points := COALESCE(v_current_points, 0) + v_points_delta;

  UPDATE profiles
     SET loyalty_points = v_new_points,
         updated_at     = now()
   WHERE id = target_user_id;

  -- Voucher threshold: award when crossing a 500-point boundary
  IF v_new_points >= 500
     AND (v_current_points % 500) > (v_new_points % 500)
  THEN
    v_voucher_earned := true;
  END IF;

  RETURN QUERY SELECT v_new_points, v_voucher_earned, v_points_delta;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ═══════════════════════════════════════════════════════════════
-- B) SAFE DECREMENT WITH ROW-LEVEL LOCKING (never goes below 0)
-- ═══════════════════════════════════════════════════════════════
-- Called by square-webhook.js on refund. Uses the same FOR UPDATE
-- pattern to prevent a race between a concurrent increment and
-- decrement from producing a negative balance.

DROP FUNCTION IF EXISTS decrement_loyalty_on_refund(uuid, int);
DROP FUNCTION IF EXISTS decrement_loyalty_on_refund(uuid);
CREATE OR REPLACE FUNCTION decrement_loyalty_on_refund(
  target_user_id uuid,
  amount_cents   int DEFAULT 500  -- default: revoke one tier (500 pts)
)
RETURNS TABLE(loyalty_points int, points_deducted int) AS $$
DECLARE
  v_current_points int;
  v_deduct         int;
  v_new_points     int;
BEGIN
  -- Lock the row
  SELECT p.loyalty_points
    INTO v_current_points
    FROM profiles p
   WHERE p.id = target_user_id
     FOR UPDATE;

  IF v_current_points IS NULL THEN
    RETURN QUERY SELECT 0, 0;
    RETURN;
  END IF;

  v_deduct     := LEAST(GREATEST(0, floor(amount_cents / 100)::int), v_current_points);
  v_new_points := v_current_points - v_deduct;

  UPDATE profiles
     SET loyalty_points = v_new_points,
         updated_at     = now()
   WHERE id = target_user_id;

  RETURN QUERY SELECT v_new_points, v_deduct;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Lock down execution to service_role only (same as existing RLS policy)
REVOKE EXECUTE ON FUNCTION increment_loyalty(uuid, int, uuid) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION decrement_loyalty_on_refund(uuid, int) FROM anon, authenticated;
