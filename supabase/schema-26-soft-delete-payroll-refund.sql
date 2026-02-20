-- ============================================================
-- SCHEMA 26: Soft-Delete Guard, Payroll Sanity, Refund Inventory Restore
-- ============================================================
-- Addresses three critical business logic gaps found in QA sweep:
--   1. Hard DELETE on merch_products orphans historical orders.
--   2. Missing clock-in validation lets phantom shifts corrupt payroll.
--   3. Refunds don't restore inventory that was decremented on completion.
-- ============================================================

-- ─── 1. SOFT DELETE: Revoke hard-delete RLS for non-service roles ───────────
-- Managers should toggle is_active, not DELETE rows. Keeping the policy
-- restricted to service_role means only background jobs can truly purge.

DROP POLICY IF EXISTS "Manager can delete products" ON merch_products;
DROP POLICY IF EXISTS "Staff can delete products"   ON merch_products;

-- No public/authenticated DELETE policy → only service_role (bypasses RLS) can hard-delete.
-- Managers soft-delete via UPDATE is_active = false (already permitted by existing UPDATE policy).

-- ─── 2. PAYROLL: Add needs_manager_review flag to time_logs ─────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'time_logs' AND column_name = 'needs_manager_review'
  ) THEN
    ALTER TABLE time_logs ADD COLUMN needs_manager_review boolean NOT NULL DEFAULT false;
  END IF;
END $$;

-- ─── 3. REFUND: RPC to restore inventory safely ────────────────────────────
-- Mirrors decrement_inventory but increments. Called by the refund webhook
-- after verifying inventory_decremented = true on the refunded order.

DROP FUNCTION IF EXISTS restore_inventory_on_refund(uuid);
CREATE OR REPLACE FUNCTION restore_inventory_on_refund(p_order_id uuid)
RETURNS jsonb AS $$
DECLARE
  v_cup_count int;
  v_already   boolean;
BEGIN
  -- Guard: only act if inventory was previously decremented
  SELECT COALESCE(inventory_decremented, false) INTO v_already
  FROM orders WHERE id = p_order_id;

  IF NOT v_already THEN
    RETURN jsonb_build_object('restored', false, 'reason', 'inventory was never decremented');
  END IF;

  -- Count drinks that were in the order
  SELECT COUNT(*)::int INTO v_cup_count
  FROM coffee_orders WHERE order_id = p_order_id;

  IF v_cup_count > 0 THEN
    UPDATE inventory
    SET current_stock = current_stock + v_cup_count,
        updated_at    = now()
    WHERE item_name ILIKE '12oz Cups';
  END IF;

  -- Reset the flag so a double-refund webhook can't inflate stock
  UPDATE orders
  SET inventory_decremented = false
  WHERE id = p_order_id;

  RETURN jsonb_build_object('restored', true, 'cups_restored', v_cup_count);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Restrict to service role only (webhooks use service key)
REVOKE EXECUTE ON FUNCTION restore_inventory_on_refund(uuid) FROM anon, authenticated;
