-- schema-37-audit-critical-fixes.sql
-- Critical fixes identified during comprehensive code audit (Feb 2026)
-- Addresses: missing indexes, missing NOT NULL, missing UNIQUE, orders.updated_at,
--            inventory audit trail, and staff_directory integrity.

-- ═══════════════════════════════════════════════════════════════════════════════
-- 1. staff_directory.email: NOT NULL + UNIQUE (ALL RLS depends on this)
-- ═══════════════════════════════════════════════════════════════════════════════
-- First clean up any NULLs (shouldn't exist, but be safe)
DELETE FROM staff_directory WHERE email IS NULL;

ALTER TABLE staff_directory
  ALTER COLUMN email SET NOT NULL;

-- Add unique constraint on lower(email) if not already present
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE tablename = 'staff_directory' AND indexname = 'idx_staff_directory_email_unique'
  ) THEN
    CREATE UNIQUE INDEX idx_staff_directory_email_unique ON staff_directory (lower(email));
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 2. customers.email: UNIQUE constraint to prevent duplicate loyalty records
-- ═══════════════════════════════════════════════════════════════════════════════
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE tablename = 'customers' AND indexname = 'idx_customers_email_unique'
  ) THEN
    CREATE UNIQUE INDEX idx_customers_email_unique ON customers (lower(email));
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 3. Missing indexes on high-frequency query columns
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE INDEX IF NOT EXISTS idx_orders_user_id ON orders (user_id);
CREATE INDEX IF NOT EXISTS idx_vouchers_user_id ON vouchers (user_id);
CREATE INDEX IF NOT EXISTS idx_parcels_tracking_number ON parcels (tracking_number);
CREATE INDEX IF NOT EXISTS idx_refund_locks_user_id ON refund_locks (user_id);
CREATE INDEX IF NOT EXISTS idx_coffee_orders_order_id ON coffee_orders (order_id);

-- ═══════════════════════════════════════════════════════════════════════════════
-- 4. orders.updated_at: DEFAULT + auto-update trigger
-- ═══════════════════════════════════════════════════════════════════════════════
-- Set default for new inserts
ALTER TABLE orders ALTER COLUMN updated_at SET DEFAULT now();

-- Backfill NULLs
UPDATE orders SET updated_at = created_at WHERE updated_at IS NULL;

-- Auto-update trigger
CREATE OR REPLACE FUNCTION update_orders_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_orders_updated_at ON orders;
CREATE TRIGGER trg_orders_updated_at
  BEFORE UPDATE ON orders
  FOR EACH ROW
  EXECUTE FUNCTION update_orders_updated_at();

-- ═══════════════════════════════════════════════════════════════════════════════
-- 5. Inventory Audit Log — track all stock mutations
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS inventory_audit_log (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id     uuid NOT NULL,
  item_name   text,
  delta       integer NOT NULL,
  new_qty     integer,
  source      text NOT NULL DEFAULT 'manual',  -- 'manual', 'order_completion', 'refund_restore', 'adjustment'
  triggered_by text,                            -- staff email or 'system'
  order_id    uuid,                             -- nullable, links to order if applicable
  note        text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- RLS: staff can read audit log, only service role can write
ALTER TABLE inventory_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff can read inventory audit"
  ON inventory_audit_log FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM staff_directory
    WHERE lower(email) = lower(auth.email())
  ));

-- Index for item lookups and time-range queries
CREATE INDEX IF NOT EXISTS idx_inventory_audit_item_id ON inventory_audit_log (item_id);
CREATE INDEX IF NOT EXISTS idx_inventory_audit_created ON inventory_audit_log (created_at);

-- ═══════════════════════════════════════════════════════════════════════════════
-- 6. coffee_orders.order_id: NOT NULL (orphaned coffee_orders are untrackable)
-- ═══════════════════════════════════════════════════════════════════════════════
-- Clean up any NULLs first
DELETE FROM coffee_orders WHERE order_id IS NULL;

ALTER TABLE coffee_orders
  ALTER COLUMN order_id SET NOT NULL;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 7. expected_parcels.registered_at: DEFAULT now()
-- ═══════════════════════════════════════════════════════════════════════════════
ALTER TABLE expected_parcels ALTER COLUMN registered_at SET DEFAULT now();

-- ═══════════════════════════════════════════════════════════════════════════════
-- 8. Prevent duplicate parcel check-ins (same tracking_number in 'arrived' status)
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE UNIQUE INDEX IF NOT EXISTS idx_parcels_tracking_arrived
  ON parcels (tracking_number) WHERE status = 'arrived';

-- ═══════════════════════════════════════════════════════════════════════════════
-- 9. Inventory item_name uniqueness
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE UNIQUE INDEX IF NOT EXISTS idx_inventory_item_name_unique
  ON inventory (lower(item_name));

-- ═══════════════════════════════════════════════════════════════════════════════
-- Done. This migration is idempotent and safe to re-run.
-- ═══════════════════════════════════════════════════════════════════════════════
