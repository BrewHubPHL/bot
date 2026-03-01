BEGIN;

-- 1. Merch & Inventory Consolidation
DROP TABLE IF EXISTS public.merch_inventory CASCADE;

-- 2. Staff Status "View-ification"
ALTER TABLE staff_directory RENAME COLUMN is_working TO is_working_legacy;

CREATE OR REPLACE VIEW v_staff_status WITH (security_invoker = false) AS
SELECT sd.*, 
  EXISTS (
    SELECT 1 FROM time_logs tl
    WHERE tl.employee_email = lower(sd.email) AND tl.clock_out IS NULL AND tl.action_type = 'in'
  ) AS is_working
FROM staff_directory sd;

GRANT SELECT ON v_staff_status TO service_role;

-- 3. Unified Pickup View
CREATE OR REPLACE VIEW v_items_to_pickup WITH (security_invoker = false) AS
SELECT
  o.id::text AS item_id, 'cafe_order'::text AS item_type, COALESCE(o.customer_name, 'Guest') AS display_name,
  o.status AS current_status, o.created_at AS ready_since
FROM orders o WHERE o.status IN ('ready', 'completed') AND o.created_at > now() - interval '24 hours'
UNION ALL
SELECT
  p.id::text AS item_id, 'inbound_parcel'::text AS item_type,
  CASE WHEN p.recipient_name IS NULL OR trim(p.recipient_name) = '' THEN 'Resident' ELSE upper(left(trim(p.recipient_name), 1)) || '.' END AS display_name,
  p.status AS current_status, COALESCE(p.received_at, now()) AS ready_since
FROM parcels p WHERE p.status = 'arrived'
UNION ALL
SELECT
  op.id::text AS item_id, 'outbound_parcel'::text AS item_type,
  CASE WHEN op.customer_name IS NULL OR trim(op.customer_name) = '' THEN 'Resident' ELSE upper(left(trim(op.customer_name), 1)) || '.' END AS display_name,
  op.status AS current_status, COALESCE(op.received_at, op.created_at) AS ready_since
FROM outbound_parcels op WHERE op.status IN ('received', 'label_created', 'awaiting_pickup');

GRANT SELECT ON v_items_to_pickup TO anon, authenticated, service_role;

COMMIT;
