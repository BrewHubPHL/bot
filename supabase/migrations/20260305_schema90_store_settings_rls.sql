-- ═══════════════════════════════════════════════════════════════════════════
-- Schema 90 — Enable RLS on store_settings
-- ═══════════════════════════════════════════════════════════════════════════
-- store_settings contains the shop_ip_address used for network gating.
-- Without RLS, anonymous and authenticated clients could read the shop IP.
-- All legitimate access is via Netlify serverless functions using the
-- service_role key, which bypasses RLS.  No permissive policies are needed
-- for anon or authenticated roles.
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. Enable RLS (denies all access by default for non-service_role)
ALTER TABLE public.store_settings ENABLE ROW LEVEL SECURITY;

-- 2. Force RLS even for the table owner (postgres role) so that direct
--    psql sessions also have no accidental leaks.  service_role still
--    bypasses because Supabase marks it with `bypassrls`.
ALTER TABLE public.store_settings FORCE ROW LEVEL SECURITY;

-- 3. Revoke any lingering direct grants from public-facing roles.
REVOKE ALL ON public.store_settings FROM anon, authenticated;

-- 4. (Optional safety net) Explicit deny-all policies.  With no USING
--    clause that returns true, these ensure zero rows are visible even if
--    a future migration accidentally re-grants SELECT.
CREATE POLICY "Deny all access for anon"
  ON public.store_settings
  FOR ALL
  TO anon
  USING (false)
  WITH CHECK (false);

CREATE POLICY "Deny all access for authenticated"
  ON public.store_settings
  FOR ALL
  TO authenticated
  USING (false)
  WITH CHECK (false);
