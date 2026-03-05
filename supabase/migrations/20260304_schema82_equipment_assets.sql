-- ============================================================
-- Schema 82 – Equipment & Maintenance Log Tables
-- Date:  2026-03-04
-- ============================================================
--
-- OVERVIEW
-- ────────
-- Adds an equipment asset registry and a maintenance_logs
-- journal so managers can track Total Cost of Ownership (TCO)
-- and preventive-maintenance schedules.
--
-- RLS: manager-only via is_brewhub_manager().
-- ============================================================

BEGIN;

-- ════════════════════════════════════════════════════════════
-- 1) equipment table
-- ════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.equipment (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name            text NOT NULL,
  description     text,
  category        text NOT NULL DEFAULT 'general',
  purchase_price  numeric(10,2) NOT NULL DEFAULT 0,
  install_date    date NOT NULL DEFAULT CURRENT_DATE,
  maint_frequency_days  integer NOT NULL DEFAULT 90,
  last_maint_date date,
  is_active       boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE  public.equipment IS 'Physical equipment / asset registry.';
COMMENT ON COLUMN public.equipment.purchase_price IS 'Original purchase cost (USD).';
COMMENT ON COLUMN public.equipment.install_date IS 'Date the equipment was installed / put into service.';
COMMENT ON COLUMN public.equipment.maint_frequency_days IS 'Max days between maintenance events before the asset is considered overdue.';
COMMENT ON COLUMN public.equipment.last_maint_date IS 'Date of the most recent maintenance event (denormalized for fast health checks).';

-- ════════════════════════════════════════════════════════════
-- 2) maintenance_logs table
-- ════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.maintenance_logs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  equipment_id    uuid NOT NULL REFERENCES public.equipment(id) ON DELETE CASCADE,
  performed_at    date NOT NULL DEFAULT CURRENT_DATE,
  cost            numeric(10,2) NOT NULL DEFAULT 0,
  notes           text,
  performed_by    uuid REFERENCES public.staff_directory(id),
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_maint_logs_equipment ON public.maintenance_logs(equipment_id);
CREATE INDEX IF NOT EXISTS idx_maint_logs_performed_at ON public.maintenance_logs(performed_at DESC);

COMMENT ON TABLE  public.maintenance_logs IS 'Journal of maintenance events per equipment asset.';
COMMENT ON COLUMN public.maintenance_logs.cost IS 'Cost of this maintenance event (USD).';

-- ════════════════════════════════════════════════════════════
-- 3) Trigger: auto-update last_maint_date on equipment
-- ════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.trg_update_last_maint_date()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
BEGIN
  UPDATE public.equipment
    SET last_maint_date = NEW.performed_at,
        updated_at      = now()
  WHERE id = NEW.equipment_id
    AND (last_maint_date IS NULL OR last_maint_date < NEW.performed_at);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS maint_log_after_insert ON public.maintenance_logs;
CREATE TRIGGER maint_log_after_insert
  AFTER INSERT ON public.maintenance_logs
  FOR EACH ROW EXECUTE FUNCTION public.trg_update_last_maint_date();

-- ════════════════════════════════════════════════════════════
-- 4) Trigger: auto-update updated_at on equipment
-- ════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.trg_equipment_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS equipment_set_updated_at ON public.equipment;
CREATE TRIGGER equipment_set_updated_at
  BEFORE UPDATE ON public.equipment
  FOR EACH ROW EXECUTE FUNCTION public.trg_equipment_updated_at();

-- ════════════════════════════════════════════════════════════
-- 5) RLS – manager-only access via is_brewhub_manager()
-- ════════════════════════════════════════════════════════════

ALTER TABLE public.equipment ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.maintenance_logs ENABLE ROW LEVEL SECURITY;

-- equipment policies
CREATE POLICY "Manager can select equipment"
  ON public.equipment FOR SELECT
  USING (is_brewhub_manager());

CREATE POLICY "Manager can insert equipment"
  ON public.equipment FOR INSERT
  WITH CHECK (is_brewhub_manager());

CREATE POLICY "Manager can update equipment"
  ON public.equipment FOR UPDATE
  USING (is_brewhub_manager())
  WITH CHECK (is_brewhub_manager());

CREATE POLICY "Manager can delete equipment"
  ON public.equipment FOR DELETE
  USING (is_brewhub_manager());

-- maintenance_logs policies
CREATE POLICY "Manager can select maintenance_logs"
  ON public.maintenance_logs FOR SELECT
  USING (is_brewhub_manager());

CREATE POLICY "Manager can insert maintenance_logs"
  ON public.maintenance_logs FOR INSERT
  WITH CHECK (is_brewhub_manager());

CREATE POLICY "Manager can update maintenance_logs"
  ON public.maintenance_logs FOR UPDATE
  USING (is_brewhub_manager())
  WITH CHECK (is_brewhub_manager());

CREATE POLICY "Manager can delete maintenance_logs"
  ON public.maintenance_logs FOR DELETE
  USING (is_brewhub_manager());

-- ════════════════════════════════════════════════════════════
-- 6) RPC – get_asset_analytics()
--    Returns TCO, health status, and daily operating cost
--    in a single server-side call for the dashboard.
-- ════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.get_asset_analytics()
RETURNS TABLE (
  id                  uuid,
  name                text,
  category            text,
  purchase_price      numeric,
  install_date        date,
  maint_frequency_days integer,
  last_maint_date     date,
  is_active           boolean,
  total_maint_cost    numeric,
  total_cost          numeric,
  days_since_install  integer,
  daily_operating_cost numeric,
  is_overdue          boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = 'public'
AS $$
  SELECT
    e.id,
    e.name,
    e.category,
    e.purchase_price,
    e.install_date,
    e.maint_frequency_days,
    e.last_maint_date,
    e.is_active,
    COALESCE(m.total_maint_cost, 0)                    AS total_maint_cost,
    e.purchase_price + COALESCE(m.total_maint_cost, 0) AS total_cost,
    GREATEST(CURRENT_DATE - e.install_date, 1)         AS days_since_install,
    ROUND(
      (e.purchase_price + COALESCE(m.total_maint_cost, 0))
      / GREATEST(CURRENT_DATE - e.install_date, 1),
      2
    )                                                  AS daily_operating_cost,
    CASE
      WHEN e.last_maint_date IS NULL THEN
        (CURRENT_DATE - e.install_date) > e.maint_frequency_days
      ELSE
        (CURRENT_DATE - e.last_maint_date) > e.maint_frequency_days
    END                                                AS is_overdue
  FROM public.equipment e
  LEFT JOIN LATERAL (
    SELECT SUM(ml.cost) AS total_maint_cost
    FROM public.maintenance_logs ml
    WHERE ml.equipment_id = e.id
  ) m ON true
  WHERE e.is_active = true
  ORDER BY e.name;
$$;

GRANT EXECUTE ON FUNCTION public.get_asset_analytics() TO authenticated;
REVOKE EXECUTE ON FUNCTION public.get_asset_analytics() FROM anon;

COMMIT;
