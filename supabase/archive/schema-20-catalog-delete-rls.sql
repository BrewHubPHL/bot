-- ============================================================
-- SCHEMA 20: Add DELETE policy for merch_products
-- ============================================================
-- Context: Staff can already SELECT/INSERT/UPDATE via schema-13, 
-- but no DELETE policy existed — delete buttons silently failed.
-- ============================================================

-- MERCH_PRODUCTS: Staff can delete products
DROP POLICY IF EXISTS "Staff can delete products" ON merch_products;
CREATE POLICY "Staff can delete products" ON merch_products
  FOR DELETE
  USING ( is_brewhub_staff() );
