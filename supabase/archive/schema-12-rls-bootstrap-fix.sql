-- ============================================================
-- SCHEMA 12: RLS Bootstrap Fix
-- 
-- schema-11 introduced staff-scoped SELECT policies that use
--   EXISTS (SELECT 1 FROM staff_directory WHERE lower(email) = lower(auth.email()))
--
-- PROBLEM: On staff_directory itself this is self-referential.
-- Postgres applies RLS to the inner query too → bootstrap deadlock → empty results.
-- The inner query also breaks the policies on orders, coffee_orders, time_logs,
-- and receipt_queue because they depend on reading staff_directory.
--
-- FIX: A SECURITY DEFINER function runs as the function owner (bypasses RLS).
-- All staff-scoped policies now call is_brewhub_staff() instead of inline EXISTS.
-- ============================================================

-- 1. Helper function: check staff membership without RLS interference
CREATE OR REPLACE FUNCTION is_brewhub_staff()
RETURNS boolean AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM staff_directory WHERE lower(email) = lower(auth.email())
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- Grant execute to authenticated (needed for RLS policy evaluation)
GRANT EXECUTE ON FUNCTION is_brewhub_staff() TO authenticated;

-- 2. Recreate all staff-scoped SELECT policies using the helper

-- staff_directory: all staff can read all staff
DROP POLICY IF EXISTS "Staff can read all staff" ON staff_directory;
DROP POLICY IF EXISTS "Staff can read own row" ON staff_directory;
CREATE POLICY "Staff can read all staff" ON staff_directory
  FOR SELECT
  USING (is_brewhub_staff());

-- orders: staff can read all orders
DROP POLICY IF EXISTS "Staff can read orders" ON orders;
CREATE POLICY "Staff can read orders" ON orders
  FOR SELECT
  USING (is_brewhub_staff());

-- coffee_orders: staff can read all line items
DROP POLICY IF EXISTS "Staff can read coffee_orders" ON coffee_orders;
CREATE POLICY "Staff can read coffee_orders" ON coffee_orders
  FOR SELECT
  USING (is_brewhub_staff());

-- time_logs: staff can read all time logs
DROP POLICY IF EXISTS "Staff can read time_logs" ON time_logs;
CREATE POLICY "Staff can read time_logs" ON time_logs
  FOR SELECT
  USING (is_brewhub_staff());

-- receipt_queue: staff can read receipts (from schema-9)
DROP POLICY IF EXISTS "Staff can read receipts" ON receipt_queue;
CREATE POLICY "Staff can read receipts" ON receipt_queue
  FOR SELECT
  USING (is_brewhub_staff());
