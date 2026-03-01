-- ============================================================
-- SCHEMA 52: Trigger Hardening & Missing Constraints
--   Audit #23 — SQL-M1, SQL-M2, SQL-M4
--
--   1. sync_coffee_order_status: add EXCEPTION handler
--   2. comp_audit: add FK constraints on order_id + staff_id
--   3. time_logs: add functional index on lower(employee_email)
-- ============================================================

-- ═══════════════════════════════════════════════════════════════
-- 1. sync_coffee_order_status — EXCEPTION handler
--    Prevents a coffee_orders UPDATE failure from blocking the
--    parent order status change. Logs errors to system_sync_logs.
-- ═══════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION sync_coffee_order_status()
RETURNS TRIGGER AS $$
BEGIN
  SET LOCAL statement_timeout = '3s';
  SET LOCAL lock_timeout      = '2s';

  UPDATE public.coffee_orders
  SET status = NEW.status
  WHERE order_id = NEW.id;

  RETURN NEW;

EXCEPTION WHEN OTHERS THEN
  BEGIN
    INSERT INTO public.system_sync_logs
      (source, detail, sql_state, severity)
    VALUES
      ('sync_coffee_order_status',
       format('Order %s → %s: %s', NEW.id, NEW.status, SQLERRM),
       SQLSTATE,
       'error');
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '[sync_coffee_order_status] log-insert failed for order %: %',
      NEW.id, SQLERRM;
  END;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Re-bind trigger (idempotent)
DROP TRIGGER IF EXISTS trg_sync_coffee_status ON public.orders;
CREATE TRIGGER trg_sync_coffee_status
  AFTER UPDATE OF status ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION sync_coffee_order_status();

-- ═══════════════════════════════════════════════════════════════
-- 2. comp_audit — FK constraints
--    Prevent orphan rows by referencing orders + staff_directory.
--    ON DELETE RESTRICT: cannot delete an order/staff that has comps.
-- ═══════════════════════════════════════════════════════════════
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'comp_audit_order_id_fkey'
      AND table_name = 'comp_audit'
  ) THEN
    ALTER TABLE public.comp_audit
      ADD CONSTRAINT comp_audit_order_id_fkey
      FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'comp_audit_staff_id_fkey'
      AND table_name = 'comp_audit'
  ) THEN
    ALTER TABLE public.comp_audit
      ADD CONSTRAINT comp_audit_staff_id_fkey
      FOREIGN KEY (staff_id) REFERENCES public.staff_directory(id) ON DELETE RESTRICT;
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════
-- 3. time_logs — functional index on lower(employee_email)
--    Payroll queries (v_payroll_summary, atomic_staff_clock)
--    compare with lower(), but only a plain index existed.
-- ═══════════════════════════════════════════════════════════════
CREATE INDEX IF NOT EXISTS idx_time_logs_email_lower
  ON public.time_logs (lower(employee_email));

-- ═══════════════════════════════════════════════════════════════
-- End of schema-52
-- ═══════════════════════════════════════════════════════════════
