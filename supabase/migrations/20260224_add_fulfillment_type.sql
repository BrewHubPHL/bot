-- ============================================================
-- Migration: Add fulfillment_type + stock_quantity columns
-- Date: 2026-02-24
-- ============================================================
-- 1. orders.fulfillment_type — distinguishes pickup vs shipping
--    for merch outbound fulfillment flow.
-- 2. merch_products.stock_quantity — enables pre-charge stock checks
--    so we never oversell merch inventory.
-- ============================================================

BEGIN;

-- ── 1. orders: fulfillment tracking ──────────────────────────────
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS fulfillment_type text DEFAULT 'pickup';

COMMENT ON COLUMN orders.fulfillment_type IS 'pickup | shipping — merch fulfillment channel';

-- ── 2. merch_products: stock quantity for oversell prevention ────
ALTER TABLE merch_products
  ADD COLUMN IF NOT EXISTS stock_quantity int DEFAULT NULL;

COMMENT ON COLUMN merch_products.stock_quantity IS 'Available stock. NULL = unlimited (print-on-demand / digital). 0 = out of stock.';

-- Index for quick stock lookups during checkout
CREATE INDEX IF NOT EXISTS idx_merch_products_stock
  ON merch_products (stock_quantity) WHERE stock_quantity IS NOT NULL;

-- ── 3. Atomic stock decrement RPC ────────────────────────────────
-- Called by process-merch-payment.js after successful DB insert.
-- Only decrements if stock_quantity is NOT NULL (tracked items).
-- Uses GREATEST(0, …) to prevent going below zero.
CREATE OR REPLACE FUNCTION decrement_merch_stock(p_product_id uuid, p_quantity int DEFAULT 1)
RETURNS void AS $$
  UPDATE merch_products
  SET stock_quantity = GREATEST(0, stock_quantity - p_quantity),
      updated_at = now()
  WHERE id = p_product_id
    AND stock_quantity IS NOT NULL;
$$ LANGUAGE sql SECURITY DEFINER;

COMMIT;
