-- ============================================================
-- SCHEMA 13: Staff-Scoped RLS for Catalog Manager & Inventory
--
-- Problem:
--   merch_products only has a public SELECT for is_active=true.
--   Staff dashboard needs to see ALL products (including 86'd)
--   and perform INSERT/UPDATE for the Visual Command Center.
--
--   inventory has deny-all only — staff dashboard InventoryTable
--   returns empty unless queries go through service_role.
--
-- Fix:
--   Add staff-scoped SELECT/INSERT/UPDATE policies using the
--   is_brewhub_staff() SECURITY DEFINER helper from schema-12
--   to avoid the RLS bootstrap deadlock.
--
-- The existing "Public can read active products" policy stays
-- for the customer-facing shop page (Postgres ORs multiple
-- SELECT policies).
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- MERCH_PRODUCTS: Staff can read ALL products (including inactive)
-- ─────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Staff can read all products" ON merch_products;
CREATE POLICY "Staff can read all products" ON merch_products
  FOR SELECT
  USING (is_brewhub_staff());

-- ─────────────────────────────────────────────────────────────
-- MERCH_PRODUCTS: Staff can insert new products
-- ─────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Staff can insert products" ON merch_products;
CREATE POLICY "Staff can insert products" ON merch_products
  FOR INSERT
  WITH CHECK (is_brewhub_staff());

-- ─────────────────────────────────────────────────────────────
-- MERCH_PRODUCTS: Staff can update existing products
-- ─────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Staff can update products" ON merch_products;
CREATE POLICY "Staff can update products" ON merch_products
  FOR UPDATE
  USING (is_brewhub_staff())
  WITH CHECK (is_brewhub_staff());

-- ─────────────────────────────────────────────────────────────
-- INVENTORY: Staff can read all inventory items
-- ─────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Staff can read inventory" ON inventory;
CREATE POLICY "Staff can read inventory" ON inventory
  FOR SELECT
  USING (is_brewhub_staff());
