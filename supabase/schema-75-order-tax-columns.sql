-- ============================================================
-- Schema 75: Add tax tracking columns to orders table
-- ============================================================
-- The POS UI was displaying tax (Philadelphia 8%) client-side
-- but the backend never computed or stored it. This migration
-- adds subtotal_cents and tax_amount_cents so that:
--   1. cafe-checkout.js computes tax server-side (SSOT)
--   2. Receipts show Subtotal / Tax / Total breakdown
--   3. Finance queries can report on tax collected
--
-- Idempotent: safe to re-run in the Supabase SQL Editor.
-- ============================================================

-- subtotal_cents = sum of item prices (before tax)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name   = 'orders'
       AND column_name  = 'subtotal_cents'
  ) THEN
    ALTER TABLE public.orders ADD COLUMN subtotal_cents int;
    COMMENT ON COLUMN public.orders.subtotal_cents IS
      'Sum of line-item prices before tax. NULL for legacy orders created before schema-75.';
  END IF;
END $$;

-- tax_amount_cents = computed sales tax (Philadelphia 8%)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name   = 'orders'
       AND column_name  = 'tax_amount_cents'
  ) THEN
    ALTER TABLE public.orders ADD COLUMN tax_amount_cents int DEFAULT 0;
    COMMENT ON COLUMN public.orders.tax_amount_cents IS
      'Sales tax in cents (Philadelphia 8%). Default 0 for comp orders and legacy rows.';
  END IF;
END $$;
