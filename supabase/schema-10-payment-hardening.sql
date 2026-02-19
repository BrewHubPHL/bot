-- ============================================================
-- SCHEMA 10: Payment Hardening — Stale Order Cleanup + Helpers
-- ============================================================

-- 1. RPC: Cancel stale orders stuck in 'pending' or 'unpaid'
-- Returns the count of cancelled orders for logging.
-- Called by: netlify/functions/cancel-stale-orders.js (scheduled cron)
CREATE OR REPLACE FUNCTION cancel_stale_orders(stale_minutes int DEFAULT 30)
RETURNS int AS $$
DECLARE
  v_cancelled int;
BEGIN
  -- Only cancel orders that:
  --   a) Are in a pre-payment state ('pending' or 'unpaid')
  --   b) Have no payment_id (never paid)
  --   c) Were created longer than stale_minutes ago
  WITH cancelled AS (
    UPDATE orders
    SET status = 'cancelled',
        notes = COALESCE(notes || ' | ', '') || 'Auto-cancelled: stale after ' || stale_minutes || ' min'
    WHERE status IN ('pending', 'unpaid')
      AND payment_id IS NULL
      AND created_at < now() - (stale_minutes || ' minutes')::interval
    RETURNING id
  )
  SELECT COUNT(*)::int INTO v_cancelled FROM cancelled;

  RETURN v_cancelled;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2. Add paid_amount_cents column to orders (fixes broken guard in increment_loyalty RPC)
-- The increment_loyalty RPC references this column to prevent double-crediting,
-- but it was never created. Without it, the re-entry guard always reads NULL/0.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS paid_amount_cents int DEFAULT 0;
