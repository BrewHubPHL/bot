-- ============================================================
-- SCHEMA 14: Parcel Departure Board VIEW + RLS
--
-- SECURITY MODEL:
--   The TV monitor queries a Postgres VIEW that pre-masks PII.
--   Raw recipient_name and tracking_number never leave the DB
--   for unauthenticated requests — not even in Realtime payloads
--   (the frontend ignores Realtime payloads and re-fetches the
--   VIEW on every change event).
--
--   The VIEW uses security_invoker = false (the default) so it
--   runs as its owner (postgres superuser), bypassing RLS on
--   the underlying parcels table. This means we do NOT need an
--   anon SELECT policy on parcels — and intentionally must NOT
--   add one, because PostgREST would expose the raw table
--   directly, completely bypassing the VIEW's PII masking.
--
--   Staff get full access to the raw parcels table via
--   is_brewhub_staff().
-- ============================================================

-- 1. Secure VIEW — masks PII at the database level
--    security_invoker = false  → VIEW executes as owner (postgres),
--    which bypasses RLS on the underlying `parcels` table.
--    Anon users can only reach this VIEW, never the raw table.
CREATE OR REPLACE VIEW parcel_departure_board
  WITH (security_invoker = false)
AS
SELECT
  id,
  -- "John Smith" → "J. Smith", single name → "J. ***"
  CASE
    WHEN recipient_name IS NULL OR trim(recipient_name) = '' THEN 'Resident'
    WHEN position(' ' IN trim(recipient_name)) = 0
      THEN upper(left(trim(recipient_name), 1)) || '. ***'
    ELSE upper(left(trim(recipient_name), 1)) || '. '
         || split_part(trim(recipient_name), ' ', array_length(string_to_array(trim(recipient_name), ' '), 1))
  END AS masked_name,
  -- "1Z999AA10123456784" + carrier "UPS" → "UPS ...6784"
  COALESCE(carrier, 'PKG') || ' ...' || right(tracking_number, 4) AS masked_tracking,
  carrier,
  received_at,
  unit_number
FROM parcels
WHERE status = 'arrived';

-- 2. Grant anon + authenticated SELECT on the VIEW only
GRANT SELECT ON parcel_departure_board TO anon, authenticated;

-- 3. IMPORTANT: No anon SELECT policy on the raw `parcels` table.
--    The deny-all policy from schema-5 stays in place for anon,
--    so direct PostgREST queries to /rest/v1/parcels return nothing.
--    The VIEW bypasses this because it runs as its owner (postgres).

-- Clean up any previously created anon policy (from earlier drafts)
DROP POLICY IF EXISTS "Public can read arrived parcels" ON parcels;

-- 4. Staff can read all raw parcels (manager dashboard, parcels.html)
DROP POLICY IF EXISTS "Staff can read parcels" ON parcels;
CREATE POLICY "Staff can read parcels" ON parcels
  FOR SELECT
  USING (is_brewhub_staff());
