BEGIN;

-- 1. Merch & Inventory Consolidation
DROP TABLE IF EXISTS public.merch_inventory CASCADE;

-- 2. Staff Status "View-ification"
--    (is_working was already renamed to is_working_legacy in schema-77;
--     guard makes this idempotent if re-run or if schema-77 was applied first)
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'staff_directory' AND column_name = 'is_working'
  ) THEN
    ALTER TABLE staff_directory RENAME COLUMN is_working TO is_working_legacy;
  END IF;
END $$;

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

-- 4. Token Versioning — wire verify_staff_pin to return token_version
--    so pin-login.js can embed it in the HMAC token and _auth.js can
--    do an O(1) integer comparison on every request.
--    Must DROP first because the return type (OUT params) changed.
DROP FUNCTION IF EXISTS verify_staff_pin(text);
CREATE OR REPLACE FUNCTION verify_staff_pin(p_pin text)
RETURNS TABLE(
  staff_id           uuid,
  staff_name         text,
  full_name          text,
  staff_email        text,
  staff_role         text,
  is_working         boolean,
  needs_pin_rotation boolean,
  token_version      integer
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    sd.id,
    sd.name,
    sd.full_name,
    sd.email,
    sd.role,
    EXISTS (
      SELECT 1 FROM time_logs tl
      WHERE tl.employee_email = lower(sd.email)
        AND tl.clock_out IS NULL
        AND tl.action_type = 'in'
    ) AS is_working,
    CASE
      WHEN sd.pin_rotation_days = 0 THEN false
      WHEN sd.pin_changed_at IS NULL THEN true
      ELSE EXTRACT(DAY FROM now() - sd.pin_changed_at)::int > sd.pin_rotation_days
    END AS needs_pin_rotation,
    sd.token_version
  FROM staff_directory sd
  WHERE sd.pin_hash IS NOT NULL
    AND sd.is_active = true
    AND sd.pin_hash = crypt(p_pin, sd.pin_hash);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

REVOKE EXECUTE ON FUNCTION verify_staff_pin(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION verify_staff_pin(text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION verify_staff_pin(text) TO service_role;

COMMIT;
