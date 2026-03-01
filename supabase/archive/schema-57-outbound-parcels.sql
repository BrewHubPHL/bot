-- ============================================================
-- SCHEMA 57: Outbound Parcels — FedEx Drop-Off Flow
-- Date: 2026-02-25
-- ============================================================
-- Adds:
--   1. outbound_parcels table for resident drop-off shipping
--   2. Widens merch_products category CHECK to include 'shipping'
--   3. Updates parcel_departure_board VIEW to include outbound
--      packages with "Awaiting Pickup" status
--   4. RLS policies for outbound_parcels
-- ============================================================

BEGIN;

-- ── 1. outbound_parcels table ────────────────────────────────────
-- Tracks packages dropped off by residents for outbound shipping
-- (e.g., FedEx, UPS). Staff scans or enters tracking number after
-- generating label via carrier portal.
CREATE TABLE IF NOT EXISTS outbound_parcels (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Who is shipping it
  customer_name   text NOT NULL,
  customer_email  text,
  customer_phone  text,
  unit_number     text,
  -- Package details
  carrier         text NOT NULL DEFAULT 'FedEx',
  tracking_number text,
  description     text,                       -- e.g. "Medium box — electronics"
  -- Pricing
  quoted_price_cents int,                     -- Price quoted/charged to customer
  order_id        uuid REFERENCES orders(id), -- Link to POS order for payment
  -- Lifecycle
  status          text NOT NULL DEFAULT 'received',
  received_at     timestamptz NOT NULL DEFAULT now(),
  label_created_at timestamptz,
  picked_up_at    timestamptz,                -- Carrier collected it
  -- Staff tracking
  received_by     uuid,                       -- Staff user who checked it in
  notes           text,
  -- Timestamps
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- Constrain status to known lifecycle values
ALTER TABLE outbound_parcels
  ADD CONSTRAINT outbound_parcels_status_check
  CHECK (status IN ('received', 'label_created', 'awaiting_pickup', 'picked_up', 'in_transit', 'delivered', 'cancelled'));

-- Indexes
CREATE INDEX IF NOT EXISTS idx_outbound_parcels_status
  ON outbound_parcels (status);
CREATE INDEX IF NOT EXISTS idx_outbound_parcels_received_at
  ON outbound_parcels (received_at DESC);
CREATE INDEX IF NOT EXISTS idx_outbound_parcels_tracking
  ON outbound_parcels (tracking_number) WHERE tracking_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_outbound_parcels_order_id
  ON outbound_parcels (order_id) WHERE order_id IS NOT NULL;

-- ── 2. RLS on outbound_parcels ───────────────────────────────────
ALTER TABLE outbound_parcels ENABLE ROW LEVEL SECURITY;

-- Deny public access by default
CREATE POLICY "Deny public access to outbound_parcels"
  ON outbound_parcels FOR ALL USING (false);

-- Staff can read all outbound parcels
CREATE POLICY "Staff can read outbound_parcels"
  ON outbound_parcels FOR SELECT
  USING (
    auth.role() = 'authenticated'
    AND EXISTS (
      SELECT 1 FROM staff_directory
      WHERE lower(staff_directory.email) = lower(auth.email())
    )
  );

-- Staff can insert outbound parcels
CREATE POLICY "Staff can insert outbound_parcels"
  ON outbound_parcels FOR INSERT
  WITH CHECK (
    auth.role() = 'authenticated'
    AND EXISTS (
      SELECT 1 FROM staff_directory
      WHERE lower(staff_directory.email) = lower(auth.email())
    )
  );

-- Staff can update outbound parcels
CREATE POLICY "Staff can update outbound_parcels"
  ON outbound_parcels FOR UPDATE
  USING (
    auth.role() = 'authenticated'
    AND EXISTS (
      SELECT 1 FROM staff_directory
      WHERE lower(staff_directory.email) = lower(auth.email())
    )
  );

-- Residents can read their own outbound parcels by email
CREATE POLICY "Resident can read own outbound_parcels"
  ON outbound_parcels FOR SELECT
  USING (
    auth.role() = 'authenticated'
    AND customer_email = (SELECT email FROM auth.users WHERE id = auth.uid())
  );

-- ── 3. Widen merch_products category constraint ──────────────────
-- Add 'shipping' as a valid category for open-price shipping items
ALTER TABLE merch_products DROP CONSTRAINT IF EXISTS merch_products_category_check;
ALTER TABLE merch_products
  ADD CONSTRAINT merch_products_category_check
  CHECK (category IN ('menu', 'merch', 'shipping'));

-- ── 4. Update parcel_departure_board VIEW ────────────────────────
-- Now includes both inbound (arrived) and outbound (awaiting pickup)
-- parcels so the lobby Smart TV board shows everything in one place.
DROP VIEW IF EXISTS parcel_departure_board;

CREATE VIEW parcel_departure_board
  WITH (security_invoker = false)
AS
-- Inbound parcels (arrived, awaiting resident pickup)
SELECT
  right(id::text, 4)                         AS id,
  CASE
    WHEN recipient_name IS NULL OR trim(recipient_name) = '' THEN 'Resident'
    ELSE upper(left(trim(recipient_name), 1)) || '.'
  END                                        AS masked_name,
  COALESCE(carrier, 'PKG') || ' …' || right(tracking_number, 4)
                                             AS masked_tracking,
  CASE
    WHEN carrier ILIKE '%ups%'                   THEN 'UPS'
    WHEN carrier ILIKE '%fedex%' OR carrier ILIKE '%fed%' THEN 'FedEx'
    WHEN carrier ILIKE '%usps%' OR carrier ILIKE '%postal%' THEN 'USPS'
    WHEN carrier ILIKE '%amazon%' OR carrier ILIKE '%amzl%' THEN 'Amazon'
    WHEN carrier ILIKE '%dhl%'                   THEN 'DHL'
    ELSE 'Other'
  END                                        AS carrier,
  received_at + (
    (('x' || left(md5(id::text || 'jitter_salt_2026'), 8))::bit(32)::int % 360 - 180)
    * interval '1 second'
  )                                          AS received_at,
  'inbound'::text                            AS direction,
  'ARRIVED'::text                            AS board_status
FROM parcels
WHERE status = 'arrived'

UNION ALL

-- Outbound parcels (awaiting carrier pickup)
SELECT
  right(id::text, 4)                         AS id,
  CASE
    WHEN customer_name IS NULL OR trim(customer_name) = '' THEN 'Resident'
    ELSE upper(left(trim(customer_name), 1)) || '.'
  END                                        AS masked_name,
  CASE
    WHEN tracking_number IS NOT NULL THEN
      COALESCE(carrier, 'PKG') || ' …' || right(tracking_number, 4)
    ELSE
      COALESCE(carrier, 'PKG') || ' PENDING'
  END                                        AS masked_tracking,
  CASE
    WHEN carrier ILIKE '%ups%'                   THEN 'UPS'
    WHEN carrier ILIKE '%fedex%' OR carrier ILIKE '%fed%' THEN 'FedEx'
    WHEN carrier ILIKE '%usps%' OR carrier ILIKE '%postal%' THEN 'USPS'
    WHEN carrier ILIKE '%dhl%'                   THEN 'DHL'
    ELSE 'Other'
  END                                        AS carrier,
  received_at + (
    (('x' || left(md5(id::text || 'jitter_salt_2026'), 8))::bit(32)::int % 360 - 180)
    * interval '1 second'
  )                                          AS received_at,
  'outbound'::text                           AS direction,
  CASE
    WHEN status = 'received'         THEN 'PROCESSING'
    WHEN status = 'label_created'    THEN 'LABELED'
    WHEN status = 'awaiting_pickup'  THEN 'AWAITING PICKUP'
    WHEN status = 'picked_up'        THEN 'PICKED UP'
    ELSE upper(status)
  END::text                                  AS board_status
FROM outbound_parcels
WHERE status IN ('received', 'label_created', 'awaiting_pickup');

-- Re-grant (VIEW replacement drops grants)
GRANT SELECT ON parcel_departure_board TO anon, authenticated;

-- ── 5. updated_at trigger for outbound_parcels ───────────────────
CREATE OR REPLACE FUNCTION update_outbound_parcels_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_outbound_parcels_updated_at ON outbound_parcels;
CREATE TRIGGER trg_outbound_parcels_updated_at
  BEFORE UPDATE ON outbound_parcels
  FOR EACH ROW EXECUTE FUNCTION update_outbound_parcels_updated_at();

COMMIT;
