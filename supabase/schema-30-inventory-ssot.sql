-- schema-30-inventory-ssot.sql
-- Single Source of Truth for inventory decrement/restore
--
-- PROBLEM: The trigger handle_order_completion() was a "blind" trigger that
-- re-counted coffee_orders to determine how many cups to decrement. If any
-- other code path also decremented (or if the trigger fired on a retry),
-- inventory could be double-decremented. The refund restore was similarly
-- fragile — it re-counted coffee_orders instead of using the recorded amount.
--
-- FIX:
--   1. Add cups_decremented column to orders (records actual amount decremented)
--   2. Harden the trigger: use row locking, record actual decrement, exact match
--   3. Harden refund restore: use recorded cups_decremented, not a re-count
--   4. Fix decrement_inventory() to use exact match (not ILIKE)

-- 1. Record actual decrement count on the order for refund accuracy
ALTER TABLE orders ADD COLUMN IF NOT EXISTS cups_decremented int DEFAULT 0;

-- 2. Use exact match in decrement_inventory (not ILIKE)
CREATE OR REPLACE FUNCTION decrement_inventory(p_item_name text, p_quantity int DEFAULT 1)
RETURNS void AS $$
  UPDATE inventory
  SET current_stock = GREATEST(0, current_stock - p_quantity),
      updated_at = now()
  WHERE item_name = p_item_name;
$$ LANGUAGE sql SECURITY DEFINER;

-- 3. Hardened trigger: lock inventory row, record actual decrement
CREATE OR REPLACE FUNCTION handle_order_completion()
RETURNS TRIGGER AS $$
DECLARE
  v_item_count int;
  v_old_stock  int;
  v_actual_dec int;
BEGIN
  -- Guard 1: Only fire on transition TO 'completed'
  IF (NEW.status <> 'completed') OR (OLD.status IS NOT DISTINCT FROM 'completed') THEN
    RETURN NEW;
  END IF;

  -- Guard 2: One-shot flag — never decrement twice for the same order
  IF COALESCE(NEW.inventory_decremented, false) THEN
    RETURN NEW;
  END IF;

  -- Count drink items for this order
  SELECT COUNT(*)::int INTO v_item_count
  FROM public.coffee_orders
  WHERE order_id = NEW.id;

  IF v_item_count > 0 THEN
    -- Lock the inventory row to prevent concurrent under-decrement
    SELECT current_stock INTO v_old_stock
    FROM public.inventory
    WHERE item_name = '12oz Cups'
    FOR UPDATE;

    -- Calculate actual decrement (can't go below 0)
    v_actual_dec := LEAST(v_item_count, COALESCE(v_old_stock, 0));

    UPDATE public.inventory
    SET current_stock = GREATEST(0, current_stock - v_item_count),
        updated_at = now()
    WHERE item_name = '12oz Cups';

    -- Record the actual amount decremented on the order for refund accuracy
    NEW.cups_decremented := v_actual_dec;
  END IF;

  NEW.inventory_decremented := true;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Re-bind trigger (same as before, just in case)
DROP TRIGGER IF EXISTS trg_order_completion ON orders;
CREATE TRIGGER trg_order_completion
  BEFORE UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION handle_order_completion();

-- 4. Hardened refund restore: use recorded cups_decremented instead of re-counting
CREATE OR REPLACE FUNCTION restore_inventory_on_refund(p_order_id uuid)
RETURNS jsonb AS $$
DECLARE
  v_cups_dec  int;
  v_was_dec   boolean;
BEGIN
  SELECT COALESCE(inventory_decremented, false),
         COALESCE(cups_decremented, 0)
  INTO v_was_dec, v_cups_dec
  FROM orders WHERE id = p_order_id;

  IF NOT v_was_dec THEN
    RETURN jsonb_build_object('restored', false, 'reason', 'inventory was never decremented');
  END IF;

  IF v_cups_dec > 0 THEN
    UPDATE inventory
    SET current_stock = current_stock + v_cups_dec,
        updated_at    = now()
    WHERE item_name = '12oz Cups';
  END IF;

  UPDATE orders
  SET inventory_decremented = false,
      cups_decremented = 0
  WHERE id = p_order_id;

  RETURN jsonb_build_object('restored', true, 'cups_restored', v_cups_dec);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
