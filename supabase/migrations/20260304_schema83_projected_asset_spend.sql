-- ============================================================
-- Schema 83 – Projected Maintenance Spend RPC
-- Date:  2026-03-04
-- ============================================================
--
-- OVERVIEW
-- ────────
-- Adds calculate_projected_asset_spend(months_ahead int) which
-- predicts upcoming maintenance expenses by:
--   1. Finding every active equipment asset whose next_maint_date
--      falls within the given look-ahead window.
--   2. Averaging the cost of the most recent 3 maintenance logs
--      for each flagged asset (falls back to $0 when no history).
--   3. Returning a JSON object with total_projected_cost and a
--      flagged_equipment array.
--
-- RLS: Runs as SECURITY DEFINER (service-role context) so the
--      calling Netlify function must enforce manager auth.
-- ============================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.calculate_projected_asset_spend(months_ahead int DEFAULT 3)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_horizon date;
  v_result  jsonb;
BEGIN
  -- ── Guard: months_ahead must be 1–24 ────────────────────
  IF months_ahead < 1 OR months_ahead > 24 THEN
    RAISE EXCEPTION 'months_ahead must be between 1 and 24, got %', months_ahead;
  END IF;

  v_horizon := CURRENT_DATE + (months_ahead || ' months')::interval;

  SELECT jsonb_build_object(
    'total_projected_cost', COALESCE(SUM(sub.avg_cost), 0),
    'flagged_equipment',    COALESCE(jsonb_agg(
      jsonb_build_object(
        'id',               sub.id,
        'name',             sub.name,
        'category',         sub.category,
        'next_maint_date',  sub.next_maint_date,
        'avg_recent_cost',  sub.avg_cost,
        'last_maint_date',  sub.last_maint_date,
        'maint_frequency_days', sub.maint_frequency_days
      ) ORDER BY sub.next_maint_date
    ), '[]'::jsonb)
  )
  INTO v_result
  FROM (
    SELECT
      e.id,
      e.name,
      e.category,
      e.last_maint_date,
      e.maint_frequency_days,
      -- next_maint_date = last_maint_date + frequency (or install_date + frequency if never maintained)
      COALESCE(e.last_maint_date, e.install_date) + e.maint_frequency_days AS next_maint_date,
      -- Average cost of the 3 most recent maintenance logs (0 if none)
      COALESCE(recent.avg_cost, 0) AS avg_cost
    FROM public.equipment e
    LEFT JOIN LATERAL (
      SELECT ROUND(AVG(ml.cost), 2) AS avg_cost
      FROM (
        SELECT ml2.cost
        FROM public.maintenance_logs ml2
        WHERE ml2.equipment_id = e.id
        ORDER BY ml2.performed_at DESC
        LIMIT 3
      ) ml
    ) recent ON true
    WHERE e.is_active = true
      AND (COALESCE(e.last_maint_date, e.install_date) + e.maint_frequency_days) <= v_horizon
  ) sub;

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION public.calculate_projected_asset_spend(int) IS
  'Predicts maintenance expenses for active equipment due within months_ahead months. '
  'Returns JSON: { total_projected_cost, flagged_equipment[] }.';

GRANT EXECUTE ON FUNCTION public.calculate_projected_asset_spend(int) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.calculate_projected_asset_spend(int) FROM anon;

COMMIT;
