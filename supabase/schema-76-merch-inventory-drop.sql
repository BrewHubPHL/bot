-- ============================================================
-- SCHEMA 76: Phase 1 — Merch Inventory Consolidation
-- ============================================================
-- Goal: Eliminate the ghost table `merch_inventory` if it exists.
--
-- Safety Check:
--   1. merch_inventory is not referenced anywhere in the codebase.
--   2. All merch logic (process-merch-payment.js, manage-catalog.js,
--      reserve_merch_stock_batch(), atomic_record_shrinkage()) operates
--      exclusively on `merch_products.stock_quantity`.
--   3. DROP IF EXISTS is idempotent — safe to re-run.
--   4. No downstream views, triggers, or foreign keys depend on it.
--
-- What could break:
--   • Nothing. grep -r "merch_inventory" returns zero hits.
--   • If a future migration re-introduces the table name, it will
--     simply CREATE TABLE without conflict.
--
-- Rollback:
--   This DROP is destructive. If data existed, restore from backup.
--   Since the table is phantom (never created in any known migration),
--   rollback is a no-op.
-- ============================================================

BEGIN;

-- 1. Drop RLS policies that could reference the table (guard clause)
DO $$
BEGIN
  -- Attempt to drop any lingering policies — ignore if table doesn't exist
  IF EXISTS (
    SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'merch_inventory'
  ) THEN
    EXECUTE 'DROP POLICY IF EXISTS "Staff can read inventory" ON merch_inventory';
    EXECUTE 'DROP POLICY IF EXISTS "Staff can update inventory" ON merch_inventory';
    EXECUTE 'DROP POLICY IF EXISTS "Manager can update inventory" ON merch_inventory';
  END IF;
END $$;

-- 2. Drop the ghost table
DROP TABLE IF EXISTS public.merch_inventory CASCADE;

-- 3. Leave a breadcrumb for future audits
COMMENT ON TABLE merch_products IS
  'Single source of truth for all products (menu + merch + shipping). '
  'Stock is tracked via stock_quantity column (NULL = unlimited). '
  'The former merch_inventory table was removed in schema-76.';

COMMIT;
