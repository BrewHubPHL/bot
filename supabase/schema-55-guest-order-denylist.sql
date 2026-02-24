-- schema-55: Guest order IP denylist
-- Staff can INSERT a client_ip_hash here to silently block repeat pranksters.
-- No code change required — place_order checks this table before every guest order.

CREATE TABLE IF NOT EXISTS guest_order_denylist (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_ip_hash text NOT NULL UNIQUE,
  reason       text,                          -- staff note, never shown to user
  created_by   text,                          -- staff email/name who added entry
  created_at   timestamptz DEFAULT now(),
  expires_at   timestamptz DEFAULT NULL        -- NULL = permanent; set a timestamp for temporary bans
);

COMMENT ON TABLE guest_order_denylist IS
  'Blocked guest-order IP hashes. Matched against orders.client_ip_hash at order time.';
COMMENT ON COLUMN guest_order_denylist.expires_at IS
  'NULL means permanent block. Set a future timestamp for a time-limited ban.';

-- Fast lookup on the hash (exact match on every guest order attempt).
-- A separate partial index for active entries is not possible because now() is STABLE,
-- not IMMUTABLE, and Postgres forbids non-immutable functions in index predicates.
-- The plain index is sufficient — expiry is filtered at query time.
CREATE INDEX IF NOT EXISTS idx_denylist_ip_hash ON guest_order_denylist (client_ip_hash);

-- RLS: only the service role can manage this table.
-- No direct client access — all interaction goes through Netlify functions.
ALTER TABLE guest_order_denylist ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_only" ON guest_order_denylist
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
