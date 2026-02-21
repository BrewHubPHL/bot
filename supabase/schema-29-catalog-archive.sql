-- schema-29-catalog-archive.sql
-- Two-tier hide/archive system for menu items:
--   is_active=false, archived_at=NULL  → "Hidden" (temp out of stock, visible on manager dashboard)
--   is_active=false, archived_at=ts    → "Archived" (long-term removal, hidden from dashboard, preserved for reports)
--   is_active=true,  archived_at=NULL  → Active (visible everywhere)

-- 1. Add archived_at column
ALTER TABLE merch_products ADD COLUMN IF NOT EXISTS archived_at timestamptz DEFAULT NULL;

-- 2. Ensure category column exists
ALTER TABLE merch_products ADD COLUMN IF NOT EXISTS category text DEFAULT 'menu';

-- 3. Index for fast dashboard queries filtering out archived items
CREATE INDEX IF NOT EXISTS idx_merch_products_archived
  ON merch_products (archived_at) WHERE archived_at IS NULL;

-- 4. Update public SELECT policy to also exclude archived items
DROP POLICY IF EXISTS "Public can read active products" ON merch_products;
CREATE POLICY "Public can read active products" ON merch_products
  FOR SELECT
  USING (is_active = true AND archived_at IS NULL);

-- Staff "read all" policy is unchanged (managers/staff can see everything incl. archived)
