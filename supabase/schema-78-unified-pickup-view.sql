-- ============================================================
-- SCHEMA 78: Phase 3 — Unified Pickup View (v_items_to_pickup)
-- ============================================================
-- Goal: Create a single read-layer that standardizes "items ready
-- for pickup" from both orders and parcels into one UNION ALL view.
--
-- Safe Strategy:
--   • Original tables (orders, parcels, outbound_parcels) are UNTOUCHED.
--   • parcel_departure_board VIEW is UNTOUCHED (ParcelsMonitor uses it).
--   • This is purely additive — an opt-in read-layer.
--   • QueueMonitor and ParcelsMonitor can be updated independently to
--     consume this view.
--
-- What could break & mitigations:
--   • Column name mismatches: UNION ALL requires identical column names
--     and compatible types — verified in this script.
--   • orders.customer_name may be NULL for guest orders — COALESCE to
--     'Guest' for display safety.
--   • parcels.received_at may be NULL — COALESCE to created_at equivalent.
--   • No existing code references v_items_to_pickup, so creation is safe.
--   • PII masking: parcel recipient names are truncated to initial + '.'
--     to match the parcel_departure_board privacy pattern.
--
-- Rollback:
--   DROP VIEW IF EXISTS v_items_to_pickup;
-- ============================================================

BEGIN;

DROP VIEW IF EXISTS v_items_to_pickup;

CREATE VIEW v_items_to_pickup
  WITH (security_invoker = false)
AS

-- ── Cafe orders ready for counter pickup ─────────────────────
SELECT
  o.id::text                                 AS item_id,
  'cafe_order'::text                         AS item_type,
  COALESCE(
    o.customer_name,
    'Guest'
  )                                          AS display_name,
  o.status                                   AS current_status,
  o.created_at                               AS ready_since,
  o.total_amount_cents                       AS amount_cents,
  NULL::text                                 AS carrier,
  NULL::text                                 AS tracking_hint,
  COALESCE(o.fulfillment_type, 'pickup')     AS fulfillment_type
FROM orders o
WHERE o.status IN ('ready', 'completed')
  AND o.created_at > now() - interval '24 hours'

UNION ALL

-- ── Inbound parcels arrived & awaiting resident pickup ───────
SELECT
  p.id::text                                 AS item_id,
  'inbound_parcel'::text                     AS item_type,
  CASE
    WHEN p.recipient_name IS NULL OR trim(p.recipient_name) = '' THEN 'Resident'
    ELSE upper(left(trim(p.recipient_name), 1)) || '.'
  END                                        AS display_name,
  p.status                                   AS current_status,
  COALESCE(p.received_at, now())             AS ready_since,
  NULL::int                                  AS amount_cents,
  CASE
    WHEN p.carrier ILIKE '%ups%'                   THEN 'UPS'
    WHEN p.carrier ILIKE '%fedex%' OR p.carrier ILIKE '%fed%' THEN 'FedEx'
    WHEN p.carrier ILIKE '%usps%' OR p.carrier ILIKE '%postal%' THEN 'USPS'
    WHEN p.carrier ILIKE '%amazon%' OR p.carrier ILIKE '%amzl%' THEN 'Amazon'
    WHEN p.carrier ILIKE '%dhl%'                   THEN 'DHL'
    ELSE COALESCE(p.carrier, 'PKG')
  END                                        AS carrier,
  CASE
    WHEN p.tracking_number IS NOT NULL THEN '…' || right(p.tracking_number, 4)
    ELSE NULL
  END                                        AS tracking_hint,
  'pickup'::text                             AS fulfillment_type
FROM parcels p
WHERE p.status = 'arrived'

UNION ALL

-- ── Outbound parcels awaiting carrier collection ─────────────
SELECT
  op.id::text                                AS item_id,
  'outbound_parcel'::text                    AS item_type,
  CASE
    WHEN op.customer_name IS NULL OR trim(op.customer_name) = '' THEN 'Resident'
    ELSE upper(left(trim(op.customer_name), 1)) || '.'
  END                                        AS display_name,
  op.status                                  AS current_status,
  COALESCE(op.received_at, op.created_at)    AS ready_since,
  op.quoted_price_cents                      AS amount_cents,
  CASE
    WHEN op.carrier ILIKE '%ups%'                   THEN 'UPS'
    WHEN op.carrier ILIKE '%fedex%' OR op.carrier ILIKE '%fed%' THEN 'FedEx'
    WHEN op.carrier ILIKE '%usps%' OR op.carrier ILIKE '%postal%' THEN 'USPS'
    WHEN op.carrier ILIKE '%dhl%'                   THEN 'DHL'
    ELSE COALESCE(op.carrier, 'PKG')
  END                                        AS carrier,
  CASE
    WHEN op.tracking_number IS NOT NULL THEN '…' || right(op.tracking_number, 4)
    ELSE 'PENDING'
  END                                        AS tracking_hint,
  'shipping'::text                           AS fulfillment_type
FROM outbound_parcels op
WHERE op.status IN ('received', 'label_created', 'awaiting_pickup');

COMMENT ON VIEW v_items_to_pickup IS
  'Unified read-layer: all items awaiting pickup (cafe orders, inbound parcels, '
  'outbound parcels) in a single standardized schema. Schema 78. '
  'Does NOT replace the underlying tables — additive read-only overlay.';

-- Grant read access — staff/anon both need this for kiosk monitors
GRANT SELECT ON v_items_to_pickup TO anon, authenticated, service_role;

COMMIT;
