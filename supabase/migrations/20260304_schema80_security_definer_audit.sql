-- ============================================================
-- Schema 80 – Security-Definer View Audit
-- Date:  2026-03-04
-- Lint:  Supabase 0010_security_definer_view
-- ============================================================
-- Supabase's linter flagged 5 views using SECURITY DEFINER.
--
-- Remediation strategy:
--   A) staff_directory_safe, v_attendance_report
--      → Convert to SECURITY INVOKER. These are only consumed by
--        service_role (which bypasses RLS anyway) or have NO
--        consumers at all. No behaviour change.
--
--   B) v_items_to_pickup, v_staff_status, parcel_departure_board
--      → KEEP SECURITY DEFINER (intentional). These provide
--        masked / aggregated data windows to the anon browser
--        client without granting direct SELECT on the underlying
--        tables (orders, parcels, outbound_parcels, staff_directory,
--        time_logs). Converting them would either break the frontend
--        or require granting anon full table reads — which would
--        expose PII (full names, tracking numbers, emails).
--
--        We harden them by:
--          • Revoking every privilege except SELECT
--          • Restricting grants to only the roles that actually need them
--          • Documenting the justification inline
-- ============================================================

BEGIN;

-- ────────────────────────────────────────────────────────────
-- A-1  staff_directory_safe  →  SECURITY INVOKER
-- ────────────────────────────────────────────────────────────
-- Only consumed by manage-schedule.js via service_role client,
-- which bypasses RLS regardless.
--
-- Cannot use CREATE OR REPLACE because we're dropping the
-- deprecated is_working column. Must DROP CASCADE first
-- (v_attendance_report depends on this view — it's recreated below).
DROP VIEW IF EXISTS public.v_attendance_report;
DROP VIEW IF EXISTS public.staff_directory_safe;

CREATE VIEW public.staff_directory_safe
  WITH (security_invoker = true)
AS
SELECT
  id,
  name,
  full_name,
  email,
  role,
  is_active,
  created_at,
  token_version,
  version_updated_at
FROM staff_directory;

-- Keep existing grants (only authenticated + service_role need this)
REVOKE ALL ON public.staff_directory_safe FROM anon;
GRANT SELECT ON public.staff_directory_safe TO authenticated, service_role;

COMMENT ON VIEW public.staff_directory_safe IS
  'Safe projection of staff_directory (no pin_hash). SECURITY INVOKER – callers need own table perms. Consumed only by service_role in manage-schedule.js.';


-- ────────────────────────────────────────────────────────────
-- A-2  v_attendance_report  →  SECURITY INVOKER
-- ────────────────────────────────────────────────────────────
-- Zero active consumers in any application code.
-- Already dropped above (depended on staff_directory_safe).
CREATE VIEW public.v_attendance_report
  WITH (security_invoker = true)
AS
SELECT DISTINCT ON (ss.id)
    ss.id AS shift_id,
    ss.user_id,
    sd.email AS employee_email,
    ss.start_time AS scheduled_start,
    ss.end_time AS scheduled_end,
    tl.clock_in AS actual_clock_in,
    EXTRACT(EPOCH FROM (tl.clock_in - ss.start_time)) / 60 AS minutes_late,
    CASE
        WHEN tl.clock_in IS NULL AND NOW() > (ss.start_time + INTERVAL '30 minutes') THEN 'No-Show'
        WHEN tl.clock_in IS NULL THEN 'Pending'
        WHEN (tl.clock_in - ss.start_time) > INTERVAL '10 minutes' THEN 'Tardy'
        WHEN (tl.clock_in - ss.start_time) < INTERVAL '-15 minutes' THEN 'Early Clock-in'
        ELSE 'On-Time'
    END AS attendance_status
FROM public.scheduled_shifts ss
LEFT JOIN public.staff_directory_safe sd ON ss.user_id = sd.id
LEFT JOIN public.time_logs tl ON LOWER(sd.email) = LOWER(tl.employee_email)
    AND tl.clock_in BETWEEN (ss.start_time - INTERVAL '3 hours') AND (ss.start_time + INTERVAL '3 hours')
ORDER BY ss.id, tl.clock_in ASC NULLS LAST;

REVOKE ALL ON public.v_attendance_report FROM anon;
GRANT SELECT ON public.v_attendance_report TO authenticated, service_role;

COMMENT ON VIEW public.v_attendance_report IS
  'Attendance report joining shifts ↔ time_logs. SECURITY INVOKER – no active consumers. Retained for future manager dashboards.';


-- ────────────────────────────────────────────────────────────
-- B-1  v_items_to_pickup  ─  KEEP SECURITY DEFINER (harden)
-- ────────────────────────────────────────────────────────────
-- Justification: Queried by the anon browser client in
-- ParcelsMonitor.tsx and QueueMonitor.tsx. The view intentionally
-- masks customer names (first initial only) and tracking numbers
-- (last 4 digits). Switching to SECURITY INVOKER would require
-- granting anon SELECT on orders, parcels, and outbound_parcels –
-- exposing full PII.

-- Harden: ensure only SELECT is granted
REVOKE ALL ON public.v_items_to_pickup FROM anon, authenticated, service_role;
GRANT SELECT ON public.v_items_to_pickup TO anon, authenticated, service_role;

COMMENT ON VIEW public.v_items_to_pickup IS
  'Unified pickup board (cafe + inbound + outbound). SECURITY DEFINER intentional: provides masked data window to anon clients without granting raw table access. Lint 0010 acknowledged 2026-03-04.';


-- ────────────────────────────────────────────────────────────
-- B-2  v_staff_status  ─  KEEP SECURITY DEFINER (harden)
-- ────────────────────────────────────────────────────────────
-- Justification: Queried by the anon/authenticated browser client
-- in StaffSection.tsx, and by service_role in pin-login.js,
-- pin-verify.js, webauthn-login.js, get-shift-status.js,
-- no-show-alert.js. The view computes is_working from time_logs
-- without exposing pin_hash or other sensitive columns.

REVOKE ALL ON public.v_staff_status FROM anon, authenticated, service_role;
GRANT SELECT ON public.v_staff_status TO anon, authenticated, service_role;

COMMENT ON VIEW public.v_staff_status IS
  'Staff directory + computed is_working from time_logs. SECURITY DEFINER intentional: hides pin_hash and raw time_logs from browser clients. Lint 0010 acknowledged 2026-03-04.';


-- ────────────────────────────────────────────────────────────
-- B-3  parcel_departure_board  ─  KEEP SECURITY DEFINER (harden)
-- ────────────────────────────────────────────────────────────
-- Justification: Queried by the anon browser client in
-- ParcelsMonitor.tsx and parcels/page.tsx (public departure board).
-- The view intentionally masks recipient names (first initial)
-- and tracking numbers (last 4 digits), and jitters timestamps
-- to prevent timing attacks.

REVOKE ALL ON public.parcel_departure_board FROM anon, authenticated, service_role;
GRANT SELECT ON public.parcel_departure_board TO anon, authenticated, service_role;

COMMENT ON VIEW public.parcel_departure_board IS
  'Public parcel departure board with masked PII and jittered timestamps. SECURITY DEFINER intentional: prevents anon from reading raw parcels/outbound_parcels. Lint 0010 acknowledged 2026-03-04.';


COMMIT;
