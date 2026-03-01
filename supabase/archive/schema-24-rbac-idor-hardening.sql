-- ============================================================
-- SCHEMA 24: RBAC Hardening + Parcels IDOR Fix
--
-- RED TEAM FINDINGS ADDRESSED:
--   1. Horizontal Privilege Escalation — baristas (role='staff')
--      could INSERT/UPDATE/DELETE merch_products and payroll_runs.
--      Fix: New is_brewhub_manager() helper; write policies now
--      require manager/admin role.
--   2. IDOR on parcels — authenticated residents could update
--      any parcel regardless of ownership.
--      Fix: Resident-scoped SELECT/UPDATE policies gated on
--      recipient_email = auth.jwt()->>'email'.
-- ============================================================

BEGIN;

-- ═══════════════════════════════════════════════════════════
-- 1. NEW HELPER: is_brewhub_manager()
--    Returns TRUE only if the caller's email maps to a
--    staff_directory row with role IN ('manager','admin').
--    SECURITY DEFINER bypasses RLS on staff_directory
--    (same pattern as is_brewhub_staff() from schema-12).
-- ═══════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION is_brewhub_manager()
RETURNS boolean AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM staff_directory
    WHERE lower(email) = lower(auth.email())
      AND role IN ('manager', 'admin')
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

GRANT EXECUTE ON FUNCTION is_brewhub_manager() TO authenticated;

-- ═══════════════════════════════════════════════════════════
-- 2. MERCH_PRODUCTS — Restrict writes to managers only
--    (SELECT stays staff-level for dashboard visibility)
-- ═══════════════════════════════════════════════════════════

-- INSERT: manager only
DROP POLICY IF EXISTS "Staff can insert products" ON merch_products;
DROP POLICY IF EXISTS "Manager can insert products" ON merch_products;
CREATE POLICY "Manager can insert products" ON merch_products
  FOR INSERT
  WITH CHECK (is_brewhub_manager());

-- UPDATE: manager only
DROP POLICY IF EXISTS "Staff can update products" ON merch_products;
DROP POLICY IF EXISTS "Manager can update products" ON merch_products;
CREATE POLICY "Manager can update products" ON merch_products
  FOR UPDATE
  USING (is_brewhub_manager())
  WITH CHECK (is_brewhub_manager());

-- DELETE: manager only (previously from schema-20)
DROP POLICY IF EXISTS "Staff can delete products" ON merch_products;
DROP POLICY IF EXISTS "Manager can delete products" ON merch_products;
CREATE POLICY "Manager can delete products" ON merch_products
  FOR DELETE
  USING (is_brewhub_manager());

-- ═══════════════════════════════════════════════════════════
-- 3. PAYROLL_RUNS — Restrict all DML to managers only
--    (table may not exist yet — use IF EXISTS guards)
-- ═══════════════════════════════════════════════════════════

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'payroll_runs') THEN
    EXECUTE 'ALTER TABLE payroll_runs ENABLE ROW LEVEL SECURITY';

    EXECUTE 'DROP POLICY IF EXISTS "Deny public access to payroll_runs" ON payroll_runs';
    EXECUTE 'CREATE POLICY "Deny public access to payroll_runs" ON payroll_runs FOR ALL USING (false)';

    EXECUTE 'DROP POLICY IF EXISTS "Manager can read payroll" ON payroll_runs';
    EXECUTE 'CREATE POLICY "Manager can read payroll" ON payroll_runs FOR SELECT USING (is_brewhub_manager())';

    EXECUTE 'DROP POLICY IF EXISTS "Manager can insert payroll" ON payroll_runs';
    EXECUTE 'CREATE POLICY "Manager can insert payroll" ON payroll_runs FOR INSERT WITH CHECK (is_brewhub_manager())';

    EXECUTE 'DROP POLICY IF EXISTS "Manager can update payroll" ON payroll_runs';
    EXECUTE 'CREATE POLICY "Manager can update payroll" ON payroll_runs FOR UPDATE USING (is_brewhub_manager()) WITH CHECK (is_brewhub_manager())';

    EXECUTE 'DROP POLICY IF EXISTS "Manager can delete payroll" ON payroll_runs';
    EXECUTE 'CREATE POLICY "Manager can delete payroll" ON payroll_runs FOR DELETE USING (is_brewhub_manager())';
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════
-- 4. PARCELS — IDOR FIX
--    Authenticated residents can only SELECT/UPDATE parcels
--    where recipient_email matches their JWT email.
--    Staff/Managers retain full SELECT + UPDATE on all parcels.
-- ═══════════════════════════════════════════════════════════

-- 4a. Resident can read their own parcels
DROP POLICY IF EXISTS "Resident can read own parcels" ON parcels;
CREATE POLICY "Resident can read own parcels" ON parcels
  FOR SELECT
  USING (
    auth.role() = 'authenticated'
    AND lower(recipient_email) = lower(auth.jwt()->>'email')
  );

-- 4b. Resident can update (mark picked_up) their own parcels only
DROP POLICY IF EXISTS "Resident can update own parcels" ON parcels;
CREATE POLICY "Resident can update own parcels" ON parcels
  FOR UPDATE
  USING (
    auth.role() = 'authenticated'
    AND lower(recipient_email) = lower(auth.jwt()->>'email')
  )
  WITH CHECK (
    auth.role() = 'authenticated'
    AND lower(recipient_email) = lower(auth.jwt()->>'email')
  );

-- 4c. Staff/Manager can update any parcel (check-in, status changes)
DROP POLICY IF EXISTS "Staff can update parcels" ON parcels;
CREATE POLICY "Staff can update parcels" ON parcels
  FOR UPDATE
  USING (is_brewhub_staff())
  WITH CHECK (is_brewhub_staff());

-- 4d. Staff can insert parcels (check-in flow uses service_role,
--     but belt-and-suspenders for direct PostgREST calls)
DROP POLICY IF EXISTS "Staff can insert parcels" ON parcels;
CREATE POLICY "Staff can insert parcels" ON parcels
  FOR INSERT
  WITH CHECK (is_brewhub_staff());

-- 4e. Index for IDOR policy performance (avoid seq scan on every RLS check)
CREATE INDEX IF NOT EXISTS idx_parcels_recipient_email
  ON parcels (lower(recipient_email));

-- ═══════════════════════════════════════════════════════════
-- 5. REVOKE is_brewhub_manager() from anon (defense in depth)
-- ═══════════════════════════════════════════════════════════
REVOKE EXECUTE ON FUNCTION is_brewhub_manager() FROM anon;

COMMIT;
