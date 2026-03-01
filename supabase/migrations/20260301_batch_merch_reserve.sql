-- Migration: Batch stock reservation for merch checkout
-- Eliminates the N+1 loop in process-merch-payment.js by reserving
-- all cart items atomically in a single RPC call.
--
-- Takes a JSONB array: [{"product_id": "uuid", "quantity": 2}, ...]
-- Locks rows with FOR UPDATE, decrements atomically.
-- If ANY item has insufficient stock the entire transaction rolls back
-- and raises an exception with the offending product_id + available qty.

BEGIN;

-- ── 1. Batch reserve: all-or-nothing stock decrement ─────────────
CREATE OR REPLACE FUNCTION reserve_merch_stock_batch(
  p_items jsonb  -- [{"product_id": "uuid-...", "quantity": 2}, ...]
)
RETURNS jsonb AS $$
DECLARE
  item       jsonb;
  v_pid      uuid;
  v_qty      int;
  v_stock    int;
  v_reserved jsonb := '[]'::jsonb;
BEGIN
  FOR item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_pid := (item->>'product_id')::uuid;
    v_qty := (item->>'quantity')::int;

    -- Lock row for the duration of this transaction
    SELECT stock_quantity INTO v_stock
      FROM merch_products
     WHERE id = v_pid
       FOR UPDATE;

    -- NULL stock = unlimited (print-on-demand / digital) — skip
    IF v_stock IS NULL THEN
      CONTINUE;
    END IF;

    IF v_stock < v_qty THEN
      -- Entire batch fails — transaction auto-rolls back on RAISE
      RAISE EXCEPTION 'INSUFFICIENT_STOCK::%::%::%', v_pid, v_stock, v_qty;
    END IF;

    UPDATE merch_products
       SET stock_quantity = stock_quantity - v_qty,
           updated_at     = now()
     WHERE id = v_pid;

    v_reserved := v_reserved || jsonb_build_object(
      'product_id', v_pid,
      'quantity',   v_qty
    );
  END LOOP;

  RETURN v_reserved;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ── 2. Batch rollback: restore stock for all items at once ───────
CREATE OR REPLACE FUNCTION rollback_merch_stock_batch(
  p_items jsonb  -- same shape as above
)
RETURNS void AS $$
DECLARE
  item jsonb;
BEGIN
  FOR item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    UPDATE merch_products
       SET stock_quantity = stock_quantity + (item->>'quantity')::int,
           updated_at     = now()
     WHERE id = (item->>'product_id')::uuid
       AND stock_quantity IS NOT NULL;
  END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMIT;
