-- ════════════════════════════════════════════════════════════════════════
-- Schema 96 — COGS Pipeline: audit-log cost snapshot + aggregation RPC
--
-- Closes the COGS loop so that inventory consumption automatically
-- feeds into profit-sharing calculations:
--
--   1. Adds unit_cost_cents to inventory_audit_log (snapshot at time of use)
--   2. Replaces adjust_inventory_quantity() RPC to:
--      a) Atomically adjust stock  (existing)
--      b) Snapshot the item's current unit_cost_cents into the audit row
--   3. Creates agg_inventory_cogs() RPC — sums negative-delta cost for
--      a date range, giving automated COGS in cents.
--   4. Updates v_accounting_ledger_live to include COGS as a deduction.
--
-- All existing audit rows get unit_cost_cents = NULL (pre-migration).
-- ════════════════════════════════════════════════════════════════════════
BEGIN;

-- ── 1. Add cost snapshot column to audit log ─────────────────────────────
ALTER TABLE public.inventory_audit_log
  ADD COLUMN IF NOT EXISTS unit_cost_cents integer DEFAULT NULL
    CHECK (unit_cost_cents IS NULL OR unit_cost_cents >= 0);

COMMENT ON COLUMN public.inventory_audit_log.unit_cost_cents
  IS 'Snapshot of inventory.unit_cost_cents at time of adjustment. NULL = unknown or pre-migration.';

-- ── 2. Replace adjust_inventory_quantity() ───────────────────────────────
-- Now writes an audit row with cost snapshot in the same transaction.
DROP FUNCTION IF EXISTS public.adjust_inventory_quantity(uuid, int);

CREATE OR REPLACE FUNCTION public.adjust_inventory_quantity(
  p_id    uuid,
  p_delta int,
  p_source      text    DEFAULT 'manual',
  p_triggered_by text   DEFAULT NULL,
  p_order_id    uuid    DEFAULT NULL,
  p_note        text    DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_item       record;
  v_new_stock  int;
BEGIN
  -- Lock the row to prevent concurrent adjustment races
  SELECT id, item_name, current_stock, unit_cost_cents
    INTO v_item
    FROM public.inventory
   WHERE id = p_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Inventory item % not found', p_id;
  END IF;

  v_new_stock := GREATEST(0, v_item.current_stock + p_delta);

  -- Atomic stock update
  UPDATE public.inventory
     SET current_stock = v_new_stock,
         updated_at    = now()
   WHERE id = p_id;

  -- Audit row with cost snapshot
  INSERT INTO public.inventory_audit_log
    (item_id, item_name, delta, new_qty, source, triggered_by, order_id, note, unit_cost_cents)
  VALUES
    (p_id, v_item.item_name, p_delta, v_new_stock, p_source, p_triggered_by, p_order_id, p_note, v_item.unit_cost_cents);
END;
$$;

COMMENT ON FUNCTION public.adjust_inventory_quantity IS
  'Atomically adjusts inventory stock, snapshots unit_cost_cents into audit log. Locks row with FOR UPDATE to prevent races.';

-- ── 3. agg_inventory_cogs() RPC ─────────────────────────────────────────
-- Sums (ABS(delta) × unit_cost_cents) for all negative deltas (consumption)
-- within a date range. Rows with NULL cost are excluded (unknown cost).
CREATE OR REPLACE FUNCTION public.agg_inventory_cogs(
  start_date date,
  end_date   date
)
RETURNS TABLE (
  total_cogs_cents bigint,
  consumption_events bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = 'public'
AS $$
  SELECT
    COALESCE(SUM(ABS(a.delta)::bigint * a.unit_cost_cents::bigint), 0)::bigint AS total_cogs_cents,
    COUNT(*)::bigint AS consumption_events
  FROM public.inventory_audit_log a
  WHERE a.delta < 0
    AND a.unit_cost_cents IS NOT NULL
    AND a.created_at >= start_date::timestamptz
    AND a.created_at < end_date::timestamptz;
$$;

COMMENT ON FUNCTION public.agg_inventory_cogs IS
  'Aggregates Cost of Goods Sold from inventory consumption (negative deltas with known unit cost) in a date range.';

-- ── 4. Refresh v_accounting_ledger_live with COGS ────────────────────────
DROP VIEW IF EXISTS public.v_accounting_ledger_live;
CREATE VIEW public.v_accounting_ledger_live AS
WITH monthly_revenue AS (
  SELECT
    date_trunc('month', created_at) AS month,
    COUNT(*)                        AS order_count,
    COALESCE(SUM(total_amount_cents), 0) AS revenue_cents
  FROM public.orders
  WHERE status = 'completed'
    AND data_integrity_level = 'production'
  GROUP BY date_trunc('month', created_at)
),
monthly_maintenance AS (
  SELECT
    date_trunc('month', performed_at) AS month,
    COUNT(*)                          AS maintenance_event_count,
    COALESCE(SUM(COALESCE(cost, 0) * 100), 0)::bigint AS maintenance_cost_cents
  FROM public.maintenance_logs
  WHERE data_integrity_level = 'production'
  GROUP BY date_trunc('month', performed_at)
),
monthly_opex AS (
  SELECT
    date_trunc('month', due_date) AS month,
    COUNT(*)                      AS opex_event_count,
    COALESCE(SUM(COALESCE(amount, 0) * 100), 0)::bigint AS opex_cents
  FROM public.property_expenses
  GROUP BY date_trunc('month', due_date)
),
monthly_cogs AS (
  SELECT
    date_trunc('month', a.created_at) AS month,
    COUNT(*)::bigint                  AS cogs_event_count,
    COALESCE(SUM(ABS(a.delta)::bigint * a.unit_cost_cents::bigint), 0)::bigint AS cogs_cents
  FROM public.inventory_audit_log a
  WHERE a.delta < 0
    AND a.unit_cost_cents IS NOT NULL
  GROUP BY date_trunc('month', a.created_at)
),
month_series AS (
  SELECT generate_series(
    COALESCE(
      (SELECT MIN(date_trunc('month', created_at)) FROM public.orders WHERE data_integrity_level = 'production'),
      date_trunc('month', CURRENT_DATE)
    ),
    date_trunc('month', CURRENT_DATE),
    '1 month'::interval
  ) AS month
)
SELECT
  ms.month,
  to_char(ms.month, 'YYYY-MM')                       AS month_label,
  COALESCE(r.order_count, 0)                          AS order_count,
  COALESCE(r.revenue_cents, 0)                        AS revenue_cents,
  COALESCE(m.maintenance_event_count, 0)               AS maintenance_event_count,
  COALESCE(m.maintenance_cost_cents, 0)                AS maintenance_cost_cents,
  COALESCE(o.opex_event_count, 0)                      AS opex_event_count,
  COALESCE(o.opex_cents, 0)                            AS opex_cents,
  COALESCE(c.cogs_event_count, 0)                      AS cogs_event_count,
  COALESCE(c.cogs_cents, 0)                            AS cogs_cents,
  (COALESCE(r.revenue_cents, 0)
   - COALESCE(m.maintenance_cost_cents, 0)
   - COALESCE(o.opex_cents, 0)
   - COALESCE(c.cogs_cents, 0))                        AS net_profit_cents
FROM month_series ms
  LEFT JOIN monthly_revenue r     ON r.month = ms.month
  LEFT JOIN monthly_maintenance m ON m.month = ms.month
  LEFT JOIN monthly_opex o        ON o.month = ms.month
  LEFT JOIN monthly_cogs c        ON c.month = ms.month
ORDER BY ms.month DESC;

COMMENT ON VIEW public.v_accounting_ledger_live IS
  'Production-only profitability ledger with automated COGS from inventory consumption. Excludes simulation/test data. Property expenses always included. COGS derived from inventory_audit_log negative deltas with known unit_cost_cents.';

-- Re-grant after DROP VIEW + CREATE VIEW (originally granted in Schema 94)
GRANT SELECT ON public.v_accounting_ledger_live TO service_role;

COMMIT;
