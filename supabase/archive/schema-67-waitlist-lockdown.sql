-- schema-67-waitlist-lockdown.sql
-- Phase 2 Security Remediation: "The Waitlist Fortress"
--
-- The anon INSERT policy let any browser write directly to
-- the waitlist table via the Supabase client, enabling botnet
-- flooding. Signups now go through the rate-limited, CSRF-protected
-- join-waitlist Netlify function using the service_role key.

BEGIN;

DROP POLICY IF EXISTS "Public can insert to waitlist" ON public.waitlist;

COMMIT;
