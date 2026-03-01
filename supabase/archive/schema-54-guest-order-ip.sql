-- schema-54: Guest order IP tracking
-- Adds a hashed client IP column to orders for abuse/prankster correlation.
-- Raw IPs are never stored — consistent with the hashIP(_ip-hash.js) pattern.
-- is_guest_order makes it easy to filter chat-originated guest orders in the KDS/admin.

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS client_ip_hash text,
  ADD COLUMN IF NOT EXISTS is_guest_order  boolean DEFAULT false;

COMMENT ON COLUMN orders.client_ip_hash IS
  'Salted SHA-256 of the client IP at order time (via _ip-hash.js). Never a raw IP.';
COMMENT ON COLUMN orders.is_guest_order IS
  'True when the order was placed via the chat bot without an authenticated session.';

-- Index so staff/admin queries on suspect IPs are fast.
CREATE INDEX IF NOT EXISTS idx_orders_client_ip_hash ON orders (client_ip_hash)
  WHERE client_ip_hash IS NOT NULL;
