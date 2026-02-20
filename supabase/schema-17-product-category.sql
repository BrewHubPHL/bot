-- ============================================================
-- SCHEMA 17: Add `category` column to merch_products
--
-- Why:
--   The public shop page now has a "Cafe Menu" vs "Merch & Beans"
--   toggle, and the Manager Dashboard Catalog Manager writes
--   category on insert/update. Without this column the writes
--   silently fail (PostgREST rejects unknown columns).
--
-- Values: 'menu' (cafe drinks & food) | 'merch' (retail, beans, apparel)
-- Default: 'menu' — existing products are assumed to be cafe items.
--
-- RLS: No changes needed — existing SELECT/INSERT/UPDATE policies
--   on merch_products are column-agnostic and already cover this.
-- ============================================================

-- 1. Add the column (idempotent)
ALTER TABLE merch_products
  ADD COLUMN IF NOT EXISTS category text NOT NULL DEFAULT 'menu';

-- 2. Constrain to known values
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'merch_products_category_check'
  ) THEN
    ALTER TABLE merch_products
      ADD CONSTRAINT merch_products_category_check
      CHECK (category IN ('menu', 'merch'));
  END IF;
END $$;

-- 3. Index for filtered queries (shop page filters by category)
CREATE INDEX IF NOT EXISTS idx_merch_products_category
  ON merch_products (category);
