-- ============================================================
-- SCHEMA 9: Staff Quality of Life — Receipts & Order Timing
-- ============================================================

-- 1. Add completed_at timestamp to orders for speed tracking
ALTER TABLE orders ADD COLUMN IF NOT EXISTS completed_at timestamptz;

-- Index for analytics queries (e.g., avg completion time per day)
CREATE INDEX IF NOT EXISTS idx_orders_completed_at ON orders(completed_at DESC);

-- 2. Virtual receipt print queue
-- Allows receipt generation without physical hardware.
-- Consumers poll: SELECT receipt_text FROM receipt_queue WHERE printed = false
CREATE TABLE IF NOT EXISTS receipt_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid REFERENCES orders(id) ON DELETE CASCADE,
  receipt_text text NOT NULL,
  printed boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_receipt_queue_pending ON receipt_queue(printed) WHERE printed = false;

-- RLS: Lock down receipt_queue (server writes via service_role, staff reads for dashboard)
ALTER TABLE receipt_queue ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Deny public access to receipt_queue" ON receipt_queue;
CREATE POLICY "Deny public access to receipt_queue" ON receipt_queue FOR ALL USING (false);

-- Allow authenticated staff to SELECT receipts (needed for manager dashboard + Realtime)
DROP POLICY IF EXISTS "Staff can read receipts" ON receipt_queue;
CREATE POLICY "Staff can read receipts" ON receipt_queue
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM staff_directory
      WHERE lower(email) = lower(auth.email())
    )
  );
