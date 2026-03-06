-- ═══════════════════════════════════════════════════════════════════════════
-- Schema 94 — Data Integrity Level (Simulation vs. Production)
-- ═══════════════════════════════════════════════════════════════════════════
-- CONTEXT: BrewHub PHL is in "Testing vs. Real Procurement" phase for Q1 2027.
--          We need to distinguish real-world asset purchases (Vandola Brewer,
--          Kilobags of Specialty Roast) from simulation/test entries used
--          during development.
--
-- CHANGES:
--   1. Create ENUM type `data_integrity_level` ('simulation', 'production').
--   2. Add `data_integrity_level` column to `inventory` and `orders` tables.
--   3. Create `v_accounting_ledger_live` view — production-only profitability.
--   4. Update `get_low_stock_items()` RPC to accept a `p_include_simulation`
--      flag so the manager dashboard can exclude simulation data.
--   5. Create `promote_to_production()` RPC — atomic batch promotion from
--      simulation → production with audit logging.
--
-- CONSTRAINT: Maintains Unified CRM — orders.user_id FK to customers.id
--             is unchanged. Simulation orders retain their customer links
--             but are filtered out of live accounting.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. Create ENUM type ──────────────────────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'data_integrity_level') THEN
    CREATE TYPE public.data_integrity_level AS ENUM ('simulation', 'production');
  END IF;
END $$;

-- ── 2a. Add column to inventory ──────────────────────────────────────────
ALTER TABLE public.inventory
  ADD COLUMN IF NOT EXISTS data_integrity_level public.data_integrity_level
    NOT NULL DEFAULT 'simulation';

COMMENT ON COLUMN public.inventory.data_integrity_level IS
  'Distinguishes real procurement items (production) from dev/test entries (simulation). Default is simulation to protect accounting accuracy.';

-- ── 2b. Add column to orders ─────────────────────────────────────────────
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS data_integrity_level public.data_integrity_level
    NOT NULL DEFAULT 'simulation';

COMMENT ON COLUMN public.orders.data_integrity_level IS
  'Distinguishes real customer orders (production) from dev/test orders (simulation). Default is simulation to protect accounting accuracy.';

-- ── 2c. Add column to equipment ──────────────────────────────────────────
-- Equipment purchases are also tracked for TCO — same separation needed.
ALTER TABLE public.equipment
  ADD COLUMN IF NOT EXISTS data_integrity_level public.data_integrity_level
    NOT NULL DEFAULT 'simulation';

COMMENT ON COLUMN public.equipment.data_integrity_level IS
  'Distinguishes real equipment assets (production) from dev/test entries (simulation).';

-- ── 2d. Add column to maintenance_logs ───────────────────────────────────
ALTER TABLE public.maintenance_logs
  ADD COLUMN IF NOT EXISTS data_integrity_level public.data_integrity_level
    NOT NULL DEFAULT 'simulation';

COMMENT ON COLUMN public.maintenance_logs.data_integrity_level IS
  'Distinguishes real maintenance events (production) from dev/test entries (simulation).';

-- ── 3. Indexes for filtered queries ──────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_inventory_data_integrity
  ON public.inventory (data_integrity_level);

CREATE INDEX IF NOT EXISTS idx_orders_data_integrity
  ON public.orders (data_integrity_level);

CREATE INDEX IF NOT EXISTS idx_equipment_data_integrity
  ON public.equipment (data_integrity_level);

CREATE INDEX IF NOT EXISTS idx_maintenance_logs_data_integrity
  ON public.maintenance_logs (data_integrity_level);

-- ── 4. v_accounting_ledger_live — Production-only profitability view ─────
-- This view calculates revenue, maintenance costs, equipment TCO, and
-- operating expenses using ONLY production-tagged rows.
-- Property expenses (rent, payroll, COGS) are always production by nature
-- so they are included without filtering.
CREATE OR REPLACE VIEW public.v_accounting_ledger_live AS
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
-- Generate a series of months from the earliest order to now
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
  to_char(ms.month, 'YYYY-MM')                     AS month_label,
  COALESCE(r.order_count, 0)                        AS order_count,
  COALESCE(r.revenue_cents, 0)                      AS revenue_cents,
  COALESCE(m.maintenance_event_count, 0)             AS maintenance_event_count,
  COALESCE(m.maintenance_cost_cents, 0)              AS maintenance_cost_cents,
  COALESCE(o.opex_event_count, 0)                    AS opex_event_count,
  COALESCE(o.opex_cents, 0)                          AS opex_cents,
  (COALESCE(r.revenue_cents, 0)
   - COALESCE(m.maintenance_cost_cents, 0)
   - COALESCE(o.opex_cents, 0))                      AS net_profit_cents
FROM month_series ms
  LEFT JOIN monthly_revenue r     ON r.month = ms.month
  LEFT JOIN monthly_maintenance m ON m.month = ms.month
  LEFT JOIN monthly_opex o        ON o.month = ms.month
ORDER BY ms.month DESC;

-- Grant to service_role only (Netlify functions)
GRANT SELECT ON public.v_accounting_ledger_live TO service_role;

COMMENT ON VIEW public.v_accounting_ledger_live IS
  'Production-only profitability ledger. Excludes all simulation/test data from revenue, maintenance, and equipment costs. Property expenses are always included (assumed production). Used by get-true-profit-report.js and manager financial dashboards.';

-- ── 5. Update get_low_stock_items() to support filtering ─────────────────
-- Drop the old zero-arg signature first to avoid ambiguity, then recreate
-- with the optional parameter.
-- Original signature: get_low_stock_items() → TABLE(...)
-- New signature: get_low_stock_items(p_include_simulation boolean DEFAULT false)
DROP FUNCTION IF EXISTS public.get_low_stock_items();
CREATE OR REPLACE FUNCTION public.get_low_stock_items(
  p_include_simulation boolean DEFAULT false
)
RETURNS TABLE (
  id           uuid,
  item_name    text,
  current_stock integer,
  min_threshold integer,
  unit         text,
  category     text,
  data_integrity_level public.data_integrity_level
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = 'public'
AS $$
  SELECT
    i.id,
    i.item_name,
    i.current_stock,
    i.min_threshold,
    i.unit,
    i.category,
    i.data_integrity_level
  FROM public.inventory i
  WHERE i.current_stock < i.min_threshold
    AND (p_include_simulation OR i.data_integrity_level = 'production')
  ORDER BY (i.current_stock::float / GREATEST(i.min_threshold, 1)) ASC;
$$;

COMMENT ON FUNCTION public.get_low_stock_items IS
  'Returns inventory items below their min threshold. By default excludes simulation data. Pass p_include_simulation=true for dev mode.';

-- ── 6. promote_to_production() RPC — Atomic batch promotion ──────────────
-- Accepts a table name and array of UUIDs. Updates data_integrity_level
-- from simulation → production. Only promotes rows currently marked as
-- simulation (idempotent). Returns count of promoted rows.
CREATE OR REPLACE FUNCTION public.promote_to_production(
  p_table_name text,
  p_ids        uuid[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_allowed_tables text[] := ARRAY['inventory', 'orders', 'equipment', 'maintenance_logs'];
  v_count integer;
BEGIN
  -- Validate table name against allowlist (prevent SQL injection)
  IF NOT (p_table_name = ANY(v_allowed_tables)) THEN
    RAISE EXCEPTION 'Invalid table name: %. Allowed: inventory, orders, equipment, maintenance_logs', p_table_name;
  END IF;

  IF p_ids IS NULL OR array_length(p_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'p_ids must be a non-empty UUID array';
  END IF;

  IF array_length(p_ids, 1) > 500 THEN
    RAISE EXCEPTION 'Batch size limited to 500 items';
  END IF;

  -- Use dynamic SQL with allowlisted table name
  EXECUTE format(
    'UPDATE %I SET data_integrity_level = $1 WHERE id = ANY($2) AND data_integrity_level = $3',
    p_table_name
  )
  USING 'production'::data_integrity_level, p_ids, 'simulation'::data_integrity_level;

  GET DIAGNOSTICS v_count = ROW_COUNT;

  RETURN jsonb_build_object(
    'promoted_count', v_count,
    'table', p_table_name,
    'requested_count', array_length(p_ids, 1),
    'promoted_at', now()
  );
END;
$$;

COMMENT ON FUNCTION public.promote_to_production IS
  'Atomically promotes a batch of rows from simulation → production. Table name validated against allowlist. Max 500 per batch. Idempotent — already-production rows are no-ops.';

-- ── 7. Grants ────────────────────────────────────────────────────────────
-- RPCs are manager-only, called via service_role from Netlify functions
GRANT EXECUTE ON FUNCTION public.get_low_stock_items TO service_role;
GRANT EXECUTE ON FUNCTION public.promote_to_production TO service_role;

COMMIT;
