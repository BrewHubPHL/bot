-- ============================================================
-- BREWHUB SCHEMA 32: KDS staff UPDATE policy for orders
--
-- Problem: The KDS page does client-side UPDATEs on orders.status
-- but no RLS policy allows staff UPDATE. The only matching policy
-- is "Deny public access to orders" (FOR ALL USING false), so
-- every status-change click silently fails.
--
-- Fix: Add a FOR UPDATE policy allowing is_brewhub_staff() to
-- update orders. WITH CHECK restricts the allowed status values.
-- ============================================================

BEGIN;

-- Allow staff to update order status (KDS workflow)
DROP POLICY IF EXISTS "Staff can update orders" ON orders;
CREATE POLICY "Staff can update orders" ON orders
  FOR UPDATE
  USING  (is_brewhub_staff())
  WITH CHECK (
    is_brewhub_staff()
    AND status IN ('pending', 'unpaid', 'paid', 'preparing', 'ready', 'completed', 'cancelled')
  );

COMMIT;
