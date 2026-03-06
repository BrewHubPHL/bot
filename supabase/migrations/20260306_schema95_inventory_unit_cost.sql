-- ════════════════════════════════════════════════════════════════════════
-- Schema 95 — Add unit_cost_cents to inventory table
--
-- Enables per-item cost tracking for:
--   • Inventory valuation (stock × unit cost)
--   • COGS derivation from inventory deductions
--   • Shrinkage loss calculations for café supplies
--   • Profit-loss accuracy in the Manager Dashboard
--
-- Column is nullable — existing rows default to NULL (unknown cost).
-- UI validation enforces >= 0 on insert/update.
-- ════════════════════════════════════════════════════════════════════════
BEGIN;

ALTER TABLE public.inventory
  ADD COLUMN IF NOT EXISTS unit_cost_cents integer DEFAULT NULL
    CHECK (unit_cost_cents IS NULL OR unit_cost_cents >= 0);

COMMENT ON COLUMN public.inventory.unit_cost_cents
  IS 'Per-unit cost in cents. NULL = unknown. Used for valuation & COGS.';

COMMIT;
