-- ═══════════════════════════════════════════════════════════════════════════
-- 20260304_agg_maintenance_costs.sql
-- Phase 2 — Maintenance Type Safety (Logic Gap #3)
--
-- Creates a SQL function that aggregates maintenance_logs.cost in the DB
-- using COALESCE instead of relying on JavaScript Number() || 0 coercion.
-- This eliminates NULL-induced NaN / silent-zero bugs in profit reporting.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.agg_maintenance_costs(
  start_date date,
  end_date   date
)
RETURNS TABLE(total_cost_cents bigint, event_count bigint)
LANGUAGE sql STABLE
AS $$
  SELECT
    COALESCE(SUM(ROUND(COALESCE(cost, 0) * 100)), 0)::bigint AS total_cost_cents,
    COUNT(*)::bigint                                           AS event_count
  FROM public.maintenance_logs
  WHERE performed_at >= start_date
    AND performed_at <  end_date;
$$;

COMMENT ON FUNCTION public.agg_maintenance_costs(date, date)
  IS 'Sum maintenance_logs.cost as integer cents with COALESCE NULL safety. Used by _profit-report.js.';
