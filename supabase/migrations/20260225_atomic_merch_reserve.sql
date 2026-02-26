-- Migration: Atomic stock reservation for merch checkout
-- Closes the Silent Stockout TOCTOU race condition.
--
-- Strategy: Reserve stock BEFORE charging the card.
-- The `WHERE stock_quantity >= p_quantity` clause acts as a row-level lock
-- (Postgres UPDATE takes a FOR UPDATE lock on matched rows), so two
-- concurrent requests serialise automatically.
-- Returns the row on success; returns nothing on insufficient stock.

BEGIN;

-- ── 1. Atomic reserve: decrements + returns product row ──────────
CREATE OR REPLACE FUNCTION reserve_merch_stock(
  p_product_id uuid,
  p_quantity   int DEFAULT 1
)
RETURNS TABLE(id uuid, stock_quantity int) AS $$
  UPDATE merch_products
  SET stock_quantity = stock_quantity - p_quantity,
      updated_at     = now()
  WHERE merch_products.id = p_product_id
    AND stock_quantity IS NOT NULL
    AND stock_quantity >= p_quantity
  RETURNING merch_products.id, merch_products.stock_quantity;
$$ LANGUAGE sql SECURITY DEFINER;

-- ── 2. Rollback-safe restock: gives units back on payment failure ─
CREATE OR REPLACE FUNCTION rollback_merch_stock(
  p_product_id uuid,
  p_quantity   int DEFAULT 1
)
RETURNS void AS $$
  UPDATE merch_products
  SET stock_quantity = stock_quantity + p_quantity,
      updated_at     = now()
  WHERE id = p_product_id
    AND stock_quantity IS NOT NULL;
$$ LANGUAGE sql SECURITY DEFINER;

COMMIT;
