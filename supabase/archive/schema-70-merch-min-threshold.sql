-- schema-70-merch-min-threshold.sql
-- Adds per-product low-stock threshold to merch_products.
-- When NULL the backend defaults to 10, matching prior behaviour.

ALTER TABLE merch_products
  ADD COLUMN IF NOT EXISTS min_threshold int DEFAULT NULL;

COMMENT ON COLUMN merch_products.min_threshold IS
  'Per-item low-stock threshold. NULL = use system default (10).';

-- Partial index: only rows that actually track stock
CREATE INDEX IF NOT EXISTS idx_merch_products_low_stock
  ON merch_products (stock_quantity, min_threshold)
  WHERE stock_quantity IS NOT NULL AND is_active = true;
