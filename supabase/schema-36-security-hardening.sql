-- #############################################################################
-- ## schema-36-security-hardening.sql — Critical security remediations
-- ##
-- ## Fixes:
-- ##   1. profiles UPDATE RLS: prevent users from self-modifying
-- ##      loyalty_points, is_vip, total_orders, barcode_id
-- ##   2. staff_directory SELECT RLS: exclude pin and hourly_rate columns
-- ##      from non-manager staff (use a secure VIEW instead)
-- ##   3. restore_inventory_on_refund: add FOR UPDATE lock to prevent
-- ##      double-restore on concurrent refund webhooks
-- #############################################################################

-- ─────────────────────────────────────────────────────────────────────────────
-- FIX 1: Profiles UPDATE — restrict writable columns via BEFORE UPDATE trigger
-- ─────────────────────────────────────────────────────────────────────────────
-- The current RLS policy "Users can update own profile" only checks
-- auth.uid() = id. It does NOT restrict which columns a user can modify.
-- An authenticated user could POST: UPDATE profiles SET loyalty_points = 999999
-- via the PostgREST PATCH endpoint.
--
-- Solution: a BEFORE UPDATE trigger that resets protected columns to their
-- OLD values, so even if the client sends them they are silently discarded.

CREATE OR REPLACE FUNCTION guard_profile_protected_columns()
RETURNS trigger AS $$
BEGIN
  -- Only restrict end-user roles (authenticated/anon via PostgREST).
  -- Service_role, postgres, supabase_admin, and other backend roles are trusted.
  IF current_setting('role', true) NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;

  -- For authenticated/anon users: reset protected columns to their previous values
  NEW.loyalty_points := OLD.loyalty_points;
  NEW.is_vip         := OLD.is_vip;
  NEW.total_orders   := OLD.total_orders;
  NEW.barcode_id     := OLD.barcode_id;
  NEW.created_at     := OLD.created_at;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_guard_profile_protected ON profiles;
CREATE TRIGGER trg_guard_profile_protected
  BEFORE UPDATE ON profiles
  FOR EACH ROW
  EXECUTE FUNCTION guard_profile_protected_columns();


-- ─────────────────────────────────────────────────────────────────────────────
-- FIX 2: staff_directory SELECT — create a restricted view for non-manager staff
-- ─────────────────────────────────────────────────────────────────────────────
-- Current policy: "Staff can read all staff" grants full SELECT on every column
-- including `pin` (plaintext POS PIN) and `hourly_rate` (compensation).
-- This allows any barista to see colleagues' PINs and impersonate them.
--
-- Solution: Replace the open SELECT policy with one that excludes sensitive
-- columns for non-managers. Since RLS is row-level (not column-level), we use
-- a SECURITY DEFINER view that managers can bypass.

-- First, create a safe view that excludes pin and hourly_rate
DROP VIEW IF EXISTS staff_directory_safe;
CREATE VIEW staff_directory_safe
  WITH (security_invoker = false)  -- runs as definer, bypasses RLS
AS
SELECT
  id,
  name,
  full_name,
  email,
  role,
  is_working,
  created_at,
  token_version
  -- pin and hourly_rate are intentionally excluded
FROM staff_directory;

-- Grant access to the safe view
GRANT SELECT ON staff_directory_safe TO authenticated;

-- Revoke direct table access from non-service roles
-- (staff_directory RLS still applies; we tighten the SELECT policy)
DROP POLICY IF EXISTS "Staff can read all staff" ON staff_directory;

-- Managers can read all columns (including pin for verification, hourly_rate for payroll)
DROP POLICY IF EXISTS "Managers can read all staff" ON staff_directory;
CREATE POLICY "Managers can read all staff" ON staff_directory
  FOR SELECT
  USING (is_brewhub_manager());

-- Non-manager staff can only read their OWN row (for profile display)
DROP POLICY IF EXISTS "Staff can read own row" ON staff_directory;
CREATE POLICY "Staff can read own row" ON staff_directory
  FOR SELECT
  USING (lower(email) = lower(auth.email()));

COMMENT ON VIEW staff_directory_safe IS
  'Restricted view of staff_directory excluding pin and hourly_rate. '
  'Use this for KDS, POS, and non-manager UIs instead of querying the table directly.';


-- ─────────────────────────────────────────────────────────────────────────────
-- FIX 3: restore_inventory_on_refund — add FOR UPDATE row lock
-- ─────────────────────────────────────────────────────────────────────────────
-- Without FOR UPDATE, two concurrent refund webhooks for the same order both
-- read inventory_decremented = true, both restore cups, then both set the
-- flag to false. This inflates inventory by 2×.
--
-- Fix: SELECT ... FOR UPDATE locks the order row so only one concurrent
-- caller proceeds. The second caller blocks until the first commits
-- (at which point inventory_decremented = false and it returns early).

CREATE OR REPLACE FUNCTION restore_inventory_on_refund(p_order_id uuid)
RETURNS jsonb AS $$
DECLARE
  v_cups_dec  int;
  v_was_dec   boolean;
BEGIN
  -- Lock the order row to prevent concurrent double-restore
  SELECT COALESCE(inventory_decremented, false),
         COALESCE(cups_decremented, 0)
  INTO v_was_dec, v_cups_dec
  FROM orders
  WHERE id = p_order_id
  FOR UPDATE;            -- ← row-level lock prevents TOCTOU race

  IF NOT v_was_dec THEN
    RETURN jsonb_build_object('restored', false, 'reason', 'inventory was never decremented');
  END IF;

  IF v_cups_dec > 0 THEN
    UPDATE inventory
    SET current_stock = current_stock + v_cups_dec,
        updated_at    = now()
    WHERE item_name = '12oz Cups';
  END IF;

  -- Clear the flag atomically under the lock
  UPDATE orders
  SET inventory_decremented = false,
      cups_decremented = 0
  WHERE id = p_order_id
    AND inventory_decremented = true;  -- ← belt-and-suspenders: only first caller matches

  RETURN jsonb_build_object('restored', true, 'cups_restored', v_cups_dec);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

REVOKE EXECUTE ON FUNCTION restore_inventory_on_refund(uuid) FROM anon, authenticated;
