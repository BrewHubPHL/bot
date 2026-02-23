-- ============================================================
-- Schema 51: Receipt Queue + View Access Hardening (Audit #16)
-- ============================================================
-- Fixes:
--   SQL-H1: receipt_queue anon SELECT exposes ALL receipt text
--           → Time-scope to last 30 minutes (enough for Realtime)
--   SQL-H2: daily_sales_report VIEW readable by anon/authenticated
--           → REVOKE SELECT (only service_role via Netlify functions)
--   SQL-H2b: v_payroll_summary VIEW readable by anon/authenticated
--            → REVOKE SELECT (PII: employee emails, hourly rates, gross pay)
--
-- Idempotent: safe to re-run in the Supabase SQL Editor.
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- FIX 1: SQL-H1 — Time-scope anon receipt_queue SELECT
-- ─────────────────────────────────────────────────────────────
-- Schema-33 granted USING (true) to anon for Realtime.
-- That exposes ALL historical receipt text (customer names, items,
-- amounts) to anyone with the anon key.
--
-- Fix: Replace with a 30-minute window. Realtime only needs recent
-- rows. Staff retain full access via the schema-9 staff policy.
-- ─────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "Allow anon select for realtime" ON receipt_queue;
CREATE POLICY "Allow anon select for realtime" ON receipt_queue
  FOR SELECT
  USING (created_at > now() - interval '30 minutes');

-- ─────────────────────────────────────────────────────────────
-- FIX 2: SQL-H2 — REVOKE anon/authenticated on daily_sales_report
-- ─────────────────────────────────────────────────────────────
-- The VIEW was never explicitly restricted. PostgREST exposes it
-- to any role with SELECT. Revenue figures should only be visible
-- to manager-auth'd Netlify functions (service_role).
-- ─────────────────────────────────────────────────────────────

REVOKE SELECT ON daily_sales_report FROM anon, authenticated;

-- ─────────────────────────────────────────────────────────────
-- FIX 3: SQL-H2b — REVOKE anon/authenticated on v_payroll_summary
-- ─────────────────────────────────────────────────────────────
-- The VIEW exposes employee emails, names, hourly rates, and
-- gross pay. Only service_role (via manager-auth'd functions)
-- should access it.
-- ─────────────────────────────────────────────────────────────

REVOKE SELECT ON v_payroll_summary FROM anon, authenticated;
