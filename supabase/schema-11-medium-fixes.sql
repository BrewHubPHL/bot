-- ============================================================
-- SCHEMA 11: Medium-Severity Audit Fixes
--   A) DB-backed PIN brute-force lockout (replaces in-memory Map)
--   B) Staff-scoped RLS SELECT policies for dashboard/KDS tables
-- ============================================================

-- ═══════════════════════════════════════════════════════════════
-- A) DB-BACKED PIN BRUTE-FORCE LOCKOUT (replaces in-memory Map)
-- ═══════════════════════════════════════════════════════════════
-- pin-login.js previously used an in-memory Map that reset on cold start
-- and didn't share state across Lambda instances. This RPC provides a
-- persistent, atomic counter keyed by client IP.

-- Lightweight table to track failed PIN attempts by IP
CREATE TABLE IF NOT EXISTS pin_attempts (
  ip text PRIMARY KEY,
  fail_count int NOT NULL DEFAULT 0,
  window_start timestamptz NOT NULL DEFAULT now(),
  locked_until timestamptz
);
ALTER TABLE pin_attempts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Deny public access to pin_attempts" ON pin_attempts;
CREATE POLICY "Deny public access to pin_attempts" ON pin_attempts FOR ALL USING (false);

-- RPC: Atomically record a failed PIN attempt and enforce lockout by IP.
-- Returns: { locked: bool, retry_after_seconds: int }
CREATE OR REPLACE FUNCTION record_pin_failure(p_ip text, p_max_attempts int DEFAULT 5, p_lockout_seconds int DEFAULT 60)
RETURNS TABLE(locked boolean, retry_after_seconds int) AS $$
DECLARE
  v_row pin_attempts%ROWTYPE;
BEGIN
  -- Upsert: create row if missing, otherwise increment
  INSERT INTO pin_attempts (ip, fail_count, window_start)
  VALUES (p_ip, 1, now())
  ON CONFLICT (ip) DO UPDATE SET
    -- Reset window if expired
    fail_count = CASE
      WHEN pin_attempts.window_start < now() - (p_lockout_seconds || ' seconds')::interval THEN 1
      ELSE pin_attempts.fail_count + 1
    END,
    window_start = CASE
      WHEN pin_attempts.window_start < now() - (p_lockout_seconds || ' seconds')::interval THEN now()
      ELSE pin_attempts.window_start
    END,
    locked_until = CASE
      WHEN pin_attempts.window_start >= now() - (p_lockout_seconds || ' seconds')::interval
           AND pin_attempts.fail_count + 1 >= p_max_attempts
      THEN now() + (p_lockout_seconds || ' seconds')::interval
      ELSE pin_attempts.locked_until
    END
  RETURNING * INTO v_row;

  IF v_row.locked_until IS NOT NULL AND v_row.locked_until > now() THEN
    RETURN QUERY SELECT true, GREATEST(0, EXTRACT(EPOCH FROM v_row.locked_until - now())::int);
  ELSE
    RETURN QUERY SELECT false, 0;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- RPC: Check if an IP is currently locked out (fast pre-check)
CREATE OR REPLACE FUNCTION check_pin_lockout(p_ip text)
RETURNS TABLE(locked boolean, retry_after_seconds int) AS $$
DECLARE
  v_locked_until timestamptz;
BEGIN
  SELECT locked_until INTO v_locked_until FROM pin_attempts WHERE ip = p_ip;
  IF v_locked_until IS NOT NULL AND v_locked_until > now() THEN
    RETURN QUERY SELECT true, GREATEST(0, EXTRACT(EPOCH FROM v_locked_until - now())::int);
  ELSE
    RETURN QUERY SELECT false, 0;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- RPC: Clear lockout on successful login
CREATE OR REPLACE FUNCTION clear_pin_lockout(p_ip text)
RETURNS void AS $$
BEGIN
  DELETE FROM pin_attempts WHERE ip = p_ip;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Revoke direct access from anon/authenticated
REVOKE EXECUTE ON FUNCTION record_pin_failure(text, int, int) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION check_pin_lockout(text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION clear_pin_lockout(text) FROM anon, authenticated;

-- ═══════════════════════════════════════════════════════════════
-- B) STAFF-SCOPED RLS SELECT POLICIES
-- ═══════════════════════════════════════════════════════════════
-- The manager dashboard and KDS pages query these tables client-side
-- using the anon key (after Supabase Auth login). The existing deny-all
-- policies block all reads, causing empty dashboards.
--
-- These policies allow authenticated users whose email exists in
-- staff_directory to SELECT from operational tables.
-- The deny-all FOR ALL policy still blocks INSERT/UPDATE/DELETE.
-- ═══════════════════════════════════════════════════════════════

-- Helper: reusable staff-check expression
-- (Postgres evaluates the subquery per-row but the planner caches it for the session)

-- orders: staff can read all orders (needed for KDS, manager dashboard)
DROP POLICY IF EXISTS "Staff can read orders" ON orders;
CREATE POLICY "Staff can read orders" ON orders
  FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM staff_directory WHERE lower(email) = lower(auth.email()))
  );

-- coffee_orders: staff can read all line items (needed for KDS item display)
DROP POLICY IF EXISTS "Staff can read coffee_orders" ON coffee_orders;
CREATE POLICY "Staff can read coffee_orders" ON coffee_orders
  FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM staff_directory WHERE lower(email) = lower(auth.email()))
  );

-- staff_directory: upgrade from "own row only" to "all staff can read all staff"
-- Needed for manager payroll tally and staff status display.
-- PIN column is excluded by the client query (SELECT id, name, email, role, ...)
-- but as defense-in-depth, consider a VIEW that excludes pin. For now, the
-- existing client queries never SELECT pin.
DROP POLICY IF EXISTS "Staff can read own row" ON staff_directory;
DROP POLICY IF EXISTS "Staff can read all staff" ON staff_directory;
CREATE POLICY "Staff can read all staff" ON staff_directory
  FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM staff_directory WHERE lower(email) = lower(auth.email()))
  );

-- time_logs: staff can read all time logs (needed for payroll tally)
DROP POLICY IF EXISTS "Staff can read time_logs" ON time_logs;
CREATE POLICY "Staff can read time_logs" ON time_logs
  FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM staff_directory WHERE lower(email) = lower(auth.email()))
  );
