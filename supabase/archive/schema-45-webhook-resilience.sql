-- =============================================================================
-- SCHEMA 45: WEBHOOK RESILIENCE — The "Phantom Orders" Fix
-- =============================================================================
-- Problem: Square webhook delays (5–15+ minutes) leave paid terminal orders
-- stuck in 'pending' — baristas see blank KDS screens while 50 customers
-- who already tapped their cards stand waiting. Worse, cancel_stale_orders
-- will CANCEL these actually-paid orders after 30 minutes.
--
-- Solution: Store the Square Terminal checkout ID on the order so we can
-- actively poll Square's API instead of passively waiting for webhooks.
-- A scheduled reconciliation function uses this to catch every payment
-- regardless of webhook delivery status.
-- =============================================================================

-- 1. Add square_checkout_id to orders for terminal payment tracking
--    This lets us poll Square's Terminal API to check payment status
--    independently of their webhook delivery system.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS square_checkout_id text;

-- 2. Index for the reconciliation query: find pending orders with a checkout ID
--    that are older than N seconds (the polling window).
CREATE INDEX IF NOT EXISTS idx_orders_pending_checkout
  ON orders (created_at)
  WHERE status = 'pending'
    AND square_checkout_id IS NOT NULL;

-- 3. Add payment_confirmed_via column to track HOW the payment was confirmed
--    (webhook vs poll vs reconciliation) for operational observability.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_confirmed_via text;

-- 4. Guard cancel_stale_orders: never cancel orders that have a checkout ID
--    (they were sent to the terminal — customer may have paid).
--    Re-create with safety check.
CREATE OR REPLACE FUNCTION cancel_stale_orders(stale_minutes int DEFAULT 30)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  cancelled_count int;
  v_unpaid_count  int;
BEGIN
  -- 1. Cancel stale PENDING orders (no terminal checkout started)
  UPDATE orders
  SET    status     = 'cancelled',
         updated_at = now()
  WHERE  status = 'pending'
    AND  payment_id IS NULL
    -- CRITICAL: Do NOT cancel orders that were sent to the terminal.
    -- The customer may have already tapped/inserted their card.
    -- These are handled by reconcile-pending-payments instead.
    AND  square_checkout_id IS NULL
    AND  created_at < now() - (stale_minutes || ' minutes')::interval;

  GET DIAGNOSTICS cancelled_count = ROW_COUNT;

  -- 2. Cancel stale UNPAID orders (chatbot/guest — 60-min grace period)
  --    These guests were given time to walk to the cafe; if they never
  --    showed up, clear the ghost cards from the KDS.
  UPDATE orders
  SET    status     = 'cancelled',
         updated_at = now()
  WHERE  status = 'unpaid'
    AND  payment_id IS NULL
    AND  created_at < now() - interval '60 minutes';

  GET DIAGNOSTICS v_unpaid_count = ROW_COUNT;
  cancelled_count := cancelled_count + v_unpaid_count;

  RETURN cancelled_count;
END;
$$;

-- Keep the function locked down to service role only
REVOKE EXECUTE ON FUNCTION cancel_stale_orders(int) FROM anon, authenticated;
