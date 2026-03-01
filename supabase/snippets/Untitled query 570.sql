BEGIN;

-- 1. DROP DEPENDENCIES
-- Ensure we start with a clean slate for these views
DROP VIEW IF EXISTS v_staff_status CASCADE;
DROP VIEW IF EXISTS v_items_to_pickup CASCADE;

-- 2. IDEMPOTENT RENAME
-- This block handles the case where is_working might still exist or is already renamed
DO $$ 
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns 
             WHERE table_name='staff_directory' AND column_name='is_working') THEN
    ALTER TABLE public.staff_directory RENAME COLUMN is_working TO is_working_legacy;
  END IF;
END $$;

-- 3. STAFF STATUS VIEW
-- Dynamically calculates if a staff member is working based on time_logs
CREATE OR REPLACE VIEW v_staff_status WITH (security_invoker = false) AS
SELECT sd.*, 
  EXISTS (
    SELECT 1 FROM time_logs tl
    WHERE tl.employee_email = lower(sd.email) 
    AND tl.clock_out IS NULL 
    AND tl.action_type = 'in'
  ) AS is_working
FROM public.staff_directory sd;

GRANT SELECT ON v_staff_status TO anon, authenticated, service_role;

-- 4. UNIFIED PICKUP VIEW
-- Blends Cafe Orders and Inbound Parcels using correct snapshot column names
CREATE OR REPLACE VIEW v_items_to_pickup WITH (security_invoker = false) AS
SELECT
  o.id::text AS item_id, 
  'cafe_order'::text AS item_type, 
  COALESCE(o.customer_name, 'Guest') AS display_name,
  o.status AS current_status, 
  o.created_at AS ready_since
FROM orders o 
WHERE o.status IN ('ready', 'completed')
UNION ALL
SELECT
  p.id::text AS item_id, 
  'inbound_parcel'::text AS item_type, 
  COALESCE(p.recipient_name, 'Resident') AS display_name, 
  p.status AS current_status, 
  p.received_at AS ready_since -- Corrected from created_at
FROM parcels p 
WHERE p.status = 'received' OR p.status = 'arrived';

GRANT SELECT ON v_items_to_pickup TO anon, authenticated, service_role;

COMMIT;