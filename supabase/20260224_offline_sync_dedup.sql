-- ============================================================
-- MIGRATION: Offline Sync Dedup — offline_id unique column
-- Date: 2026-02-24
-- Purpose: Prevent duplicate orders when offline queue syncs.
--   Each offline-created order carries a client-generated UUID
--   (offline_id). A partial unique index rejects re-inserts
--   while allowing NULL for normal (online) orders.
-- ============================================================

-- 1. Add the column (nullable — only offline orders populate it)
ALTER TABLE orders ADD COLUMN IF NOT EXISTS offline_id text;

-- 2. Partial unique index — enforces uniqueness only on non-NULL values
CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_offline_id
  ON orders (offline_id)
  WHERE offline_id IS NOT NULL;
