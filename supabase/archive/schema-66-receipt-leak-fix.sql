-- schema-66-receipt-leak-fix.sql
-- Phase 1 Security Remediation: Close receipt_queue PII leak
--
-- The "Allow anon select for realtime" policy exposed customer names
-- and business telemetry to any browser with the anon key.
-- The frontend now polls exclusively via the authenticated get-receipts
-- Netlify function, so anon SELECT is no longer needed.
--
-- Default deny-all + staff-only policies remain intact.

BEGIN;

DROP POLICY IF EXISTS "Allow anon select for realtime" ON public.receipt_queue;

COMMIT;
