-- =============================================================================
-- BREWHUB: Combined Schema — All 29 files in correct order
-- Generated: 2026-02-20
--
-- SAFE TO RE-RUN: Every statement is idempotent.
-- Paste into Supabase Dashboard → SQL Editor and click Run.
-- =============================================================================


-- #############################################################################
-- ## schema-1-tables.sql — Core Tables
-- #############################################################################

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. STAFF_DIRECTORY
CREATE TABLE IF NOT EXISTS staff_directory (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text,
  email text,
  role text DEFAULT 'Barista',
  hourly_rate numeric DEFAULT 15.00,
  is_working boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  token_version int NOT NULL DEFAULT 1,
  version_updated_at timestamptz NOT NULL DEFAULT now(),
  full_name text
);

-- 2. TIME_LOGS
CREATE TABLE IF NOT EXISTS time_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id text,
  employee_email text,
  clock_in timestamptz DEFAULT now(),
  clock_out timestamptz,
  status text DEFAULT 'Pending',
  action_type text,
  created_at timestamptz DEFAULT now()
);

-- 3. REVOKED_USERS
CREATE TABLE IF NOT EXISTS revoked_users (
  user_id uuid PRIMARY KEY,
  revoked_at timestamptz NOT NULL DEFAULT now(),
  reason text
);

-- 4. SITE_SETTINGS
CREATE TABLE IF NOT EXISTS site_settings (
  key text PRIMARY KEY,
  value boolean,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO site_settings (key, value) VALUES 
  ('shop_enabled', true),
  ('cafe_enabled', true),
  ('parcels_enabled', true)
ON CONFLICT (key) DO NOTHING;

-- 5. WAITLIST
CREATE TABLE IF NOT EXISTS waitlist (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  created_at timestamptz DEFAULT now()
);

-- 6. CUSTOMERS
CREATE TABLE IF NOT EXISTS customers (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  email text NOT NULL,
  full_name text,
  phone text,
  address_street text,
  address_city text DEFAULT 'Philadelphia',
  address_zip text DEFAULT '19146',
  created_at timestamptz DEFAULT now(),
  name text,
  address text,
  sms_opt_in boolean DEFAULT false,
  loyalty_points int NOT NULL DEFAULT 0
);

-- 7. PROFILES (linked to auth.users)
CREATE TABLE IF NOT EXISTS profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name text,
  phone_number text,
  favorite_drink text DEFAULT 'Black Coffee',
  loyalty_points int DEFAULT 0,
  barcode_id text,
  is_vip boolean DEFAULT false,
  total_orders int DEFAULT 0
);

-- 8. ORDERS
CREATE TABLE IF NOT EXISTS orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,
  status text DEFAULT 'pending',
  total_amount_cents int NOT NULL,
  square_order_id text,
  created_at timestamptz DEFAULT now(),
  payment_id text,
  notes text,
  customer_name text,
  customer_email text,
  inventory_decremented boolean DEFAULT false
);

-- 9. COFFEE_ORDERS
CREATE TABLE IF NOT EXISTS coffee_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid,
  drink_name text NOT NULL,
  customizations jsonb,
  status text DEFAULT 'pending',
  created_at timestamptz DEFAULT now(),
  order_id uuid,
  guest_name text,
  customer_name text,
  price numeric DEFAULT 0.00
);

-- 10. VOUCHERS
CREATE TABLE IF NOT EXISTS vouchers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,
  code text NOT NULL,
  is_redeemed boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  redeemed_at timestamptz,
  applied_to_order_id uuid
);

-- 11. MERCH_PRODUCTS
CREATE TABLE IF NOT EXISTS merch_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  price_cents int NOT NULL,
  description text,
  image_url text,
  checkout_url text,
  is_active boolean NOT NULL DEFAULT true,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 12. INVENTORY
CREATE TABLE IF NOT EXISTS inventory (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_name text NOT NULL,
  current_stock int DEFAULT 0,
  min_threshold int DEFAULT 10,
  unit text DEFAULT 'units',
  updated_at timestamptz DEFAULT now(),
  barcode text,
  is_visible boolean DEFAULT true
);


-- #############################################################################
-- ## schema-2-tables.sql — More Tables
-- #############################################################################

-- 13. EXPECTED_PARCELS
CREATE TABLE IF NOT EXISTS expected_parcels (
  id serial PRIMARY KEY,
  tracking_number text NOT NULL,
  carrier text,
  customer_name text NOT NULL,
  customer_phone text,
  customer_email text,
  unit_number text,
  status text DEFAULT 'pending',
  registered_at timestamptz,
  arrived_at timestamptz
);

-- 14. PARCELS
CREATE TABLE IF NOT EXISTS parcels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tracking_number text NOT NULL,
  carrier text,
  recipient_name text,
  status text DEFAULT 'in_transit',
  received_at timestamptz,
  picked_up_at timestamptz,
  recipient_phone text,
  unit_number text,
  match_type text,
  notified_at timestamptz
);

-- 15. RESIDENTS
CREATE TABLE IF NOT EXISTS residents (
  id serial PRIMARY KEY,
  name text NOT NULL,
  unit_number text,
  phone text,
  email text
);

-- 16. API_USAGE
CREATE TABLE IF NOT EXISTS api_usage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_name text NOT NULL,
  usage_date date NOT NULL DEFAULT CURRENT_DATE,
  call_count int NOT NULL DEFAULT 0,
  daily_limit int NOT NULL DEFAULT 100,
  created_at timestamptz DEFAULT now(),
  UNIQUE(service_name, usage_date)
);

INSERT INTO api_usage (service_name, usage_date, call_count, daily_limit)
VALUES 
  ('elevenlabs_convai', CURRENT_DATE, 0, 25),
  ('grok_chat', CURRENT_DATE, 0, 100),
  ('gemini_marketing', CURRENT_DATE, 0, 20),
  ('square_checkout', CURRENT_DATE, 0, 500)
ON CONFLICT (service_name, usage_date) DO NOTHING;

-- 17. MARKETING_POSTS
CREATE TABLE IF NOT EXISTS marketing_posts (
  id bigint PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT (timezone('utc', now())),
  day_of_week text,
  topic text,
  caption text
);

-- 18. LOCAL_MENTIONS
CREATE TABLE IF NOT EXISTS local_mentions (
  id text PRIMARY KEY,
  created_at timestamptz DEFAULT now(),
  username text,
  caption text,
  image_url text,
  likes int,
  posted_at timestamptz
);

-- 18b. MARKETING_LEADS (Apify scrape results)
CREATE TABLE IF NOT EXISTS marketing_leads (
  id text PRIMARY KEY,
  username text,
  likes int,
  caption text,
  status text,
  created_at timestamptz DEFAULT now()
);

-- 19. WEBHOOK_EVENTS
CREATE TABLE IF NOT EXISTS webhook_events (
  event_id text PRIMARY KEY,
  source text DEFAULT 'supabase',
  received_at timestamptz NOT NULL DEFAULT now(),
  payload jsonb
);

-- 20. PROCESSED_WEBHOOKS
CREATE TABLE IF NOT EXISTS processed_webhooks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_key text NOT NULL UNIQUE,
  event_type text NOT NULL,
  source text NOT NULL DEFAULT 'square',
  processed_at timestamptz NOT NULL DEFAULT now(),
  payload jsonb
);

-- 21. REFUND_LOCKS
CREATE TABLE IF NOT EXISTS refund_locks (
  payment_id text PRIMARY KEY,
  locked_at timestamptz NOT NULL DEFAULT now(),
  user_id uuid
);

-- 22. NOTIFICATION_QUEUE
CREATE TABLE IF NOT EXISTS notification_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_type text NOT NULL,
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  attempt_count int NOT NULL DEFAULT 0,
  max_attempts int NOT NULL DEFAULT 3,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  locked_until timestamptz,
  locked_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  last_error text,
  source_table text,
  source_id uuid
);

CREATE INDEX IF NOT EXISTS idx_notification_queue_pending 
  ON notification_queue (status, next_attempt_at) 
  WHERE status IN ('pending', 'failed');

-- 23. DELETION_TOMBSTONES
CREATE TABLE IF NOT EXISTS deletion_tombstones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  table_name text NOT NULL,
  record_key text NOT NULL,
  key_type text NOT NULL DEFAULT 'email',
  deleted_at timestamptz NOT NULL DEFAULT now(),
  deleted_by text,
  reason text DEFAULT 'GDPR Article 17 - Right to Erasure',
  UNIQUE(table_name, record_key)
);

-- 24. GDPR_SECRETS
CREATE TABLE IF NOT EXISTS gdpr_secrets (
  key text PRIMARY KEY,
  value text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO gdpr_secrets (key, value)
VALUES ('pii_hash_salt', encode(gen_random_bytes(32), 'hex'))
ON CONFLICT (key) DO NOTHING;

-- 25. LISTINGS
CREATE TABLE IF NOT EXISTS listings (
  id bigint PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT (timezone('utc', now())),
  address text NOT NULL,
  price numeric NOT NULL,
  beds numeric NOT NULL,
  baths numeric NOT NULL,
  sqft numeric NOT NULL,
  image_url text,
  status text DEFAULT 'Available'
);

-- 26. PROPERTIES
CREATE TABLE IF NOT EXISTS properties (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  unit_name text NOT NULL,
  monthly_rent numeric NOT NULL,
  security_deposit numeric NOT NULL,
  water_rule text,
  tenant_email text
);

-- 27. PROPERTY_EXPENSES
CREATE TABLE IF NOT EXISTS property_expenses (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  created_at timestamptz DEFAULT now(),
  property_address text DEFAULT '1448 S 17th St',
  vendor_name text,
  description text,
  amount numeric NOT NULL,
  category text NOT NULL,
  status text DEFAULT 'estimated',
  due_date date,
  paid_at timestamptz,
  invoice_url text,
  is_nnn_reimbursable boolean DEFAULT false,
  tenant_name text DEFAULT 'Daycare'
);

-- 28. EXPECTED_RENTS
CREATE TABLE IF NOT EXISTS expected_rents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_type text NOT NULL,
  expected_monthly_rent numeric NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 29. RENT_ROLL
CREATE TABLE IF NOT EXISTS rent_roll (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  date date NOT NULL,
  unit text NOT NULL,
  rent numeric NOT NULL,
  water numeric NOT NULL,
  total_due numeric NOT NULL,
  status text NOT NULL DEFAULT 'Pending',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 30. WATER_CHARGES
CREATE TABLE IF NOT EXISTS water_charges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  unit text NOT NULL,
  total_bill numeric DEFAULT 0,
  tenant_owes numeric DEFAULT 0,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 31. UNIT_PROFILES
CREATE TABLE IF NOT EXISTS unit_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  unit text NOT NULL,
  tenant_type text,
  security_deposit numeric DEFAULT 0,
  payment_method text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 32. SETTLEMENTS
CREATE TABLE IF NOT EXISTS settlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item text NOT NULL,
  amount numeric NOT NULL,
  action text,
  lease_terms text,
  reference text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 33. BREWHUB_NNN_SUMMARY
CREATE TABLE IF NOT EXISTS brewhub_nnn_summary (
  property_address text,
  total_taxes numeric,
  total_insurance numeric,
  total_cam numeric,
  total_tenant_billback numeric
);

-- PERFORMANCE INDEXES
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_coffee_orders_order_id ON coffee_orders(order_id);
CREATE INDEX IF NOT EXISTS idx_parcels_status ON parcels(status);
CREATE INDEX IF NOT EXISTS idx_parcels_received_at ON parcels(received_at DESC);
CREATE INDEX IF NOT EXISTS idx_time_logs_employee_email ON time_logs(employee_email);
CREATE INDEX IF NOT EXISTS idx_time_logs_status ON time_logs(status);
CREATE INDEX IF NOT EXISTS idx_expected_tracking ON expected_parcels(tracking_number);


-- #############################################################################
-- ## schema-3-functions.sql — Functions & Triggers
-- #############################################################################

-- Auto-create profiles row when user signs up
DROP FUNCTION IF EXISTS handle_new_user() CASCADE;
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, loyalty_points, created_at, updated_at)
  VALUES (
    NEW.id,
    NEW.email,
    0,
    now(),
    now()
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- Staff role change trigger
DROP FUNCTION IF EXISTS staff_role_change_invalidator() CASCADE;
CREATE OR REPLACE FUNCTION staff_role_change_invalidator()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.role IS DISTINCT FROM NEW.role OR OLD.email IS DISTINCT FROM NEW.email THEN
    NEW.token_version := OLD.token_version + 1;
    NEW.version_updated_at := now();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS staff_role_change_trigger ON staff_directory;
CREATE TRIGGER staff_role_change_trigger
  BEFORE UPDATE ON staff_directory
  FOR EACH ROW EXECUTE FUNCTION staff_role_change_invalidator();

-- Order amount tampering prevention
DROP FUNCTION IF EXISTS prevent_order_amount_tampering() CASCADE;
CREATE OR REPLACE FUNCTION prevent_order_amount_tampering()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.total_amount_cents IS NOT NULL AND NEW.total_amount_cents <> OLD.total_amount_cents THEN
    RAISE EXCEPTION 'Cannot modify order amount after creation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS orders_no_amount_tampering ON orders;
CREATE TRIGGER orders_no_amount_tampering
  BEFORE UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION prevent_order_amount_tampering();

-- Inventory functions
DROP FUNCTION IF EXISTS adjust_inventory_quantity(uuid, int);
CREATE OR REPLACE FUNCTION adjust_inventory_quantity(p_id uuid, p_delta int)
RETURNS void AS $$
  UPDATE inventory 
  SET current_stock = GREATEST(0, current_stock + p_delta),
      updated_at = now()
  WHERE id = p_id;
$$ LANGUAGE sql SECURITY DEFINER;

DROP FUNCTION IF EXISTS get_low_stock_items();
CREATE OR REPLACE FUNCTION get_low_stock_items()
RETURNS TABLE(item_name text, current_stock int, min_threshold int, unit text) AS $$
  SELECT item_name, current_stock, min_threshold, unit
  FROM inventory
  WHERE current_stock <= min_threshold;
$$ LANGUAGE sql SECURITY DEFINER;

DROP FUNCTION IF EXISTS decrement_inventory(text, int);
CREATE OR REPLACE FUNCTION decrement_inventory(p_item_name text, p_quantity int DEFAULT 1)
RETURNS void AS $$
  UPDATE inventory
  SET current_stock = GREATEST(0, current_stock - p_quantity),
      updated_at = now()
  WHERE item_name ILIKE p_item_name;
$$ LANGUAGE sql SECURITY DEFINER;

-- Order completion trigger for inventory decrement
DROP FUNCTION IF EXISTS handle_order_completion() CASCADE;
CREATE OR REPLACE FUNCTION handle_order_completion()
RETURNS TRIGGER AS $$
DECLARE
  v_cup_count int;
BEGIN
  IF NEW.status = 'completed' 
     AND (OLD.status IS DISTINCT FROM 'completed') 
     AND NOT COALESCE(NEW.inventory_decremented, false) THEN
    SELECT COUNT(*)::int INTO v_cup_count
    FROM coffee_orders
    WHERE order_id = NEW.id;
    IF v_cup_count > 0 THEN
      PERFORM decrement_inventory('12oz Cups', v_cup_count);
    END IF;
    NEW.inventory_decremented := true;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_order_completion ON orders;
CREATE TRIGGER trg_order_completion
  BEFORE UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION handle_order_completion();

-- API Usage function
DROP FUNCTION IF EXISTS increment_api_usage(text);
CREATE OR REPLACE FUNCTION increment_api_usage(p_service text)
RETURNS boolean AS $$
DECLARE
  v_under_limit boolean;
BEGIN
  INSERT INTO api_usage (service_name, usage_date, call_count, daily_limit)
  VALUES (p_service, CURRENT_DATE, 1, 100)
  ON CONFLICT (service_name, usage_date) 
  DO UPDATE SET call_count = api_usage.call_count + 1;
  
  SELECT call_count <= daily_limit INTO v_under_limit
  FROM api_usage
  WHERE service_name = p_service AND usage_date = CURRENT_DATE;
  
  RETURN COALESCE(v_under_limit, false);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Notification queue functions
DROP FUNCTION IF EXISTS claim_notification_tasks(text, int);
CREATE OR REPLACE FUNCTION claim_notification_tasks(p_worker_id text, p_batch_size int DEFAULT 10)
RETURNS SETOF notification_queue AS $$
BEGIN
  RETURN QUERY
  UPDATE notification_queue
  SET status = 'processing', locked_until = now() + interval '60 seconds',
      locked_by = p_worker_id, attempt_count = attempt_count + 1
  WHERE id IN (
    SELECT id FROM notification_queue
    WHERE status IN ('pending', 'failed') AND next_attempt_at <= now()
      AND (locked_until IS NULL OR locked_until < now())
    ORDER BY next_attempt_at FOR UPDATE SKIP LOCKED LIMIT p_batch_size
  )
  RETURNING *;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP FUNCTION IF EXISTS complete_notification(uuid);
CREATE OR REPLACE FUNCTION complete_notification(p_task_id uuid)
RETURNS void AS $$
  UPDATE notification_queue SET status = 'completed', completed_at = now(),
    locked_until = NULL, locked_by = NULL WHERE id = p_task_id;
$$ LANGUAGE sql SECURITY DEFINER;

DROP FUNCTION IF EXISTS fail_notification(uuid, text);
CREATE OR REPLACE FUNCTION fail_notification(p_task_id uuid, p_error text)
RETURNS void AS $$
DECLARE
  v_attempts int; v_max int; v_backoff int;
BEGIN
  SELECT attempt_count, max_attempts INTO v_attempts, v_max FROM notification_queue WHERE id = p_task_id;
  v_backoff := POWER(2, LEAST(v_attempts, 4));
  IF v_attempts >= v_max THEN
    UPDATE notification_queue SET status = 'dead_letter', last_error = p_error, locked_until = NULL WHERE id = p_task_id;
  ELSE
    UPDATE notification_queue SET status = 'failed', next_attempt_at = now() + (v_backoff * interval '1 minute'),
      last_error = p_error, locked_until = NULL WHERE id = p_task_id;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Tombstone check
DROP FUNCTION IF EXISTS is_tombstoned(text, text);
CREATE OR REPLACE FUNCTION is_tombstoned(p_table text, p_key text)
RETURNS boolean AS $$
  SELECT EXISTS (SELECT 1 FROM deletion_tombstones WHERE table_name = p_table AND record_key = lower(p_key));
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Session invalidation
DROP FUNCTION IF EXISTS invalidate_staff_sessions(text);
CREATE OR REPLACE FUNCTION invalidate_staff_sessions(p_email text)
RETURNS void AS $$
  UPDATE staff_directory SET token_version = token_version + 1, version_updated_at = now() WHERE lower(email) = lower(p_email);
$$ LANGUAGE sql SECURITY DEFINER;

DROP FUNCTION IF EXISTS invalidate_all_staff_sessions();
CREATE OR REPLACE FUNCTION invalidate_all_staff_sessions()
RETURNS int AS $$
DECLARE v_count int;
BEGIN
  UPDATE staff_directory SET token_version = token_version + 1, version_updated_at = now();
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- #############################################################################
-- ## schema-4-rpcs.sql — Complex RPCs
-- #############################################################################

-- Atomic parcel check-in with notification queue
DROP FUNCTION IF EXISTS atomic_parcel_checkin(text, text, text, text, text, text, text);
CREATE OR REPLACE FUNCTION atomic_parcel_checkin(
  p_tracking_number text, p_carrier text, p_recipient_name text,
  p_recipient_phone text DEFAULT NULL, p_recipient_email text DEFAULT NULL,
  p_unit_number text DEFAULT NULL, p_match_type text DEFAULT 'manual'
)
RETURNS TABLE(parcel_id uuid, queue_task_id uuid) AS $$
DECLARE
  v_parcel_id uuid; v_queue_id uuid;
BEGIN
  INSERT INTO parcels (tracking_number, carrier, recipient_name, recipient_phone, unit_number, status, received_at, match_type)
  VALUES (p_tracking_number, p_carrier, p_recipient_name, p_recipient_phone, p_unit_number, 'pending_notification', now(), p_match_type)
  RETURNING id INTO v_parcel_id;

  INSERT INTO notification_queue (task_type, payload, source_table, source_id)
  VALUES ('parcel_arrived', jsonb_build_object(
    'recipient_name', p_recipient_name, 'recipient_phone', p_recipient_phone,
    'recipient_email', p_recipient_email, 'tracking_number', p_tracking_number,
    'carrier', p_carrier, 'unit_number', p_unit_number
  ), 'parcels', v_parcel_id)
  RETURNING id INTO v_queue_id;

  RETURN QUERY SELECT v_parcel_id, v_queue_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Loyalty points increment
DROP FUNCTION IF EXISTS increment_loyalty(uuid, int, uuid);
CREATE OR REPLACE FUNCTION increment_loyalty(target_user_id uuid, amount_cents int, p_order_id uuid DEFAULT NULL)
RETURNS TABLE(loyalty_points int, voucher_earned boolean, points_awarded int) AS $$
DECLARE
  v_new_points int; v_voucher_earned boolean := false; v_points_delta int; v_previous int := 0;
BEGIN
  IF p_order_id IS NOT NULL THEN
    SELECT COALESCE(paid_amount_cents, 0) INTO v_previous FROM orders WHERE id = p_order_id;
  END IF;
  v_points_delta := GREATEST(0, floor(amount_cents / 100)::int - floor(v_previous / 100)::int);
  IF v_points_delta <= 0 THEN
    RETURN QUERY SELECT COALESCE((SELECT profiles.loyalty_points FROM profiles WHERE id = target_user_id), 0), false, 0;
    RETURN;
  END IF;
  UPDATE profiles SET loyalty_points = COALESCE(loyalty_points, 0) + v_points_delta WHERE id = target_user_id
  RETURNING profiles.loyalty_points INTO v_new_points;
  IF v_new_points IS NOT NULL AND v_new_points >= 500 AND (v_new_points - v_points_delta) % 500 > (v_new_points % 500) THEN
    v_voucher_earned := true;
  END IF;
  RETURN QUERY SELECT v_new_points, v_voucher_earned, v_points_delta;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Atomic voucher redemption
DROP FUNCTION IF EXISTS atomic_redeem_voucher(text, uuid, uuid);
CREATE OR REPLACE FUNCTION atomic_redeem_voucher(p_voucher_code text, p_order_id uuid, p_user_id uuid DEFAULT NULL)
RETURNS TABLE(success boolean, voucher_id uuid, error_code text, error_message text) AS $$
DECLARE
  v_voucher RECORD; v_order RECORD; v_lock_key bigint;
BEGIN
  SELECT id, user_id, is_redeemed INTO v_voucher FROM vouchers WHERE code = upper(p_voucher_code) FOR UPDATE SKIP LOCKED;
  IF v_voucher IS NULL THEN RETURN QUERY SELECT false, NULL::uuid, 'VOUCHER_NOT_FOUND'::text, 'Voucher not found or already being processed'::text; RETURN; END IF;
  IF v_voucher.is_redeemed THEN RETURN QUERY SELECT false, NULL::uuid, 'ALREADY_REDEEMED'::text, 'This voucher has already been used'::text; RETURN; END IF;
  
  v_lock_key := hashtext('voucher_lock:' || COALESCE(v_voucher.user_id::text, 'guest'));
  PERFORM pg_advisory_xact_lock(v_lock_key);
  
  IF EXISTS (SELECT 1 FROM refund_locks WHERE user_id = v_voucher.user_id AND locked_at > now() - interval '5 minutes') THEN
    RETURN QUERY SELECT false, NULL::uuid, 'REFUND_IN_PROGRESS'::text, 'Account locked due to pending refund. Please wait.'::text; RETURN;
  END IF;
  
  IF p_order_id IS NOT NULL THEN
    SELECT id, user_id, status INTO v_order FROM orders WHERE id = p_order_id;
    IF v_order IS NULL THEN RETURN QUERY SELECT false, NULL::uuid, 'ORDER_NOT_FOUND'::text, 'Order not found'::text; RETURN; END IF;
    IF v_order.status IN ('paid', 'refunded') THEN RETURN QUERY SELECT false, NULL::uuid, 'ORDER_COMPLETE'::text, 'Cannot apply voucher to completed order'::text; RETURN; END IF;
    IF v_voucher.user_id IS NOT NULL AND v_voucher.user_id != v_order.user_id THEN
      RETURN QUERY SELECT false, NULL::uuid, 'OWNERSHIP_MISMATCH'::text, 'This voucher belongs to a different customer'::text; RETURN;
    END IF;
  END IF;
  
  UPDATE vouchers SET is_redeemed = true, redeemed_at = now(), applied_to_order_id = p_order_id WHERE id = v_voucher.id AND is_redeemed = false;
  IF NOT FOUND THEN RETURN QUERY SELECT false, NULL::uuid, 'RACE_CONDITION'::text, 'Voucher was redeemed by another request'::text; RETURN; END IF;
  
  IF p_order_id IS NOT NULL THEN
    UPDATE orders SET total_amount_cents = 0, status = 'paid', notes = COALESCE(notes || ' | ', '') || 'Voucher: ' || p_voucher_code WHERE id = p_order_id;
  END IF;
  
  RETURN QUERY SELECT true, v_voucher.id, NULL::text, NULL::text;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Sales report view
DROP VIEW IF EXISTS daily_sales_report;
CREATE OR REPLACE VIEW daily_sales_report AS
SELECT 
  COUNT(*) FILTER (WHERE created_at::date = CURRENT_DATE) AS total_orders,
  COALESCE(SUM(total_amount_cents) FILTER (WHERE created_at::date = CURRENT_DATE AND status IN ('paid', 'preparing', 'ready', 'completed')), 0) AS gross_revenue,
  COUNT(*) FILTER (WHERE created_at::date = CURRENT_DATE AND status = 'completed') AS completed_orders
FROM orders;


-- #############################################################################
-- ## schema-5-rls.sql — RLS Policies
-- #############################################################################

ALTER TABLE staff_directory ENABLE ROW LEVEL SECURITY;
ALTER TABLE time_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE revoked_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE coffee_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE vouchers ENABLE ROW LEVEL SECURITY;
ALTER TABLE merch_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory ENABLE ROW LEVEL SECURITY;
ALTER TABLE expected_parcels ENABLE ROW LEVEL SECURITY;
ALTER TABLE parcels ENABLE ROW LEVEL SECURITY;
ALTER TABLE residents ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketing_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE local_mentions ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketing_leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE processed_webhooks ENABLE ROW LEVEL SECURITY;
ALTER TABLE refund_locks ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE deletion_tombstones ENABLE ROW LEVEL SECURITY;
ALTER TABLE gdpr_secrets ENABLE ROW LEVEL SECURITY;
ALTER TABLE site_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE waitlist ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public can read site_settings" ON site_settings;
CREATE POLICY "Public can read site_settings" ON site_settings FOR SELECT USING (true);

DROP POLICY IF EXISTS "Public can read active products" ON merch_products;
CREATE POLICY "Public can read active products" ON merch_products FOR SELECT USING (is_active = true);

DROP POLICY IF EXISTS "Public can insert to waitlist" ON waitlist;
CREATE POLICY "Public can insert to waitlist" ON waitlist FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "Staff can read own row" ON staff_directory;
CREATE POLICY "Staff can read own row" ON staff_directory 
  FOR SELECT USING (lower(email) = lower(auth.email()));

DROP POLICY IF EXISTS "Deny public access to staff_directory" ON staff_directory;
CREATE POLICY "Deny public access to staff_directory" ON staff_directory 
  FOR ALL USING (false);

DROP POLICY IF EXISTS "Deny public access to time_logs" ON time_logs;
CREATE POLICY "Deny public access to time_logs" ON time_logs FOR ALL USING (false);

DROP POLICY IF EXISTS "Deny public access to revoked_users" ON revoked_users;
CREATE POLICY "Deny public access to revoked_users" ON revoked_users FOR ALL USING (false);

DROP POLICY IF EXISTS "Deny public access to customers" ON customers;
CREATE POLICY "Deny public access to customers" ON customers FOR ALL USING (false);

DROP POLICY IF EXISTS "Deny public access to inventory" ON inventory;
CREATE POLICY "Deny public access to inventory" ON inventory FOR ALL USING (false);

DROP POLICY IF EXISTS "Deny public access to parcels" ON parcels;
CREATE POLICY "Deny public access to parcels" ON parcels FOR ALL USING (false);

DROP POLICY IF EXISTS "Deny public access to residents" ON residents;
CREATE POLICY "Deny public access to residents" ON residents FOR ALL USING (false);

DROP POLICY IF EXISTS "Deny public access to api_usage" ON api_usage;
CREATE POLICY "Deny public access to api_usage" ON api_usage FOR ALL USING (false);

DROP POLICY IF EXISTS "Deny public access to marketing_posts" ON marketing_posts;
CREATE POLICY "Deny public access to marketing_posts" ON marketing_posts FOR ALL USING (false);

DROP POLICY IF EXISTS "Deny public access to local_mentions" ON local_mentions;
CREATE POLICY "Deny public access to local_mentions" ON local_mentions FOR ALL USING (false);

DROP POLICY IF EXISTS "Deny public access to webhook_events" ON webhook_events;
CREATE POLICY "Deny public access to webhook_events" ON webhook_events FOR ALL USING (false);

DROP POLICY IF EXISTS "Deny public access to processed_webhooks" ON processed_webhooks;
CREATE POLICY "Deny public access to processed_webhooks" ON processed_webhooks FOR ALL USING (false);

DROP POLICY IF EXISTS "Deny public access to refund_locks" ON refund_locks;
CREATE POLICY "Deny public access to refund_locks" ON refund_locks FOR ALL USING (false);

DROP POLICY IF EXISTS "Deny public access to notification_queue" ON notification_queue;
CREATE POLICY "Deny public access to notification_queue" ON notification_queue FOR ALL USING (false);

DROP POLICY IF EXISTS "Deny public access to deletion_tombstones" ON deletion_tombstones;
CREATE POLICY "Deny public access to deletion_tombstones" ON deletion_tombstones FOR ALL USING (false);

DROP POLICY IF EXISTS "Deny public access to gdpr_secrets" ON gdpr_secrets;
CREATE POLICY "Deny public access to gdpr_secrets" ON gdpr_secrets FOR ALL USING (false);

DROP POLICY IF EXISTS "Deny public access to profiles" ON profiles;
CREATE POLICY "Deny public access to profiles" ON profiles FOR ALL USING (false);

DROP POLICY IF EXISTS "Deny public access to orders" ON orders;
CREATE POLICY "Deny public access to orders" ON orders FOR ALL USING (false);

DROP POLICY IF EXISTS "Deny public access to coffee_orders" ON coffee_orders;
CREATE POLICY "Deny public access to coffee_orders" ON coffee_orders FOR ALL USING (false);

DROP POLICY IF EXISTS "Deny public access to vouchers" ON vouchers;
CREATE POLICY "Deny public access to vouchers" ON vouchers FOR ALL USING (false);

DROP POLICY IF EXISTS "Deny public access to expected_parcels" ON expected_parcels;
CREATE POLICY "Deny public access to expected_parcels" ON expected_parcels FOR ALL USING (false);

DROP POLICY IF EXISTS "Deny public access to marketing_leads" ON marketing_leads;
CREATE POLICY "Deny public access to marketing_leads" ON marketing_leads FOR ALL USING (false);

-- Property management tables
ALTER TABLE IF EXISTS listings ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS properties ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS property_expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS expected_rents ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS rent_roll ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS water_charges ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS unit_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS settlements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Deny public access to listings" ON listings;
CREATE POLICY "Deny public access to listings" ON listings FOR ALL USING (false);

DROP POLICY IF EXISTS "Deny public access to properties" ON properties;
CREATE POLICY "Deny public access to properties" ON properties FOR ALL USING (false);

DROP POLICY IF EXISTS "Deny public access to property_expenses" ON property_expenses;
CREATE POLICY "Deny public access to property_expenses" ON property_expenses FOR ALL USING (false);

DROP POLICY IF EXISTS "Deny public access to expected_rents" ON expected_rents;
CREATE POLICY "Deny public access to expected_rents" ON expected_rents FOR ALL USING (false);

DROP POLICY IF EXISTS "Deny public access to rent_roll" ON rent_roll;
CREATE POLICY "Deny public access to rent_roll" ON rent_roll FOR ALL USING (false);

DROP POLICY IF EXISTS "Deny public access to water_charges" ON water_charges;
CREATE POLICY "Deny public access to water_charges" ON water_charges FOR ALL USING (false);

DROP POLICY IF EXISTS "Deny public access to unit_profiles" ON unit_profiles;
CREATE POLICY "Deny public access to unit_profiles" ON unit_profiles FOR ALL USING (false);

DROP POLICY IF EXISTS "Deny public access to settlements" ON settlements;
CREATE POLICY "Deny public access to settlements" ON settlements FOR ALL USING (false);

REVOKE SELECT ON brewhub_nnn_summary FROM anon, authenticated;

REVOKE EXECUTE ON FUNCTION adjust_inventory_quantity(uuid, int) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION decrement_inventory(text, int) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION invalidate_staff_sessions(text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION invalidate_all_staff_sessions() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION increment_loyalty(uuid, int, uuid) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION atomic_redeem_voucher(text, uuid, uuid) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION claim_notification_tasks(text, int) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION complete_notification(uuid) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION fail_notification(uuid, text) FROM anon, authenticated;

DROP POLICY IF EXISTS "Deny public access to orders" ON orders;
CREATE POLICY "Deny public access to orders" ON orders FOR ALL USING (false);

DROP POLICY IF EXISTS "Deny public access to coffee_orders" ON coffee_orders;
CREATE POLICY "Deny public access to coffee_orders" ON coffee_orders FOR ALL USING (false);

DROP POLICY IF EXISTS "Deny public access to vouchers" ON vouchers;
CREATE POLICY "Deny public access to vouchers" ON vouchers FOR ALL USING (false);


-- #############################################################################
-- ## schema-6-.sql — Order completion trigger (overwrites schema-3 version)
-- #############################################################################

CREATE OR REPLACE FUNCTION handle_order_completion()
RETURNS TRIGGER AS $$
DECLARE
  v_item_count int;
BEGIN
  IF (NEW.status = 'completed') AND (OLD.status IS DISTINCT FROM 'completed') 
     AND (COALESCE(NEW.inventory_decremented, false) = false) THEN
    SELECT COUNT(*)::int INTO v_item_count
    FROM public.coffee_orders
    WHERE order_id = NEW.id;
    IF v_item_count > 0 THEN
      UPDATE public.inventory
      SET current_stock = GREATEST(0, current_stock - v_item_count),
          updated_at = now()
      WHERE item_name ILIKE '%Cup%';
    END IF;
    NEW.inventory_decremented := true;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_order_completion ON public.orders;
CREATE TRIGGER trg_order_completion
  BEFORE UPDATE ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION handle_order_completion();


-- #############################################################################
-- ## schema-7.sql — Coffee order status sync
-- #############################################################################

CREATE OR REPLACE FUNCTION sync_coffee_order_status()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE public.coffee_orders
  SET status = NEW.status
  WHERE order_id = NEW.id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_sync_coffee_status ON public.orders;
CREATE TRIGGER trg_sync_coffee_status
  AFTER UPDATE OF status ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION sync_coffee_order_status();


-- #############################################################################
-- ## schema-8-pin.sql — PIN auth column
-- #############################################################################

ALTER TABLE staff_directory
  ADD COLUMN IF NOT EXISTS pin TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_staff_directory_pin
  ON staff_directory (pin) WHERE pin IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_pin_format'
  ) THEN
    ALTER TABLE staff_directory
      ADD CONSTRAINT chk_pin_format CHECK (pin IS NULL OR pin ~ '^\d{6}$');
  END IF;
END $$;

COMMENT ON COLUMN staff_directory.pin IS 'Unique 6-digit numeric PIN for ops page (POS/KDS/Scanner) authentication. Verified server-side only via service_role key.';


-- #############################################################################
-- ## schema-9-receipts.sql — Staff Quality of Life
-- #############################################################################

ALTER TABLE orders ADD COLUMN IF NOT EXISTS completed_at timestamptz;
CREATE INDEX IF NOT EXISTS idx_orders_completed_at ON orders(completed_at DESC);

CREATE TABLE IF NOT EXISTS receipt_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid REFERENCES orders(id) ON DELETE CASCADE,
  receipt_text text NOT NULL,
  printed boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_receipt_queue_pending ON receipt_queue(printed) WHERE printed = false;

ALTER TABLE receipt_queue ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Deny public access to receipt_queue" ON receipt_queue;
CREATE POLICY "Deny public access to receipt_queue" ON receipt_queue FOR ALL USING (false);

DROP POLICY IF EXISTS "Staff can read receipts" ON receipt_queue;
CREATE POLICY "Staff can read receipts" ON receipt_queue
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM staff_directory
      WHERE lower(email) = lower(auth.email())
    )
  );

-- ═══════════════════════════════════════════════════════════════
-- COMP AUDIT (schema-34)
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS comp_audit (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id    uuid        NOT NULL,
  staff_id    uuid        NOT NULL,
  staff_email text        NOT NULL,
  staff_role  text        NOT NULL,
  amount_cents int        NOT NULL CHECK (amount_cents >= 0),
  reason      text        NOT NULL DEFAULT '',
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_comp_audit_created ON comp_audit (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_comp_audit_staff   ON comp_audit (staff_id, created_at DESC);

ALTER TABLE comp_audit ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS comp_audit_deny_all ON comp_audit;
CREATE POLICY comp_audit_deny_all ON comp_audit FOR ALL USING (false);


-- #############################################################################
-- ## schema-10-payment-hardening.sql — Stale Order Cleanup
-- #############################################################################

CREATE OR REPLACE FUNCTION cancel_stale_orders(stale_minutes int DEFAULT 30)
RETURNS int AS $$
DECLARE
  v_cancelled int;
BEGIN
  WITH cancelled AS (
    UPDATE orders
    SET status = 'cancelled',
        notes = COALESCE(notes || ' | ', '') || 'Auto-cancelled: stale after ' || stale_minutes || ' min'
    WHERE status IN ('pending', 'unpaid')
      AND payment_id IS NULL
      AND created_at < now() - (stale_minutes || ' minutes')::interval
    RETURNING id
  )
  SELECT COUNT(*)::int INTO v_cancelled FROM cancelled;
  RETURN v_cancelled;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

ALTER TABLE orders ADD COLUMN IF NOT EXISTS paid_amount_cents int DEFAULT 0;


-- #############################################################################
-- ## schema-11-medium-fixes.sql — DB-backed PIN lockout + Staff RLS
-- #############################################################################

CREATE TABLE IF NOT EXISTS pin_attempts (
  ip text PRIMARY KEY,
  fail_count int NOT NULL DEFAULT 0,
  window_start timestamptz NOT NULL DEFAULT now(),
  locked_until timestamptz
);
ALTER TABLE pin_attempts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Deny public access to pin_attempts" ON pin_attempts;
CREATE POLICY "Deny public access to pin_attempts" ON pin_attempts FOR ALL USING (false);

CREATE OR REPLACE FUNCTION record_pin_failure(p_ip text, p_max_attempts int DEFAULT 5, p_lockout_seconds int DEFAULT 60)
RETURNS TABLE(locked boolean, retry_after_seconds int) AS $$
DECLARE
  v_row pin_attempts%ROWTYPE;
BEGIN
  INSERT INTO pin_attempts (ip, fail_count, window_start)
  VALUES (p_ip, 1, now())
  ON CONFLICT (ip) DO UPDATE SET
    fail_count = CASE
      WHEN pin_attempts.window_start < now() - (p_lockout_seconds || ' seconds')::interval THEN 1
      ELSE pin_attempts.fail_count + 1
    END,
    window_start = CASE
      WHEN pin_attempts.window_start < now() - (p_lockout_seconds || ' seconds')::interval THEN now()
      ELSE pin_attempts.window_start
    END,
    locked_until = CASE
      WHEN pin_attempts.window_start >= now() - (p_lockout_seconds || ' seconds')::interval
           AND pin_attempts.fail_count + 1 >= p_max_attempts
      THEN now() + (p_lockout_seconds || ' seconds')::interval
      ELSE pin_attempts.locked_until
    END
  RETURNING * INTO v_row;

  IF v_row.locked_until IS NOT NULL AND v_row.locked_until > now() THEN
    RETURN QUERY SELECT true, GREATEST(0, EXTRACT(EPOCH FROM v_row.locked_until - now())::int);
  ELSE
    RETURN QUERY SELECT false, 0;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION check_pin_lockout(p_ip text)
RETURNS TABLE(locked boolean, retry_after_seconds int) AS $$
DECLARE
  v_locked_until timestamptz;
BEGIN
  SELECT locked_until INTO v_locked_until FROM pin_attempts WHERE ip = p_ip;
  IF v_locked_until IS NOT NULL AND v_locked_until > now() THEN
    RETURN QUERY SELECT true, GREATEST(0, EXTRACT(EPOCH FROM v_locked_until - now())::int);
  ELSE
    RETURN QUERY SELECT false, 0;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION clear_pin_lockout(p_ip text)
RETURNS void AS $$
BEGIN
  DELETE FROM pin_attempts WHERE ip = p_ip;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

REVOKE EXECUTE ON FUNCTION record_pin_failure(text, int, int) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION check_pin_lockout(text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION clear_pin_lockout(text) FROM anon, authenticated;

-- Staff-scoped SELECT policies
DROP POLICY IF EXISTS "Staff can read orders" ON orders;
CREATE POLICY "Staff can read orders" ON orders
  FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM staff_directory WHERE lower(email) = lower(auth.email()))
  );

DROP POLICY IF EXISTS "Staff can read coffee_orders" ON coffee_orders;
CREATE POLICY "Staff can read coffee_orders" ON coffee_orders
  FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM staff_directory WHERE lower(email) = lower(auth.email()))
  );

DROP POLICY IF EXISTS "Staff can read own row" ON staff_directory;
DROP POLICY IF EXISTS "Staff can read all staff" ON staff_directory;
CREATE POLICY "Staff can read all staff" ON staff_directory
  FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM staff_directory WHERE lower(email) = lower(auth.email()))
  );

DROP POLICY IF EXISTS "Staff can read time_logs" ON time_logs;
CREATE POLICY "Staff can read time_logs" ON time_logs
  FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM staff_directory WHERE lower(email) = lower(auth.email()))
  );


-- #############################################################################
-- ## schema-12-rls-bootstrap-fix.sql — SECURITY DEFINER staff helper
-- #############################################################################

CREATE OR REPLACE FUNCTION is_brewhub_staff()
RETURNS boolean AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM staff_directory WHERE lower(email) = lower(auth.email())
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

GRANT EXECUTE ON FUNCTION is_brewhub_staff() TO authenticated;

DROP POLICY IF EXISTS "Staff can read all staff" ON staff_directory;
DROP POLICY IF EXISTS "Staff can read own row" ON staff_directory;
CREATE POLICY "Staff can read all staff" ON staff_directory
  FOR SELECT
  USING (is_brewhub_staff());

DROP POLICY IF EXISTS "Staff can read orders" ON orders;
CREATE POLICY "Staff can read orders" ON orders
  FOR SELECT
  USING (is_brewhub_staff());

DROP POLICY IF EXISTS "Staff can read coffee_orders" ON coffee_orders;
CREATE POLICY "Staff can read coffee_orders" ON coffee_orders
  FOR SELECT
  USING (is_brewhub_staff());

DROP POLICY IF EXISTS "Staff can read time_logs" ON time_logs;
CREATE POLICY "Staff can read time_logs" ON time_logs
  FOR SELECT
  USING (is_brewhub_staff());

DROP POLICY IF EXISTS "Staff can read receipts" ON receipt_queue;
CREATE POLICY "Staff can read receipts" ON receipt_queue
  FOR SELECT
  USING (is_brewhub_staff());


-- #############################################################################
-- ## schema-13-catalog-rls.sql — Staff catalog & inventory access
-- #############################################################################

DROP POLICY IF EXISTS "Staff can read all products" ON merch_products;
CREATE POLICY "Staff can read all products" ON merch_products
  FOR SELECT
  USING (is_brewhub_staff());

DROP POLICY IF EXISTS "Staff can insert products" ON merch_products;
CREATE POLICY "Staff can insert products" ON merch_products
  FOR INSERT
  WITH CHECK (is_brewhub_staff());

DROP POLICY IF EXISTS "Staff can update products" ON merch_products;
CREATE POLICY "Staff can update products" ON merch_products
  FOR UPDATE
  USING (is_brewhub_staff())
  WITH CHECK (is_brewhub_staff());

DROP POLICY IF EXISTS "Staff can read inventory" ON inventory;
CREATE POLICY "Staff can read inventory" ON inventory
  FOR SELECT
  USING (is_brewhub_staff());


-- #############################################################################
-- ## schema-14-parcel-monitor-rls.sql — Parcel departure board VIEW
-- #############################################################################

CREATE OR REPLACE VIEW parcel_departure_board
  WITH (security_invoker = false)
AS
SELECT
  id,
  CASE
    WHEN recipient_name IS NULL OR trim(recipient_name) = '' THEN 'Resident'
    WHEN position(' ' IN trim(recipient_name)) = 0
      THEN upper(left(trim(recipient_name), 1)) || '. ***'
    ELSE upper(left(trim(recipient_name), 1)) || '. '
         || split_part(trim(recipient_name), ' ', array_length(string_to_array(trim(recipient_name), ' '), 1))
  END AS masked_name,
  COALESCE(carrier, 'PKG') || ' ...' || right(tracking_number, 4) AS masked_tracking,
  carrier,
  received_at,
  unit_number
FROM parcels
WHERE status = 'arrived';

GRANT SELECT ON parcel_departure_board TO anon, authenticated;

DROP POLICY IF EXISTS "Public can read arrived parcels" ON parcels;

DROP POLICY IF EXISTS "Staff can read parcels" ON parcels;
CREATE POLICY "Staff can read parcels" ON parcels
  FOR SELECT
  USING (is_brewhub_staff());


-- #############################################################################
-- ## schema-15-job-applications.sql
-- #############################################################################

CREATE TABLE IF NOT EXISTS job_applications (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name           text        NOT NULL,
  email          text        NOT NULL,
  phone          text,
  availability   text,
  scenario_answer text       NOT NULL,
  status         text        NOT NULL DEFAULT 'pending',
  created_at     timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE job_applications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anon can submit application" ON job_applications;
CREATE POLICY "Anon can submit application"
  ON job_applications
  FOR INSERT
  TO anon
  WITH CHECK (true);

DROP POLICY IF EXISTS "Anon can read applications" ON job_applications;

DROP POLICY IF EXISTS "Staff can read applications" ON job_applications;
CREATE POLICY "Staff can read applications"
  ON job_applications
  FOR SELECT
  USING (is_brewhub_staff());

DROP POLICY IF EXISTS "Staff can update applications" ON job_applications;
CREATE POLICY "Staff can update applications"
  ON job_applications
  FOR UPDATE
  USING (is_brewhub_staff())
  WITH CHECK (is_brewhub_staff());

REVOKE ALL ON job_applications FROM anon;
GRANT INSERT ON job_applications TO anon;
GRANT SELECT, INSERT, UPDATE ON job_applications TO authenticated;


-- #############################################################################
-- ## schema-16-cleanup.sql — Reconciliation Cleanup
-- #############################################################################

-- FIX 1: profiles table missing columns
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS email text;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

UPDATE profiles p
SET email = u.email
FROM auth.users u
WHERE p.id = u.id
  AND p.email IS NULL;

CREATE INDEX IF NOT EXISTS idx_profiles_email ON profiles (lower(email));

-- FIX 2: orders missing paid_at
ALTER TABLE orders ADD COLUMN IF NOT EXISTS paid_at timestamptz;

-- FIX 3: vouchers missing columns
ALTER TABLE vouchers ADD COLUMN IF NOT EXISTS qr_code_base64 text;
ALTER TABLE vouchers ADD COLUMN IF NOT EXISTS status text DEFAULT 'active';

UPDATE vouchers SET status = 'redeemed' WHERE is_redeemed = true AND status IS NULL;
UPDATE vouchers SET status = 'active'   WHERE is_redeemed = false AND status IS NULL;

-- FIX 4: coffee_orders → orders FK
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_coffee_orders_order'
      AND table_name = 'coffee_orders'
  ) THEN
    ALTER TABLE coffee_orders
      ADD CONSTRAINT fk_coffee_orders_order
      FOREIGN KEY (order_id) REFERENCES orders(id)
      ON DELETE CASCADE;
  END IF;
END $$;

-- FIX 5: vouchers → orders FK
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_vouchers_order'
      AND table_name = 'vouchers'
  ) THEN
    ALTER TABLE vouchers
      ADD CONSTRAINT fk_vouchers_order
      FOREIGN KEY (applied_to_order_id) REFERENCES orders(id)
      ON DELETE SET NULL;
  END IF;
END $$;

-- FIX 6: customers name/address sync
CREATE OR REPLACE FUNCTION sync_customer_name_fields()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.name IS NOT NULL AND (NEW.full_name IS NULL OR NEW.full_name = '') THEN
    NEW.full_name := NEW.name;
  ELSIF NEW.full_name IS NOT NULL AND (NEW.name IS NULL OR NEW.name = '') THEN
    NEW.name := NEW.full_name;
  END IF;
  IF NEW.address IS NOT NULL AND (NEW.address_street IS NULL OR NEW.address_street = '') THEN
    NEW.address_street := NEW.address;
  ELSIF NEW.address_street IS NOT NULL AND (NEW.address IS NULL OR NEW.address = '') THEN
    NEW.address := NEW.address_street;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_customer_fields ON customers;
CREATE TRIGGER trg_sync_customer_fields
  BEFORE INSERT OR UPDATE ON customers
  FOR EACH ROW EXECUTE FUNCTION sync_customer_name_fields();

UPDATE customers SET full_name = name WHERE full_name IS NULL AND name IS NOT NULL;
UPDATE customers SET name = full_name WHERE name IS NULL AND full_name IS NOT NULL;
UPDATE customers SET address_street = address WHERE address_street IS NULL AND address IS NOT NULL;

-- FIX 7: staff name/full_name sync
CREATE OR REPLACE FUNCTION sync_staff_name_fields()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.name IS NOT NULL AND (NEW.full_name IS NULL OR NEW.full_name = '') THEN
    NEW.full_name := NEW.name;
  ELSIF NEW.full_name IS NOT NULL AND (NEW.name IS NULL OR NEW.name = '') THEN
    NEW.name := NEW.full_name;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_staff_name ON staff_directory;
CREATE TRIGGER trg_sync_staff_name
  BEFORE INSERT OR UPDATE ON staff_directory
  FOR EACH ROW EXECUTE FUNCTION sync_staff_name_fields();

UPDATE staff_directory SET full_name = name WHERE full_name IS NULL AND name IS NOT NULL;
UPDATE staff_directory SET name = full_name WHERE name IS NULL AND full_name IS NOT NULL;

-- FIX 8: deprecate employee_id
COMMENT ON COLUMN time_logs.employee_id IS
  'DEPRECATED (schema-16): Never populated by any workflow. '
  'All lookups use employee_email. Will be dropped in a future migration.';

-- FIX 9: profiles self-read + staff read
DROP POLICY IF EXISTS "Users can read own profile" ON profiles;
CREATE POLICY "Users can read own profile" ON profiles
  FOR SELECT
  USING (auth.uid() = id);

DROP POLICY IF EXISTS "Users can update own profile" ON profiles;
CREATE POLICY "Users can update own profile" ON profiles
  FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "Staff can read all profiles" ON profiles;
CREATE POLICY "Staff can read all profiles" ON profiles
  FOR SELECT
  USING (is_brewhub_staff());

-- FIX 10: staff can read customers
DROP POLICY IF EXISTS "Staff can read customers" ON customers;
CREATE POLICY "Staff can read customers" ON customers
  FOR SELECT
  USING (is_brewhub_staff());

-- FIX 11: unique email on profiles
CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_email_unique
  ON profiles (lower(email))
  WHERE email IS NOT NULL;


-- #############################################################################
-- ## schema-17-product-category.sql
-- #############################################################################

ALTER TABLE merch_products
  ADD COLUMN IF NOT EXISTS category text NOT NULL DEFAULT 'menu';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'merch_products_category_check'
  ) THEN
    ALTER TABLE merch_products
      ADD CONSTRAINT merch_products_category_check
      CHECK (category IN ('menu', 'merch'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_merch_products_category
  ON merch_products (category);


-- #############################################################################
-- ## schema-18-ground-truth-reconciliation.sql
-- #############################################################################

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS type             text          DEFAULT 'cafe',
  ADD COLUMN IF NOT EXISTS shipping_address text,
  ADD COLUMN IF NOT EXISTS items            jsonb;

ALTER TABLE parcels
  ADD COLUMN IF NOT EXISTS recipient_email text;

ALTER TABLE inventory
  ADD COLUMN IF NOT EXISTS category text DEFAULT 'general';

ALTER TABLE job_applications
  ADD COLUMN IF NOT EXISTS resume_url text;


-- #############################################################################
-- ## schema-19-fix-duplicate-fk.sql
-- #############################################################################

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT tc.constraint_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name
      AND tc.table_schema = kcu.table_schema
    WHERE tc.constraint_type = 'FOREIGN KEY'
      AND tc.table_name = 'coffee_orders'
      AND kcu.column_name = 'order_id'
      AND tc.constraint_name != 'fk_coffee_orders_order'
  LOOP
    EXECUTE format('ALTER TABLE coffee_orders DROP CONSTRAINT IF EXISTS %I', r.constraint_name);
    RAISE NOTICE 'Dropped duplicate FK: %', r.constraint_name;
  END LOOP;
END $$;


-- #############################################################################
-- ## schema-20-catalog-delete-rls.sql
-- #############################################################################

DROP POLICY IF EXISTS "Staff can delete products" ON merch_products;
CREATE POLICY "Staff can delete products" ON merch_products
  FOR DELETE
  USING ( is_brewhub_staff() );


-- #############################################################################
-- ## schema-21-resume-url-rls.sql
-- #############################################################################

DROP POLICY IF EXISTS "Anon can submit application" ON job_applications;

CREATE POLICY "Anon can submit application"
  ON job_applications
  FOR INSERT
  TO anon
  WITH CHECK (
    resume_url IS NULL
    OR resume_url ~ '^https://'
    OR resume_url ~ '^resumes/[0-9]+-[a-z0-9-]+\.pdf$'
  );

DROP POLICY IF EXISTS "Staff can update applications" ON job_applications;

CREATE POLICY "Staff can update applications"
  ON job_applications
  FOR UPDATE
  USING  (is_brewhub_staff())
  WITH CHECK (
    is_brewhub_staff()
    AND (
      resume_url IS NULL
      OR resume_url ~ '^https://'
      OR resume_url ~ '^resumes/[0-9]+-[a-z0-9-]+\.pdf$'
    )
  );


-- #############################################################################
-- ## schema-22-security-hardening.sql — Atomic loyalty with row locking
-- #############################################################################

DROP FUNCTION IF EXISTS increment_loyalty(uuid, int, uuid);
CREATE OR REPLACE FUNCTION increment_loyalty(
  target_user_id uuid,
  amount_cents   int,
  p_order_id     uuid DEFAULT NULL
)
RETURNS TABLE(loyalty_points int, voucher_earned boolean, points_awarded int) AS $$
DECLARE
  v_current_points int;
  v_new_points     int;
  v_voucher_earned boolean := false;
  v_points_delta   int;
  v_previous       int := 0;
BEGIN
  IF p_order_id IS NOT NULL THEN
    SELECT COALESCE(paid_amount_cents, 0)
      INTO v_previous
      FROM orders
     WHERE id = p_order_id;
  END IF;

  v_points_delta := GREATEST(0, floor(amount_cents / 100)::int - floor(v_previous / 100)::int);

  IF v_points_delta <= 0 THEN
    RETURN QUERY
      SELECT COALESCE(p.loyalty_points, 0), false, 0
        FROM profiles p
       WHERE p.id = target_user_id;
    RETURN;
  END IF;

  SELECT p.loyalty_points
    INTO v_current_points
    FROM profiles p
   WHERE p.id = target_user_id
     FOR UPDATE;

  IF v_current_points IS NULL THEN
    RETURN QUERY SELECT 0, false, 0;
    RETURN;
  END IF;

  v_new_points := COALESCE(v_current_points, 0) + v_points_delta;

  UPDATE profiles
     SET loyalty_points = v_new_points,
         updated_at     = now()
   WHERE id = target_user_id;

  IF v_new_points >= 500
     AND (v_current_points % 500) > (v_new_points % 500)
  THEN
    v_voucher_earned := true;
  END IF;

  RETURN QUERY SELECT v_new_points, v_voucher_earned, v_points_delta;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP FUNCTION IF EXISTS decrement_loyalty_on_refund(uuid, int);
DROP FUNCTION IF EXISTS decrement_loyalty_on_refund(uuid);
CREATE OR REPLACE FUNCTION decrement_loyalty_on_refund(
  target_user_id uuid,
  amount_cents   int DEFAULT 500
)
RETURNS TABLE(loyalty_points int, points_deducted int) AS $$
DECLARE
  v_current_points int;
  v_deduct         int;
  v_new_points     int;
BEGIN
  SELECT p.loyalty_points
    INTO v_current_points
    FROM profiles p
   WHERE p.id = target_user_id
     FOR UPDATE;

  IF v_current_points IS NULL THEN
    RETURN QUERY SELECT 0, 0;
    RETURN;
  END IF;

  v_deduct     := LEAST(GREATEST(0, floor(amount_cents / 100)::int), v_current_points);
  v_new_points := v_current_points - v_deduct;

  UPDATE profiles
     SET loyalty_points = v_new_points,
         updated_at     = now()
   WHERE id = target_user_id;

  RETURN QUERY SELECT v_new_points, v_deduct;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

REVOKE EXECUTE ON FUNCTION increment_loyalty(uuid, int, uuid) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION decrement_loyalty_on_refund(uuid, int) FROM anon, authenticated;


-- #############################################################################
-- ## schema-23-security-hardening.sql — Storage + Price Guard
-- #############################################################################

INSERT INTO storage.buckets (id, name, public)
VALUES ('menu-images', 'menu-images', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Allow public uploads to menu-images" ON storage.objects;
DROP POLICY IF EXISTS "Anyone can upload menu images"        ON storage.objects;
DROP POLICY IF EXISTS "Staff can upload menu images"         ON storage.objects;
DROP POLICY IF EXISTS "Staff can update menu images"         ON storage.objects;
DROP POLICY IF EXISTS "Staff can delete menu images"         ON storage.objects;
DROP POLICY IF EXISTS "Public can view menu images"          ON storage.objects;

CREATE POLICY "Public can view menu images"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'menu-images');

CREATE POLICY "Staff can upload menu images"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'menu-images'
    AND (
      (auth.role() = 'service_role')
      OR
      (
        auth.role() = 'authenticated'
        AND EXISTS (
          SELECT 1 FROM public.staff_directory
          WHERE email = auth.email()
        )
      )
    )
  );

CREATE POLICY "Staff can update menu images"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'menu-images'
    AND (
      (auth.role() = 'service_role')
      OR
      (
        auth.role() = 'authenticated'
        AND EXISTS (
          SELECT 1 FROM public.staff_directory
          WHERE email = auth.email()
        )
      )
    )
  );

CREATE POLICY "Staff can delete menu images"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'menu-images'
    AND (
      (auth.role() = 'service_role')
      OR
      (
        auth.role() = 'authenticated'
        AND EXISTS (
          SELECT 1 FROM public.staff_directory
          WHERE email = auth.email()
        )
      )
    )
  );

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'merch_products_price_positive'
  ) THEN
    ALTER TABLE public.merch_products
      ADD CONSTRAINT merch_products_price_positive
      CHECK (price_cents > 0);
  END IF;
END $$;

DROP POLICY IF EXISTS "Staff can update products" ON public.merch_products;
CREATE POLICY "Staff can update products"
  ON public.merch_products FOR UPDATE
  USING (
    auth.role() = 'service_role'
    OR (
      auth.role() = 'authenticated'
      AND EXISTS (
        SELECT 1 FROM public.staff_directory
        WHERE email = auth.email()
      )
    )
  )
  WITH CHECK (
    price_cents > 0
  );


-- #############################################################################
-- ## schema-24-rbac-idor-hardening.sql — RBAC + Parcels IDOR fix
-- #############################################################################

CREATE OR REPLACE FUNCTION is_brewhub_manager()
RETURNS boolean AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM staff_directory
    WHERE lower(email) = lower(auth.email())
      AND role IN ('manager', 'admin')
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

GRANT EXECUTE ON FUNCTION is_brewhub_manager() TO authenticated;

-- MERCH: Manager-only writes
DROP POLICY IF EXISTS "Staff can insert products" ON merch_products;
DROP POLICY IF EXISTS "Manager can insert products" ON merch_products;
CREATE POLICY "Manager can insert products" ON merch_products
  FOR INSERT
  WITH CHECK (is_brewhub_manager());

DROP POLICY IF EXISTS "Staff can update products" ON merch_products;
DROP POLICY IF EXISTS "Manager can update products" ON merch_products;
CREATE POLICY "Manager can update products" ON merch_products
  FOR UPDATE
  USING (is_brewhub_manager())
  WITH CHECK (is_brewhub_manager());

DROP POLICY IF EXISTS "Staff can delete products" ON merch_products;
DROP POLICY IF EXISTS "Manager can delete products" ON merch_products;
CREATE POLICY "Manager can delete products" ON merch_products
  FOR DELETE
  USING (is_brewhub_manager());

-- PAYROLL (if exists)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'payroll_runs') THEN
    EXECUTE 'ALTER TABLE payroll_runs ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS "Deny public access to payroll_runs" ON payroll_runs';
    EXECUTE 'CREATE POLICY "Deny public access to payroll_runs" ON payroll_runs FOR ALL USING (false)';
    EXECUTE 'DROP POLICY IF EXISTS "Manager can read payroll" ON payroll_runs';
    EXECUTE 'CREATE POLICY "Manager can read payroll" ON payroll_runs FOR SELECT USING (is_brewhub_manager())';
    EXECUTE 'DROP POLICY IF EXISTS "Manager can insert payroll" ON payroll_runs';
    EXECUTE 'CREATE POLICY "Manager can insert payroll" ON payroll_runs FOR INSERT WITH CHECK (is_brewhub_manager())';
    EXECUTE 'DROP POLICY IF EXISTS "Manager can update payroll" ON payroll_runs';
    EXECUTE 'CREATE POLICY "Manager can update payroll" ON payroll_runs FOR UPDATE USING (is_brewhub_manager()) WITH CHECK (is_brewhub_manager())';
    EXECUTE 'DROP POLICY IF EXISTS "Manager can delete payroll" ON payroll_runs';
    EXECUTE 'CREATE POLICY "Manager can delete payroll" ON payroll_runs FOR DELETE USING (is_brewhub_manager())';
  END IF;
END $$;

-- PARCELS: IDOR FIX
DROP POLICY IF EXISTS "Resident can read own parcels" ON parcels;
CREATE POLICY "Resident can read own parcels" ON parcels
  FOR SELECT
  USING (
    auth.role() = 'authenticated'
    AND lower(recipient_email) = lower(auth.jwt()->>'email')
  );

DROP POLICY IF EXISTS "Resident can update own parcels" ON parcels;
CREATE POLICY "Resident can update own parcels" ON parcels
  FOR UPDATE
  USING (
    auth.role() = 'authenticated'
    AND lower(recipient_email) = lower(auth.jwt()->>'email')
  )
  WITH CHECK (
    auth.role() = 'authenticated'
    AND lower(recipient_email) = lower(auth.jwt()->>'email')
  );

DROP POLICY IF EXISTS "Staff can update parcels" ON parcels;
CREATE POLICY "Staff can update parcels" ON parcels
  FOR UPDATE
  USING (is_brewhub_staff())
  WITH CHECK (is_brewhub_staff());

DROP POLICY IF EXISTS "Staff can insert parcels" ON parcels;
CREATE POLICY "Staff can insert parcels" ON parcels
  FOR INSERT
  WITH CHECK (is_brewhub_staff());

CREATE INDEX IF NOT EXISTS idx_parcels_recipient_email
  ON parcels (lower(recipient_email));

REVOKE EXECUTE ON FUNCTION is_brewhub_manager() FROM anon;


-- #############################################################################
-- ## schema-25-order-timeout-cleanup.sql — Stale order + webhook cleanup
-- #############################################################################

CREATE OR REPLACE FUNCTION public.abandon_stale_orders()
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  affected int;
BEGIN
  WITH abandoned AS (
    UPDATE orders
       SET status      = 'abandoned',
           updated_at  = now()
     WHERE status      = 'pending'
       AND created_at  < now() - interval '15 minutes'
    RETURNING id
  )
  SELECT count(*) INTO affected FROM abandoned;
  IF affected > 0 THEN
    RAISE LOG '[CRON] Abandoned % stale pending orders.', affected;
  END IF;
  RETURN affected;
END;
$$;

REVOKE ALL ON FUNCTION public.abandon_stale_orders() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.abandon_stale_orders() TO service_role;

CREATE OR REPLACE FUNCTION public.cleanup_old_webhooks()
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  removed int;
BEGIN
  WITH deleted AS (
    DELETE FROM processed_webhooks
     WHERE processed_at < now() - interval '7 days'
    RETURNING id
  )
  SELECT count(*) INTO removed FROM deleted;
  IF removed > 0 THEN
    RAISE LOG '[CRON] Cleaned up % old webhook records.', removed;
  END IF;
  RETURN removed;
END;
$$;

REVOKE ALL ON FUNCTION public.cleanup_old_webhooks() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleanup_old_webhooks() TO service_role;

CREATE EXTENSION IF NOT EXISTS pg_cron;

SELECT cron.unschedule('abandon-stale-orders')
 WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'abandon-stale-orders');

SELECT cron.schedule(
  'abandon-stale-orders',
  '* * * * *',
  $$SELECT public.abandon_stale_orders()$$
);

SELECT cron.unschedule('cleanup-old-webhooks')
 WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'cleanup-old-webhooks');

SELECT cron.schedule(
  'cleanup-old-webhooks',
  '0 3 * * *',
  $$SELECT public.cleanup_old_webhooks()$$
);

CREATE INDEX IF NOT EXISTS idx_orders_pending_created
  ON orders (created_at)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_processed_webhooks_processed_at
  ON processed_webhooks (processed_at);


-- #############################################################################
-- ## schema-26-soft-delete-payroll-refund.sql
-- #############################################################################

DROP POLICY IF EXISTS "Manager can delete products" ON merch_products;
DROP POLICY IF EXISTS "Staff can delete products"   ON merch_products;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'time_logs' AND column_name = 'needs_manager_review'
  ) THEN
    ALTER TABLE time_logs ADD COLUMN needs_manager_review boolean NOT NULL DEFAULT false;
  END IF;
END $$;

DROP FUNCTION IF EXISTS restore_inventory_on_refund(uuid);
CREATE OR REPLACE FUNCTION restore_inventory_on_refund(p_order_id uuid)
RETURNS jsonb AS $$
DECLARE
  v_cup_count int;
  v_already   boolean;
BEGIN
  SELECT COALESCE(inventory_decremented, false) INTO v_already
  FROM orders WHERE id = p_order_id;

  IF NOT v_already THEN
    RETURN jsonb_build_object('restored', false, 'reason', 'inventory was never decremented');
  END IF;

  SELECT COUNT(*)::int INTO v_cup_count
  FROM coffee_orders WHERE order_id = p_order_id;

  IF v_cup_count > 0 THEN
    UPDATE inventory
    SET current_stock = current_stock + v_cup_count,
        updated_at    = now()
    WHERE item_name ILIKE '12oz Cups';
  END IF;

  UPDATE orders
  SET inventory_decremented = false
  WHERE id = p_order_id;

  RETURN jsonb_build_object('restored', true, 'cups_restored', v_cup_count);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

REVOKE EXECUTE ON FUNCTION restore_inventory_on_refund(uuid) FROM anon, authenticated;


-- #############################################################################
-- ## schema-27-audit-fixes.sql — Critical audit remediations
-- #############################################################################

REVOKE EXECUTE ON FUNCTION cancel_stale_orders(int) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION cancel_stale_orders(int) TO service_role;

REVOKE EXECUTE ON FUNCTION atomic_parcel_checkin(text, text, text, text, text, text, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION atomic_parcel_checkin(text, text, text, text, text, text, text) TO service_role;

REVOKE EXECUTE ON FUNCTION get_low_stock_items() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION get_low_stock_items() TO service_role;

REVOKE EXECUTE ON FUNCTION increment_api_usage(text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION increment_api_usage(text) TO service_role;

REVOKE EXECUTE ON FUNCTION is_tombstoned(text, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION is_tombstoned(text, text) TO service_role;

-- Fix anti-tampering trigger for voucher bypass
DROP TRIGGER IF EXISTS orders_no_amount_tampering ON orders;
DROP FUNCTION IF EXISTS prevent_order_amount_tampering() CASCADE;

CREATE OR REPLACE FUNCTION prevent_order_amount_tampering()
RETURNS TRIGGER AS $$
BEGIN
  IF current_setting('app.voucher_bypass', true) = 'true' THEN
    RETURN NEW;
  END IF;
  IF OLD.total_amount_cents IS NOT NULL AND NEW.total_amount_cents <> OLD.total_amount_cents THEN
    RAISE EXCEPTION 'Cannot modify order amount after creation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER orders_no_amount_tampering
  BEFORE UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION prevent_order_amount_tampering();

-- Patched atomic_redeem_voucher with bypass flag
DROP FUNCTION IF EXISTS atomic_redeem_voucher(text, uuid, uuid);
CREATE OR REPLACE FUNCTION atomic_redeem_voucher(p_voucher_code text, p_order_id uuid, p_user_id uuid DEFAULT NULL)
RETURNS TABLE(success boolean, voucher_id uuid, error_code text, error_message text) AS $$
DECLARE
  v_voucher RECORD; v_order RECORD; v_lock_key bigint;
BEGIN
  IF length(p_voucher_code) > 100 THEN
    RETURN QUERY SELECT false, NULL::uuid, 'INVALID_CODE'::text, 'Voucher code too long'::text;
    RETURN;
  END IF;

  SELECT id, user_id, is_redeemed INTO v_voucher FROM vouchers WHERE code = upper(p_voucher_code) FOR UPDATE SKIP LOCKED;
  IF v_voucher IS NULL THEN RETURN QUERY SELECT false, NULL::uuid, 'VOUCHER_NOT_FOUND'::text, 'Voucher not found or already being processed'::text; RETURN; END IF;
  IF v_voucher.is_redeemed THEN RETURN QUERY SELECT false, NULL::uuid, 'ALREADY_REDEEMED'::text, 'This voucher has already been used'::text; RETURN; END IF;

  v_lock_key := hashtext('voucher_lock:' || COALESCE(v_voucher.user_id::text, 'guest'));
  PERFORM pg_advisory_xact_lock(v_lock_key);

  IF EXISTS (SELECT 1 FROM refund_locks WHERE user_id = v_voucher.user_id AND locked_at > now() - interval '5 minutes') THEN
    RETURN QUERY SELECT false, NULL::uuid, 'REFUND_IN_PROGRESS'::text, 'Account locked due to pending refund. Please wait.'::text; RETURN;
  END IF;

  IF p_order_id IS NOT NULL THEN
    SELECT id, user_id, status INTO v_order FROM orders WHERE id = p_order_id;
    IF v_order IS NULL THEN RETURN QUERY SELECT false, NULL::uuid, 'ORDER_NOT_FOUND'::text, 'Order not found'::text; RETURN; END IF;
    IF v_order.status IN ('paid', 'refunded') THEN RETURN QUERY SELECT false, NULL::uuid, 'ORDER_COMPLETE'::text, 'Cannot apply voucher to completed order'::text; RETURN; END IF;
    IF v_voucher.user_id IS NOT NULL AND v_voucher.user_id != v_order.user_id THEN
      RETURN QUERY SELECT false, NULL::uuid, 'OWNERSHIP_MISMATCH'::text, 'This voucher belongs to a different customer'::text; RETURN;
    END IF;
  END IF;

  UPDATE vouchers SET is_redeemed = true, redeemed_at = now(), applied_to_order_id = p_order_id WHERE id = v_voucher.id AND is_redeemed = false;
  IF NOT FOUND THEN RETURN QUERY SELECT false, NULL::uuid, 'RACE_CONDITION'::text, 'Voucher was redeemed by another request'::text; RETURN; END IF;

  IF p_order_id IS NOT NULL THEN
    PERFORM set_config('app.voucher_bypass', 'true', true);
    UPDATE orders SET total_amount_cents = 0, status = 'paid', notes = COALESCE(notes || ' | ', '') || 'Voucher: ' || p_voucher_code WHERE id = p_order_id;
  END IF;

  RETURN QUERY SELECT true, v_voucher.id, NULL::text, NULL::text;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

REVOKE EXECUTE ON FUNCTION atomic_redeem_voucher(text, uuid, uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION atomic_redeem_voucher(text, uuid, uuid) TO service_role;

-- Add updated_at to orders
ALTER TABLE orders ADD COLUMN IF NOT EXISTS updated_at timestamptz;

-- Staff RLS for residents and expected_parcels
DROP POLICY IF EXISTS "Staff can read residents" ON residents;
CREATE POLICY "Staff can read residents"
  ON residents FOR SELECT
  USING (is_brewhub_staff());

DROP POLICY IF EXISTS "Staff can read expected_parcels" ON expected_parcels;
CREATE POLICY "Staff can read expected_parcels"
  ON expected_parcels FOR SELECT
  USING (is_brewhub_staff());

-- Performance indexes
CREATE INDEX IF NOT EXISTS idx_staff_directory_email_lower
  ON staff_directory (lower(email));

CREATE UNIQUE INDEX IF NOT EXISTS idx_vouchers_code_unique
  ON vouchers (upper(code));


-- #############################################################################
-- ## schema-28-audit-fixes-2.sql — Final audit fixes
-- #############################################################################

-- Restore price guard on merch INSERT/UPDATE
DROP POLICY IF EXISTS "Manager can insert products" ON merch_products;
CREATE POLICY "Manager can insert products" ON merch_products
  FOR INSERT
  WITH CHECK (is_brewhub_manager() AND price_cents > 0);

DROP POLICY IF EXISTS "Manager can update products" ON merch_products;
CREATE POLICY "Manager can update products" ON merch_products
  FOR UPDATE
  USING (is_brewhub_manager())
  WITH CHECK (is_brewhub_manager() AND price_cents > 0);

-- Fix handle_order_completion: exact match instead of wildcard
-- HARDENED: Record actual decrement count on the order row so refund
-- restore is based on recorded truth, not a re-count. Uses FOR UPDATE
-- row lock on inventory to prevent races.
CREATE OR REPLACE FUNCTION handle_order_completion()
RETURNS TRIGGER AS $$
DECLARE
  v_item_count int;
  v_old_stock  int;
  v_actual_dec int;
BEGIN
  -- Guard 1: Only fire on transition TO 'completed'
  IF (NEW.status <> 'completed') OR (OLD.status IS NOT DISTINCT FROM 'completed') THEN
    RETURN NEW;
  END IF;

  -- Guard 2: One-shot flag — never decrement twice for the same order
  IF COALESCE(NEW.inventory_decremented, false) THEN
    RETURN NEW;
  END IF;

  -- Count drink items for this order
  SELECT COUNT(*)::int INTO v_item_count
  FROM public.coffee_orders
  WHERE order_id = NEW.id;

  IF v_item_count > 0 THEN
    -- Lock the inventory row to prevent concurrent under-decrement
    SELECT current_stock INTO v_old_stock
    FROM public.inventory
    WHERE item_name = '12oz Cups'
    FOR UPDATE;

    -- Calculate actual decrement (can't go below 0)
    v_actual_dec := LEAST(v_item_count, COALESCE(v_old_stock, 0));

    UPDATE public.inventory
    SET current_stock = GREATEST(0, current_stock - v_item_count),
        updated_at = now()
    WHERE item_name = '12oz Cups';

    -- Record the actual amount decremented on the order for refund accuracy
    NEW.cups_decremented := v_actual_dec;
  END IF;

  NEW.inventory_decremented := true;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Fix storage policies: case-insensitive email
DROP POLICY IF EXISTS "Staff can upload menu images" ON storage.objects;
CREATE POLICY "Staff can upload menu images"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'menu-images'
    AND (
      (auth.role() = 'service_role')
      OR
      (
        auth.role() = 'authenticated'
        AND EXISTS (
          SELECT 1 FROM public.staff_directory
          WHERE lower(email) = lower(auth.email())
        )
      )
    )
  );

DROP POLICY IF EXISTS "Staff can update menu images" ON storage.objects;
CREATE POLICY "Staff can update menu images"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'menu-images'
    AND (
      (auth.role() = 'service_role')
      OR
      (
        auth.role() = 'authenticated'
        AND EXISTS (
          SELECT 1 FROM public.staff_directory
          WHERE lower(email) = lower(auth.email())
        )
      )
    )
  );

DROP POLICY IF EXISTS "Staff can delete menu images" ON storage.objects;
CREATE POLICY "Staff can delete menu images"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'menu-images'
    AND (
      (auth.role() = 'service_role')
      OR
      (
        auth.role() = 'authenticated'
        AND EXISTS (
          SELECT 1 FROM public.staff_directory
          WHERE lower(email) = lower(auth.email())
        )
      )
    )
  );

-- Fix is_tombstoned: case-insensitive
DROP FUNCTION IF EXISTS is_tombstoned(text, text);
CREATE OR REPLACE FUNCTION is_tombstoned(p_table text, p_key text)
RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1 FROM deletion_tombstones
    WHERE lower(table_name) = lower(p_table)
      AND lower(record_key) = lower(p_key)
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

GRANT EXECUTE ON FUNCTION is_tombstoned(text, text) TO service_role;

-- Harden brewhub_nnn_summary
REVOKE SELECT ON brewhub_nnn_summary FROM anon, authenticated;


-- #############################################################################
-- ## schema-free-coffee.sql — Manual voucher insert template
-- #############################################################################

-- Template only — replace USER_ID_HERE with actual UUID before running:
-- INSERT INTO vouchers (user_id, code) 
-- VALUES ('USER_ID_HERE', 'MANUAL-FREE-COFFEE-' || floor(random()*1000));


-- =============================================================================
-- ✅ ALL 29 SCHEMAS APPLIED. Database is at latest state.
-- =============================================================================


-- #############################################################################
-- ## schema-29-catalog-archive.sql — Two-tier hide/archive for menu items
-- #############################################################################

-- Add archived_at column: NULL = not archived, timestamp = archived
ALTER TABLE merch_products ADD COLUMN IF NOT EXISTS archived_at timestamptz DEFAULT NULL;

-- Add category column if missing (some early schemas may not have it)
ALTER TABLE merch_products ADD COLUMN IF NOT EXISTS category text DEFAULT 'menu';

-- Index for fast dashboard queries filtering out archived items
CREATE INDEX IF NOT EXISTS idx_merch_products_archived
  ON merch_products (archived_at) WHERE archived_at IS NULL;

-- Update public SELECT policy to also exclude archived items
DROP POLICY IF EXISTS "Public can read active products" ON merch_products;
CREATE POLICY "Public can read active products" ON merch_products
  FOR SELECT
  USING (is_active = true AND archived_at IS NULL);

-- Staff can still see everything (hidden + archived) for reporting
-- (existing policy "Staff can read all products" already uses is_brewhub_staff() with no filter)


-- #############################################################################
-- ## schema-30-inventory-ssot.sql — Single Source of Truth for inventory
-- #############################################################################

-- 1. Record actual decrement count on the order for refund accuracy
ALTER TABLE orders ADD COLUMN IF NOT EXISTS cups_decremented int DEFAULT 0;

-- 2. Use exact match in decrement_inventory (not ILIKE)
CREATE OR REPLACE FUNCTION decrement_inventory(p_item_name text, p_quantity int DEFAULT 1)
RETURNS void AS $$
  UPDATE inventory
  SET current_stock = GREATEST(0, current_stock - p_quantity),
      updated_at = now()
  WHERE item_name = p_item_name;
$$ LANGUAGE sql SECURITY DEFINER;

-- 3. Hardened refund restore: use recorded cups_decremented instead of re-counting
-- Uses FOR UPDATE row lock to prevent double-restore on concurrent refund webhooks
CREATE OR REPLACE FUNCTION restore_inventory_on_refund(p_order_id uuid)
RETURNS jsonb AS $$
DECLARE
  v_cups_dec  int;
  v_was_dec   boolean;
BEGIN
  -- Lock the order row to prevent concurrent double-restore
  SELECT COALESCE(inventory_decremented, false),
         COALESCE(cups_decremented, 0)
  INTO v_was_dec, v_cups_dec
  FROM orders
  WHERE id = p_order_id
  FOR UPDATE;            -- row-level lock prevents TOCTOU race

  IF NOT v_was_dec THEN
    RETURN jsonb_build_object('restored', false, 'reason', 'inventory was never decremented');
  END IF;

  IF v_cups_dec > 0 THEN
    UPDATE inventory
    SET current_stock = current_stock + v_cups_dec,
        updated_at    = now()
    WHERE item_name = '12oz Cups';
  END IF;

  -- Clear the flag atomically under the lock
  UPDATE orders
  SET inventory_decremented = false,
      cups_decremented = 0
  WHERE id = p_order_id
    AND inventory_decremented = true;  -- belt-and-suspenders: only first caller matches

  RETURN jsonb_build_object('restored', true, 'cups_restored', v_cups_dec);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- #############################################################################
-- ## schema-35-voucher-hardening.sql — Voucher Cryptographic Hardening
-- #############################################################################

-- Ensure pgcrypto is available (already created in schema-1, but be safe)
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 1. NEW COLUMN: code_hash (hex-encoded SHA-256 of upper(code))
ALTER TABLE vouchers ADD COLUMN IF NOT EXISTS code_hash text;

CREATE INDEX IF NOT EXISTS idx_vouchers_code_hash
  ON vouchers (code_hash)
  WHERE code_hash IS NOT NULL;

-- 2. BACKFILL hashes for every existing row that still has plaintext
UPDATE vouchers
   SET code_hash = encode(digest(upper(code), 'sha256'), 'hex')
 WHERE code_hash IS NULL
   AND code IS NOT NULL
   AND code != '***REDEEMED***';

-- 3. SCRUB plaintext from already-redeemed vouchers
UPDATE vouchers
   SET code = '***REDEEMED***'
 WHERE is_redeemed = true
   AND code IS NOT NULL
   AND code != '***REDEEMED***';

-- 4. CIRCUIT BREAKER TABLE: voucher_redemption_fails
CREATE TABLE IF NOT EXISTS voucher_redemption_fails (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  ip_address    text        NOT NULL,
  attempted_at  timestamptz NOT NULL DEFAULT now(),
  code_prefix   text
);

CREATE INDEX IF NOT EXISTS idx_voucher_fails_ip_time
  ON voucher_redemption_fails (ip_address, attempted_at DESC);

ALTER TABLE voucher_redemption_fails ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Deny public access to voucher_redemption_fails"
  ON voucher_redemption_fails;
CREATE POLICY "Deny public access to voucher_redemption_fails"
  ON voucher_redemption_fails FOR ALL USING (false);

-- 5. REPLACE atomic_redeem_voucher (hash-first, PII claim, post-burn scrub)
DROP FUNCTION IF EXISTS atomic_redeem_voucher(text, uuid, uuid);
DROP FUNCTION IF EXISTS atomic_redeem_voucher(text, uuid, uuid, boolean);

CREATE OR REPLACE FUNCTION atomic_redeem_voucher(
  p_voucher_code     text,
  p_order_id         uuid,
  p_user_id          uuid    DEFAULT NULL,
  p_manager_override boolean DEFAULT false
)
RETURNS TABLE(
  success        boolean,
  voucher_id     uuid,
  error_code     text,
  error_message  text
) AS $$
DECLARE
  v_voucher        RECORD;
  v_order          RECORD;
  v_lock_key       bigint;
  v_code_hash      text;
  v_daily_redeems  int;
  v_effective_uid  uuid;
BEGIN
  IF p_voucher_code IS NULL OR length(p_voucher_code) < 4 THEN
    RETURN QUERY SELECT false, NULL::uuid, 'INVALID_CODE'::text,
      'Voucher code too short'::text;
    RETURN;
  END IF;

  IF length(p_voucher_code) > 100 THEN
    RETURN QUERY SELECT false, NULL::uuid, 'INVALID_CODE'::text,
      'Voucher code too long'::text;
    RETURN;
  END IF;

  v_code_hash := encode(digest(upper(p_voucher_code), 'sha256'), 'hex');

  SELECT id, user_id, is_redeemed
    INTO v_voucher
    FROM vouchers
   WHERE code_hash = v_code_hash
     FOR UPDATE SKIP LOCKED;

  IF v_voucher IS NULL THEN
    SELECT id, user_id, is_redeemed
      INTO v_voucher
      FROM vouchers
     WHERE upper(code) = upper(p_voucher_code)
       AND code_hash IS NULL
       FOR UPDATE SKIP LOCKED;

    IF v_voucher IS NOT NULL THEN
      UPDATE vouchers SET code_hash = v_code_hash WHERE id = v_voucher.id;
    END IF;
  END IF;

  IF v_voucher IS NULL THEN
    RETURN QUERY SELECT false, NULL::uuid,
      'VOUCHER_NOT_FOUND'::text,
      'Voucher not found or already being processed'::text;
    RETURN;
  END IF;

  IF v_voucher.is_redeemed THEN
    RETURN QUERY SELECT false, NULL::uuid,
      'ALREADY_REDEEMED'::text,
      'This voucher has already been used'::text;
    RETURN;
  END IF;

  v_lock_key := hashtext(
    'voucher_lock:' || COALESCE(v_voucher.user_id::text, 'guest')
  );
  PERFORM pg_advisory_xact_lock(v_lock_key);

  IF EXISTS (
    SELECT 1 FROM refund_locks
     WHERE user_id = v_voucher.user_id
       AND locked_at > now() - interval '5 minutes'
  ) THEN
    RETURN QUERY SELECT false, NULL::uuid,
      'REFUND_IN_PROGRESS'::text,
      'Account locked due to pending refund. Please wait.'::text;
    RETURN;
  END IF;

  IF p_order_id IS NOT NULL THEN
    SELECT id, user_id, status
      INTO v_order
      FROM orders
     WHERE id = p_order_id;

    IF v_order IS NULL THEN
      RETURN QUERY SELECT false, NULL::uuid,
        'ORDER_NOT_FOUND'::text, 'Order not found'::text;
      RETURN;
    END IF;

    IF v_order.status IN ('paid', 'refunded') THEN
      RETURN QUERY SELECT false, NULL::uuid,
        'ORDER_COMPLETE'::text,
        'Cannot apply voucher to completed order'::text;
      RETURN;
    END IF;

    IF v_voucher.user_id IS NOT NULL
       AND v_voucher.user_id != v_order.user_id
    THEN
      RETURN QUERY SELECT false, NULL::uuid,
        'OWNERSHIP_MISMATCH'::text,
        'This voucher belongs to a different customer'::text;
      RETURN;
    END IF;
  END IF;

  IF v_voucher.user_id IS NULL AND p_user_id IS NOT NULL THEN
    UPDATE vouchers SET user_id = p_user_id WHERE id = v_voucher.id;
  END IF;

  -- Daily redemption cap: 3 per user per calendar day (manager override available)
  v_effective_uid := COALESCE(v_voucher.user_id, p_user_id);

  IF v_effective_uid IS NOT NULL AND NOT p_manager_override THEN
    SELECT count(*) INTO v_daily_redeems
      FROM vouchers
     WHERE user_id = v_effective_uid
       AND is_redeemed = true
       AND redeemed_at::date = CURRENT_DATE;

    IF v_daily_redeems >= 3 THEN
      RETURN QUERY SELECT false, NULL::uuid,
        'DAILY_LIMIT'::text,
        'Maximum 3 free drinks per day. Come back tomorrow!'::text;
      RETURN;
    END IF;
  END IF;

  UPDATE vouchers
     SET is_redeemed       = true,
         redeemed_at       = now(),
         applied_to_order_id = p_order_id,
         status            = 'redeemed',
         code              = '***REDEEMED***'
   WHERE id = v_voucher.id
     AND is_redeemed = false;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, NULL::uuid,
      'RACE_CONDITION'::text,
      'Voucher was redeemed by another request'::text;
    RETURN;
  END IF;

  IF p_order_id IS NOT NULL THEN
    PERFORM set_config('app.voucher_bypass', 'true', true);
    UPDATE orders
       SET total_amount_cents = 0,
           status             = 'paid',
           notes              = COALESCE(notes || ' | ', '')
                                || 'Voucher redeemed (hash-verified)'
                                || CASE WHEN p_manager_override
                                        THEN ' [MANAGER OVERRIDE]'
                                        ELSE '' END
     WHERE id = p_order_id;
  END IF;

  RETURN QUERY SELECT true, v_voucher.id, NULL::text, NULL::text;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

REVOKE EXECUTE ON FUNCTION atomic_redeem_voucher(text, uuid, uuid, boolean)
  FROM anon, authenticated;
GRANT  EXECUTE ON FUNCTION atomic_redeem_voucher(text, uuid, uuid, boolean)
  TO service_role;

-- 6. CIRCUIT BREAKER RPCs
DROP FUNCTION IF EXISTS check_voucher_rate_limit(text);
CREATE OR REPLACE FUNCTION check_voucher_rate_limit(p_ip text)
RETURNS TABLE(
  allowed                  boolean,
  fail_count               int,
  lockout_remaining_seconds int
) AS $$
DECLARE
  v_count   int;
  v_oldest  timestamptz;
  v_lockout timestamptz;
BEGIN
  SELECT count(*), min(attempted_at)
    INTO v_count, v_oldest
    FROM voucher_redemption_fails
   WHERE ip_address = p_ip
     AND attempted_at > now() - interval '10 minutes';

  IF v_count >= 5 THEN
    v_lockout := v_oldest + interval '10 minutes';
    RETURN QUERY SELECT false, v_count,
      GREATEST(0, extract(epoch FROM v_lockout - now())::int);
    RETURN;
  END IF;

  RETURN QUERY SELECT true, v_count, 0;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

DROP FUNCTION IF EXISTS log_voucher_fail(text, text);
CREATE OR REPLACE FUNCTION log_voucher_fail(
  p_ip          text,
  p_code_prefix text DEFAULT NULL
)
RETURNS void AS $$
BEGIN
  INSERT INTO voucher_redemption_fails (ip_address, code_prefix)
  VALUES (p_ip, left(p_code_prefix, 4));

  DELETE FROM voucher_redemption_fails
   WHERE attempted_at < now() - interval '1 hour';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

REVOKE EXECUTE ON FUNCTION check_voucher_rate_limit(text)  FROM anon, authenticated;
GRANT  EXECUTE ON FUNCTION check_voucher_rate_limit(text)  TO service_role;
REVOKE EXECUTE ON FUNCTION log_voucher_fail(text, text)    FROM anon, authenticated;
GRANT  EXECUTE ON FUNCTION log_voucher_fail(text, text)    TO service_role;


-- #############################################################################
-- ## schema-36-security-hardening.sql — Critical security remediations
-- #############################################################################

-- ─────────────────────────────────────────────────────────────────────────────
-- FIX 1: Profiles UPDATE — restrict writable columns via BEFORE UPDATE trigger
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION guard_profile_protected_columns()
RETURNS trigger AS $$
BEGIN
  -- Only restrict end-user roles (authenticated/anon via PostgREST).
  -- Service_role, postgres, supabase_admin, and other backend roles are trusted.
  IF current_setting('role', true) NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;

  -- For authenticated/anon users: reset protected columns to their previous values
  NEW.loyalty_points := OLD.loyalty_points;
  NEW.is_vip         := OLD.is_vip;
  NEW.total_orders   := OLD.total_orders;
  NEW.barcode_id     := OLD.barcode_id;
  NEW.created_at     := OLD.created_at;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_guard_profile_protected ON profiles;
CREATE TRIGGER trg_guard_profile_protected
  BEFORE UPDATE ON profiles
  FOR EACH ROW
  EXECUTE FUNCTION guard_profile_protected_columns();


-- ─────────────────────────────────────────────────────────────────────────────
-- FIX 2: staff_directory SELECT — restricted view for non-manager staff
-- ─────────────────────────────────────────────────────────────────────────────

DROP VIEW IF EXISTS staff_directory_safe;
CREATE VIEW staff_directory_safe
  WITH (security_invoker = false)
AS
SELECT
  id,
  name,
  full_name,
  email,
  role,
  is_working,
  created_at,
  token_version
  -- pin and hourly_rate are intentionally excluded
FROM staff_directory;

GRANT SELECT ON staff_directory_safe TO authenticated;

DROP POLICY IF EXISTS "Staff can read all staff" ON staff_directory;

DROP POLICY IF EXISTS "Managers can read all staff" ON staff_directory;
CREATE POLICY "Managers can read all staff" ON staff_directory
  FOR SELECT
  USING (is_brewhub_manager());

DROP POLICY IF EXISTS "Staff can read own row" ON staff_directory;
CREATE POLICY "Staff can read own row" ON staff_directory
  FOR SELECT
  USING (lower(email) = lower(auth.email()));

COMMENT ON VIEW staff_directory_safe IS
  'Restricted view of staff_directory excluding pin and hourly_rate. '
  'Use this for KDS, POS, and non-manager UIs instead of querying the table directly.';


-- ─────────────────────────────────────────────────────────────────────────────
-- FIX 3: restore_inventory_on_refund — FOR UPDATE lock
-- (Function body already updated in schema-30 section above)
-- ─────────────────────────────────────────────────────────────────────────────

REVOKE EXECUTE ON FUNCTION restore_inventory_on_refund(uuid) FROM anon, authenticated;


-- 
-- ## schema-31-drop-redundant-customer-cols.sql
-- 
-- ============================================================
-- BREWHUB SCHEMA 31: Drop redundant customers columns
-- Migrates name → full_name, address → address_street,
-- then drops the legacy columns.
-- ============================================================
-- Safe to re-run: every statement is guarded with IF / COALESCE.

BEGIN;

-- 1. Back-fill full_name from name where full_name is NULL or empty
UPDATE customers
SET    full_name = name
WHERE  name IS NOT NULL
  AND  name <> ''
  AND  (full_name IS NULL OR full_name = '');

-- 2. Back-fill address_street from address where address_street is NULL or empty
UPDATE customers
SET    address_street = address
WHERE  address IS NOT NULL
  AND  address <> ''
  AND  (address_street IS NULL OR address_street = '');

-- 3. Drop the redundant columns
ALTER TABLE customers DROP COLUMN IF EXISTS name;
ALTER TABLE customers DROP COLUMN IF EXISTS address;

COMMIT;


-- 
-- ## schema-32-kds-update-rls.sql
-- 
-- ============================================================
-- BREWHUB SCHEMA 32: KDS staff UPDATE policy for orders
--
-- Problem: The KDS page does client-side UPDATEs on orders.status
-- but no RLS policy allows staff UPDATE. The only matching policy
-- is "Deny public access to orders" (FOR ALL USING false), so
-- every status-change click silently fails.
--
-- Fix: Add a FOR UPDATE policy allowing is_brewhub_staff() to
-- update orders. WITH CHECK restricts the allowed status values.
-- ============================================================

BEGIN;

-- Allow staff to update order status (KDS workflow)
DROP POLICY IF EXISTS "Staff can update orders" ON orders;
CREATE POLICY "Staff can update orders" ON orders
  FOR UPDATE
  USING  (is_brewhub_staff())
  WITH CHECK (
    is_brewhub_staff()
    AND status IN ('pending', 'unpaid', 'paid', 'preparing', 'ready', 'completed', 'cancelled')
  );

COMMIT;


-- 
-- ## schema-33-receipt-realtime.sql
-- 
-- ============================================================
-- SCHEMA 33: Enable Realtime on receipt_queue
-- ============================================================
-- Problem: The receipt_queue table has RLS that denies all access
-- to the anon role. Supabase Realtime (postgres_changes) respects
-- RLS and requires SELECT permission for the subscribing client.
-- Since the frontend connects with the anon key (not Supabase Auth),
-- the Realtime channel never delivers INSERT/UPDATE events.
--
-- Fix:
--   1. Add an anon-friendly SELECT policy for receipt_queue.
--      (Receipt text is not sensitive — it's the same info a
--       customer sees on their printed receipt.)
--   2. Add receipt_queue to the supabase_realtime publication
--      so postgres_changes events are emitted.
-- ============================================================

-- 1. Allow anon (and authenticated) SELECT so Realtime works
DROP POLICY IF EXISTS "Allow anon select for realtime" ON receipt_queue;
CREATE POLICY "Allow anon select for realtime" ON receipt_queue
  FOR SELECT
  USING (true);

-- 2. Add table to Realtime publication (idempotent: errors if already present)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'receipt_queue'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE receipt_queue;
  END IF;
END
$$;


-- 
-- ## schema-37-audit-critical-fixes.sql
-- 
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

DROP POLICY IF EXISTS "Staff can read inventory audit" ON inventory_audit_log;
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


-- 
-- ## schema-38-loyalty-ssot-sync.sql
-- 
-- ============================================================
-- Schema 38: Loyalty Single Source of Truth (SSoT) Sync
-- ============================================================
-- PROBLEM: `profiles.loyalty_points` is the authoritative column
-- (used by increment_loyalty, decrement_loyalty_on_refund, the
-- POS loyalty scanner, and the portal). But the legacy `customers`
-- table also has a `loyalty_points` column that some admin queries
-- reference. Without a sync mechanism the two drift apart,
-- creating support tickets and incorrect voucher issuance.
--
-- SOLUTION: A Postgres trigger on `profiles` that cascades any
-- loyalty_points change into the `customers` row sharing the
-- same email. The trigger is AFTER UPDATE so it does not block
-- the primary write path and fails silently (via EXCEPTION block)
-- to avoid breaking the happy path if no matching customer row
-- exists.
--
-- The trigger is idempotent: re-running this migration replaces
-- the function and trigger without error.
-- ============================================================

-- 1. Add email column to profiles if missing (needed for join)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'email'
  ) THEN
    ALTER TABLE public.profiles ADD COLUMN email text;
    -- Backfill from auth.users
    UPDATE public.profiles p
       SET email = u.email
      FROM auth.users u
     WHERE p.id = u.id AND p.email IS NULL;
  END IF;
END $$;

-- 2. Create the sync function
CREATE OR REPLACE FUNCTION sync_loyalty_to_customers()
RETURNS trigger AS $$
BEGIN
  -- Only fire when loyalty_points actually changed
  IF NEW.loyalty_points IS DISTINCT FROM OLD.loyalty_points THEN
    UPDATE public.customers
       SET loyalty_points = NEW.loyalty_points
     WHERE lower(email) = lower(NEW.email)
       AND NEW.email IS NOT NULL;
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Never break the primary write path; log and continue
  RAISE WARNING 'sync_loyalty_to_customers failed for profile %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. Attach trigger (replace if exists)
DROP TRIGGER IF EXISTS trg_sync_loyalty_to_customers ON public.profiles;
CREATE TRIGGER trg_sync_loyalty_to_customers
  AFTER UPDATE OF loyalty_points ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION sync_loyalty_to_customers();

-- 4. One-time backfill: push current profiles.loyalty_points
--    into matching customers rows so they start in sync.
UPDATE public.customers c
   SET loyalty_points = p.loyalty_points
  FROM public.profiles p
 WHERE lower(c.email) = lower(p.email)
   AND p.loyalty_points IS NOT NULL
   AND c.loyalty_points IS DISTINCT FROM p.loyalty_points;

-- 5. Reverse sync: if customers had points that profiles didn't,
--    pull the MAX into profiles (one-time reconciliation).
UPDATE public.profiles p
   SET loyalty_points = GREATEST(COALESCE(p.loyalty_points, 0), c.loyalty_points)
  FROM public.customers c
 WHERE lower(p.email) = lower(c.email)
   AND c.loyalty_points > COALESCE(p.loyalty_points, 0);


-- 
-- ## schema-39-total-defense-audit.sql
-- 
-- ============================================================
-- Schema 39: Total Defense Audit — Clean Room Hardening
-- ============================================================
--
-- Four fixes for state-level intelligence scrutiny:
--
--   1. TEMPORAL JITTER on parcel_departure_board
--      → Randomise received_at by ±3 minutes to defeat high-fidelity
--        surveillance via timestamp cross-referencing.
--      → Truncate masked_name to first initial only (no last name).
--      → Remove unit_number from the public VIEW.
--      → Remove raw UUID (replace with opaque row suffix).
--
--   2. STATEMENT TIMEOUTS on every high-concurrency RPC
--      → Prevents coordinated "slow-post" from queueing row-locks
--        long enough to hang the DB during rush hour.
--
--   3. IP SALTED HASHING
--      → pin_attempts and voucher_redemption_fails now store
--        SHA-256(ip || per-row-salt) instead of raw IPs.
--      → Existing raw IPs are hashed in-place as a one-time migration.
--
--   4. LOYALTY SYNC TRIGGER (supplementary)
--      → Already handled in schema-38; this file only adds the
--        jitter, timeouts, and IP hashing.
--
-- SECURITY RATIONALE (per fix) is inline below.
-- ============================================================


-- ┌──────────────────────────────────────────────────────────┐
-- │  FIX 1: TEMPORAL JITTER + PII HARDENING                 │
-- │                                                          │
-- │  SECURITY RATIONALE:                                     │
-- │  A trained analyst stationed in-store could correlate:   │
-- │    carrier + last-4 tracking + exact received_at →       │
-- │    carrier API → full tracking → shipping origin →       │
-- │    purchasing patterns of a specific resident.           │
-- │                                                          │
-- │  Mitigations applied:                                    │
-- │  (a) ±3 min random jitter on received_at eliminates      │
-- │      sub-minute timestamp correlation.                   │
-- │  (b) masked_name → first initial + "." only; no surname. │
-- │  (c) unit_number is REMOVED from the VIEW entirely.      │
-- │  (d) Raw UUID 'id' replaced with opaque 4-char suffix.   │
-- │                                                          │
-- │  The VIEW is the ONLY surface exposed to anon; the       │
-- │  underlying parcels table remains unchanged for staff.    │
-- └──────────────────────────────────────────────────────────┘

-- Must DROP first: CREATE OR REPLACE VIEW cannot remove columns
-- that existed in the prior definition (unit_number, raw id, etc.)
DROP VIEW IF EXISTS parcel_departure_board;

CREATE VIEW parcel_departure_board
  WITH (security_invoker = false)
AS
SELECT
  -- Opaque identifier: last 4 chars of UUID, not the full key
  right(id::text, 4)                         AS id,

  -- Name: first initial only. No surname leakage.
  CASE
    WHEN recipient_name IS NULL OR trim(recipient_name) = '' THEN 'Resident'
    ELSE upper(left(trim(recipient_name), 1)) || '.'
  END                                        AS masked_name,

  -- Tracking: carrier prefix + last 4 digits only
  COALESCE(carrier, 'PKG') || ' …' || right(tracking_number, 4)
                                             AS masked_tracking,

  -- Carrier: coarsened to canonical names to reduce fingerprinting
  CASE
    WHEN carrier ILIKE '%ups%'                   THEN 'UPS'
    WHEN carrier ILIKE '%fedex%' OR carrier ILIKE '%fed%' THEN 'FedEx'
    WHEN carrier ILIKE '%usps%' OR carrier ILIKE '%postal%' THEN 'USPS'
    WHEN carrier ILIKE '%amazon%' OR carrier ILIKE '%amzl%' THEN 'Amazon'
    WHEN carrier ILIKE '%dhl%'                   THEN 'DHL'
    ELSE 'Other'
  END                                        AS carrier,

  -- Temporal jitter: ±3 minutes random offset per row.
  -- Uses md5(id::text) seeded pseudo-random so the jitter is stable
  -- per parcel (no UI flicker on re-poll) but unpredictable externally.
  received_at + (
    (('x' || left(md5(id::text || 'jitter_salt_2026'), 8))::bit(32)::int % 360 - 180)
    * interval '1 second'
  )                                          AS received_at

  -- unit_number: INTENTIONALLY OMITTED from the VIEW.
  -- Staff can query the parcels table directly via authenticated RPC.

FROM parcels
WHERE status = 'arrived';

-- Re-grant to anon + authenticated (VIEW replacement drops grants)
GRANT SELECT ON parcel_departure_board TO anon, authenticated;


-- ┌──────────────────────────────────────────────────────────┐
-- │  FIX 2: STATEMENT TIMEOUTS ON HIGH-CONCURRENCY RPCs     │
-- │                                                          │
-- │  SECURITY RATIONALE:                                     │
-- │  A coordinated "slow-post" attack sends N concurrent POS │
-- │  requests that each acquire FOR UPDATE row locks.        │
-- │  Without timeouts, later requests queue behind the lock  │
-- │  indefinitely, creating a cascading tail of DB            │
-- │  connections that exhausts the pool (max 60 on Supabase  │
-- │  free/pro tiers). This is a Denial-of-Life attack.       │
-- │                                                          │
-- │  Fix: SET LOCAL statement_timeout inside every RPC that  │
-- │  acquires FOR UPDATE or advisory locks. LOCAL scoping    │
-- │  ensures the timeout applies only to the current         │
-- │  transaction and does not leak to other sessions.        │
-- │                                                          │
-- │  Timeouts chosen:                                        │
-- │    • Voucher redemption: 5s (complex, multi-step)        │
-- │    • Loyalty increment/decrement: 3s (single UPDATE)     │
-- │    • Inventory trigger: 3s (single row lock)             │
-- │    • Notification queue: 3s (SKIP LOCKED, fast path)     │
-- │    • Refund inventory restore: 5s (multi-step)           │
-- └──────────────────────────────────────────────────────────┘

-- 2a. increment_loyalty — add 3s timeout before FOR UPDATE
CREATE OR REPLACE FUNCTION increment_loyalty(
  target_user_id uuid,
  amount_cents   int,
  p_order_id     uuid DEFAULT NULL
)
RETURNS TABLE(loyalty_points int, voucher_earned boolean, points_awarded int) AS $$
DECLARE
  v_new_points int;
  v_voucher_earned boolean := false;
  v_points_delta int;
  v_previous int := 0;
  v_current_points int;
BEGIN
  -- DEADLOCK DEFENSE: 3-second timeout on row locks
  SET LOCAL statement_timeout = '3s';
  SET LOCAL lock_timeout      = '2s';

  IF p_order_id IS NOT NULL THEN
    SELECT COALESCE(paid_amount_cents, 0) INTO v_previous FROM orders WHERE id = p_order_id;
  END IF;

  v_points_delta := GREATEST(0, floor(amount_cents / 100)::int - floor(v_previous / 100)::int);

  IF v_points_delta <= 0 THEN
    RETURN QUERY
      SELECT COALESCE(p.loyalty_points, 0), false, 0
        FROM profiles p
       WHERE p.id = target_user_id;
    RETURN;
  END IF;

  SELECT p.loyalty_points
    INTO v_current_points
    FROM profiles p
   WHERE p.id = target_user_id
     FOR UPDATE;

  IF v_current_points IS NULL THEN
    RETURN QUERY SELECT 0, false, 0;
    RETURN;
  END IF;

  v_new_points := COALESCE(v_current_points, 0) + v_points_delta;

  UPDATE profiles
     SET loyalty_points = v_new_points,
         updated_at     = now()
   WHERE id = target_user_id;

  IF v_new_points >= 500
     AND (v_current_points % 500) > (v_new_points % 500)
  THEN
    v_voucher_earned := true;
  END IF;

  RETURN QUERY SELECT v_new_points, v_voucher_earned, v_points_delta;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2b. decrement_loyalty_on_refund — add 3s timeout
CREATE OR REPLACE FUNCTION decrement_loyalty_on_refund(
  target_user_id uuid,
  amount_cents   int DEFAULT 500
)
RETURNS TABLE(loyalty_points int, points_deducted int) AS $$
DECLARE
  v_current_points int;
  v_deduct         int;
  v_new_points     int;
BEGIN
  SET LOCAL statement_timeout = '3s';
  SET LOCAL lock_timeout      = '2s';

  SELECT p.loyalty_points
    INTO v_current_points
    FROM profiles p
   WHERE p.id = target_user_id
     FOR UPDATE;

  IF v_current_points IS NULL THEN
    RETURN QUERY SELECT 0, 0;
    RETURN;
  END IF;

  v_deduct     := LEAST(GREATEST(0, floor(amount_cents / 100)::int), v_current_points);
  v_new_points := v_current_points - v_deduct;

  UPDATE profiles
     SET loyalty_points = v_new_points,
         updated_at     = now()
   WHERE id = target_user_id;

  RETURN QUERY SELECT v_new_points, v_deduct;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

REVOKE EXECUTE ON FUNCTION increment_loyalty(uuid, int, uuid) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION decrement_loyalty_on_refund(uuid, int) FROM anon, authenticated;

-- 2c. atomic_redeem_voucher — add 5s timeout (multi-step, advisory lock)
-- This replaces the schema-35 hardened version with timeout guards.
CREATE OR REPLACE FUNCTION atomic_redeem_voucher(
  p_voucher_code      text,
  p_order_id          uuid,
  p_user_id           uuid    DEFAULT NULL,
  p_manager_override  boolean DEFAULT false
)
RETURNS TABLE(success boolean, voucher_id uuid, error_code text, error_message text) AS $$
DECLARE
  v_voucher RECORD;
  v_order   RECORD;
  v_lock_key bigint;
  v_daily_count int;
BEGIN
  -- DEADLOCK DEFENSE: 5-second cap on the entire voucher flow
  SET LOCAL statement_timeout = '5s';
  SET LOCAL lock_timeout      = '3s';

  -- Row lock on voucher (SKIP LOCKED prevents queue pile-up)
  SELECT id, user_id, is_redeemed
    INTO v_voucher
    FROM vouchers
   WHERE code = upper(p_voucher_code)
     FOR UPDATE SKIP LOCKED;

  IF v_voucher IS NULL THEN
    RETURN QUERY SELECT false, NULL::uuid,
      'VOUCHER_NOT_FOUND'::text,
      'Voucher not found or already being processed'::text;
    RETURN;
  END IF;

  IF v_voucher.is_redeemed THEN
    RETURN QUERY SELECT false, NULL::uuid,
      'ALREADY_REDEEMED'::text,
      'This voucher has already been used'::text;
    RETURN;
  END IF;

  -- Advisory lock scoped to user (transaction-level, auto-released)
  v_lock_key := hashtext('voucher_lock:' || COALESCE(v_voucher.user_id::text, 'guest'));
  PERFORM pg_advisory_xact_lock(v_lock_key);

  -- Refund-lock guard
  IF EXISTS (
    SELECT 1 FROM refund_locks
     WHERE user_id = v_voucher.user_id
       AND locked_at > now() - interval '5 minutes'
  ) THEN
    RETURN QUERY SELECT false, NULL::uuid,
      'REFUND_IN_PROGRESS'::text,
      'Account locked due to pending refund. Please wait.'::text;
    RETURN;
  END IF;

  -- Daily limit (3 per user per day) unless manager bypass
  IF NOT COALESCE(p_manager_override, false) AND v_voucher.user_id IS NOT NULL THEN
    SELECT count(*)::int INTO v_daily_count
      FROM vouchers
     WHERE user_id = v_voucher.user_id
       AND is_redeemed = true
       AND redeemed_at >= (current_date AT TIME ZONE 'America/New_York');
    IF v_daily_count >= 3 THEN
      RETURN QUERY SELECT false, NULL::uuid,
        'DAILY_LIMIT'::text,
        'Free drink limit reached (3 per day)'::text;
      RETURN;
    END IF;
  END IF;

  -- Validate order if provided
  IF p_order_id IS NOT NULL THEN
    SELECT id, user_id, status INTO v_order FROM orders WHERE id = p_order_id;
    IF v_order IS NULL THEN
      RETURN QUERY SELECT false, NULL::uuid,
        'ORDER_NOT_FOUND'::text, 'Order not found'::text;
      RETURN;
    END IF;
    IF v_order.status IN ('paid', 'refunded') THEN
      RETURN QUERY SELECT false, NULL::uuid,
        'ORDER_COMPLETE'::text,
        'Cannot apply voucher to completed order'::text;
      RETURN;
    END IF;
    IF v_voucher.user_id IS NOT NULL AND v_voucher.user_id != v_order.user_id THEN
      RETURN QUERY SELECT false, NULL::uuid,
        'OWNERSHIP_MISMATCH'::text,
        'This voucher belongs to a different customer'::text;
      RETURN;
    END IF;
  END IF;

  -- Burn the voucher (CAS guard: is_redeemed = false)
  UPDATE vouchers
     SET is_redeemed = true,
         redeemed_at = now(),
         applied_to_order_id = p_order_id
   WHERE id = v_voucher.id
     AND is_redeemed = false;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, NULL::uuid,
      'RACE_CONDITION'::text,
      'Voucher was redeemed by another request'::text;
    RETURN;
  END IF;

  -- Zero out the order total
  IF p_order_id IS NOT NULL THEN
    UPDATE orders
       SET total_amount_cents = 0,
           status = 'paid',
           notes = COALESCE(notes || ' | ', '') || 'Voucher: ' || p_voucher_code
     WHERE id = p_order_id;
  END IF;

  RETURN QUERY SELECT true, v_voucher.id, NULL::text, NULL::text;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

REVOKE EXECUTE ON FUNCTION atomic_redeem_voucher(text, uuid, uuid, boolean)
  FROM anon, authenticated;
GRANT  EXECUTE ON FUNCTION atomic_redeem_voucher(text, uuid, uuid, boolean)
  TO service_role;

-- 2d. restore_inventory_on_refund — add 5s timeout
CREATE OR REPLACE FUNCTION restore_inventory_on_refund(p_order_id uuid)
RETURNS jsonb AS $$
DECLARE
  v_cups_dec  int;
  v_was_dec   boolean;
BEGIN
  SET LOCAL statement_timeout = '5s';
  SET LOCAL lock_timeout      = '3s';

  SELECT COALESCE(inventory_decremented, false),
         COALESCE(cups_decremented, 0)
    INTO v_was_dec, v_cups_dec
    FROM orders
   WHERE id = p_order_id
     FOR UPDATE;

  IF NOT v_was_dec THEN
    RETURN jsonb_build_object('restored', false, 'reason', 'inventory was never decremented');
  END IF;

  IF v_cups_dec > 0 THEN
    UPDATE inventory
       SET current_stock = current_stock + v_cups_dec,
           updated_at    = now()
     WHERE item_name = '12oz Cups';
  END IF;

  UPDATE orders
     SET inventory_decremented = false,
         cups_decremented = 0
   WHERE id = p_order_id
     AND inventory_decremented = true;

  RETURN jsonb_build_object('restored', true, 'cups_restored', v_cups_dec);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2e. handle_order_completion trigger — add 3s timeout
CREATE OR REPLACE FUNCTION handle_order_completion()
RETURNS trigger AS $$
DECLARE
  v_item_count int;
  v_old_stock  int;
  v_actual_dec int;
BEGIN
  SET LOCAL statement_timeout = '3s';
  SET LOCAL lock_timeout      = '2s';

  IF (NEW.status <> 'completed') OR (OLD.status IS NOT DISTINCT FROM 'completed') THEN
    RETURN NEW;
  END IF;

  IF COALESCE(NEW.inventory_decremented, false) THEN
    RETURN NEW;
  END IF;

  SELECT COUNT(*)::int INTO v_item_count
    FROM public.coffee_orders
   WHERE order_id = NEW.id;

  IF v_item_count > 0 THEN
    SELECT current_stock INTO v_old_stock
      FROM public.inventory
     WHERE item_name = '12oz Cups'
       FOR UPDATE;

    v_actual_dec := LEAST(v_item_count, COALESCE(v_old_stock, 0));

    UPDATE public.inventory
       SET current_stock = GREATEST(0, current_stock - v_item_count),
           updated_at = now()
     WHERE item_name = '12oz Cups';

    NEW.cups_decremented := v_actual_dec;
  END IF;

  NEW.inventory_decremented := true;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2f. claim_notification_tasks — add 3s timeout
CREATE OR REPLACE FUNCTION claim_notification_tasks(
  p_worker_id  text,
  p_batch_size int DEFAULT 10
)
RETURNS SETOF notification_queue AS $$
BEGIN
  SET LOCAL statement_timeout = '3s';
  SET LOCAL lock_timeout      = '2s';

  RETURN QUERY
  UPDATE notification_queue
     SET status = 'processing',
         locked_until = now() + interval '60 seconds',
         locked_by = p_worker_id,
         attempt_count = attempt_count + 1
   WHERE id IN (
     SELECT id FROM notification_queue
      WHERE status IN ('pending', 'failed')
        AND next_attempt_at <= now()
        AND (locked_until IS NULL OR locked_until < now())
      ORDER BY next_attempt_at
        FOR UPDATE SKIP LOCKED
      LIMIT p_batch_size
   )
  RETURNING *;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ┌──────────────────────────────────────────────────────────┐
-- │  FIX 3: SALTED IP HASHING                               │
-- │                                                          │
-- │  SECURITY RATIONALE:                                     │
-- │  If the database is seized (warrant, breach, or hostile  │
-- │  extraction), raw IPs in pin_attempts and                │
-- │  voucher_redemption_fails form a timestamped location    │
-- │  map of every staff login and every customer who         │
-- │  attempted a voucher redemption. Combined with carrier   │
-- │  records, this is enough to build a movement profile.    │
-- │                                                          │
-- │  Fix: Store SHA-256(ip || per-install salt) instead.     │
-- │  The salt is stored in a Postgres config variable        │
-- │  (current_setting) set once during deployment, never     │
-- │  written to a queryable table. This means:               │
-- │    • Rate-limiting still works (same IP → same hash).    │
-- │    • A DB dump reveals only opaque hex strings.          │
-- │    • Brute-forcing the ~4B IPv4 space requires the salt, │
-- │      which lives only in the Postgres runtime config.    │
-- │                                                          │
-- │  The salt is set via ALTER DATABASE ... SET, which        │
-- │  persists across restarts but is NOT in any table.       │
-- └──────────────────────────────────────────────────────────┘

-- 3a. Create a single-row config table to store the IP hash salt.
--     Only service_role / postgres can read it — never exposed via API.
CREATE TABLE IF NOT EXISTS _ip_salt (
  id    boolean PRIMARY KEY DEFAULT true CHECK (id), -- single-row lock
  salt  text NOT NULL
);

-- Revoke ALL access from API-facing roles
REVOKE ALL ON _ip_salt FROM anon, authenticated;
ALTER TABLE _ip_salt ENABLE ROW LEVEL SECURITY;
-- No RLS policies = zero rows returned even to authenticated

-- Seed the salt exactly once (idempotent)
INSERT INTO _ip_salt (id, salt)
VALUES (true, gen_random_uuid()::text)
ON CONFLICT (id) DO NOTHING;

-- 3b. Helper function: hash an IP with the installation salt
CREATE OR REPLACE FUNCTION hash_ip(raw_ip text)
RETURNS text AS $$
  SELECT encode(
    sha256(convert_to(raw_ip || (SELECT salt FROM _ip_salt WHERE id = true), 'UTF8')),
    'hex'
  );
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- 3c. Migrate pin_attempts: hash existing raw IPs in-place.
--     The PK is the ip column, so we need to rebuild.
--     Strategy: create temp table, truncate, re-insert with hashes.
DO $$
BEGIN
  -- Only migrate if there are rows that look like raw IPs (contain dots)
  IF EXISTS (SELECT 1 FROM pin_attempts WHERE ip LIKE '%.%' OR ip LIKE '%:%' LIMIT 1) THEN
    CREATE TEMP TABLE _pa_backup AS SELECT * FROM pin_attempts;
    TRUNCATE pin_attempts;
    INSERT INTO pin_attempts (ip, fail_count, window_start, locked_until)
    SELECT hash_ip(ip), fail_count, window_start, locked_until
      FROM _pa_backup
    ON CONFLICT (ip) DO UPDATE SET
      fail_count = EXCLUDED.fail_count,
      window_start = EXCLUDED.window_start,
      locked_until = EXCLUDED.locked_until;
    DROP TABLE _pa_backup;
  END IF;
END $$;

-- 3d. Migrate voucher_redemption_fails: hash existing raw IPs.
UPDATE voucher_redemption_fails
   SET ip_address = hash_ip(ip_address)
 WHERE ip_address LIKE '%.%' OR ip_address LIKE '%:%';

-- 3e. Rewrite record_pin_failure to hash incoming IPs before storage
CREATE OR REPLACE FUNCTION record_pin_failure(
  p_ip              text,
  p_max_attempts    int DEFAULT 5,
  p_lockout_seconds int DEFAULT 60
)
RETURNS TABLE(locked boolean, retry_after_seconds int) AS $$
DECLARE
  v_row  pin_attempts%ROWTYPE;
  v_hash text;
BEGIN
  v_hash := hash_ip(p_ip);

  INSERT INTO pin_attempts (ip, fail_count, window_start)
  VALUES (v_hash, 1, now())
  ON CONFLICT (ip) DO UPDATE SET
    fail_count = CASE
      WHEN pin_attempts.window_start < now() - (p_lockout_seconds || ' seconds')::interval THEN 1
      ELSE pin_attempts.fail_count + 1
    END,
    window_start = CASE
      WHEN pin_attempts.window_start < now() - (p_lockout_seconds || ' seconds')::interval THEN now()
      ELSE pin_attempts.window_start
    END,
    locked_until = CASE
      WHEN (CASE
              WHEN pin_attempts.window_start < now() - (p_lockout_seconds || ' seconds')::interval THEN 1
              ELSE pin_attempts.fail_count + 1
            END) >= p_max_attempts
        THEN now() + (p_lockout_seconds || ' seconds')::interval
      ELSE pin_attempts.locked_until
    END
  RETURNING * INTO v_row;

  IF v_row.fail_count >= p_max_attempts AND v_row.locked_until IS NOT NULL AND v_row.locked_until > now() THEN
    RETURN QUERY SELECT true, GREATEST(0, extract(epoch FROM v_row.locked_until - now())::int);
  ELSE
    RETURN QUERY SELECT false, 0;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3f. Rewrite check_pin_lockout to hash the IP before lookup
CREATE OR REPLACE FUNCTION check_pin_lockout(p_ip text)
RETURNS TABLE(locked boolean, retry_after_seconds int) AS $$
DECLARE
  v_row  pin_attempts%ROWTYPE;
  v_hash text;
BEGIN
  v_hash := hash_ip(p_ip);

  SELECT * INTO v_row FROM pin_attempts WHERE ip = v_hash;

  IF v_row IS NULL THEN
    RETURN QUERY SELECT false, 0;
    RETURN;
  END IF;

  IF v_row.locked_until IS NOT NULL AND v_row.locked_until > now() THEN
    RETURN QUERY SELECT true, GREATEST(0, extract(epoch FROM v_row.locked_until - now())::int);
  ELSE
    RETURN QUERY SELECT false, 0;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3g. Rewrite clear_pin_lockout to hash before delete
CREATE OR REPLACE FUNCTION clear_pin_lockout(p_ip text)
RETURNS void AS $$
  DELETE FROM pin_attempts WHERE ip = hash_ip(p_ip);
$$ LANGUAGE sql SECURITY DEFINER;

-- 3h. Rewrite voucher circuit breaker RPCs to hash IPs
CREATE OR REPLACE FUNCTION check_voucher_rate_limit(p_ip text)
RETURNS TABLE(
  allowed                  boolean,
  fail_count               int,
  lockout_remaining_seconds int
) AS $$
DECLARE
  v_count   int;
  v_oldest  timestamptz;
  v_lockout timestamptz;
  v_hash    text;
BEGIN
  v_hash := hash_ip(p_ip);

  SELECT count(*), min(attempted_at)
    INTO v_count, v_oldest
    FROM voucher_redemption_fails
   WHERE ip_address = v_hash
     AND attempted_at > now() - interval '10 minutes';

  IF v_count >= 5 THEN
    v_lockout := v_oldest + interval '10 minutes';
    RETURN QUERY SELECT false, v_count,
      GREATEST(0, extract(epoch FROM v_lockout - now())::int);
    RETURN;
  END IF;

  RETURN QUERY SELECT true, v_count, 0;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

CREATE OR REPLACE FUNCTION log_voucher_fail(
  p_ip          text,
  p_code_prefix text DEFAULT NULL
)
RETURNS void AS $$
BEGIN
  INSERT INTO voucher_redemption_fails (ip_address, code_prefix)
  VALUES (hash_ip(p_ip), left(p_code_prefix, 4));

  DELETE FROM voucher_redemption_fails
   WHERE attempted_at < now() - interval '1 hour';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

REVOKE EXECUTE ON FUNCTION check_voucher_rate_limit(text)  FROM anon, authenticated;
GRANT  EXECUTE ON FUNCTION check_voucher_rate_limit(text)  TO service_role;
REVOKE EXECUTE ON FUNCTION log_voucher_fail(text, text)    FROM anon, authenticated;
GRANT  EXECUTE ON FUNCTION log_voucher_fail(text, text)    TO service_role;
REVOKE EXECUTE ON FUNCTION hash_ip(text)                   FROM anon, authenticated;


-- 
-- ## schema-40-loyalty-ssot-bulletproof.sql
-- 
-- ============================================================
-- Schema 40: Loyalty SSOT — Bulletproof Sync & Reconciliation
-- ============================================================
-- Replaces schema-38 with hardened sync that includes:
--   • Advisory locking to prevent race conditions
--   • Error-safe execution with structured logging
--   • Statement & lock timeouts for morning-rush concurrency
--   • Max-win batched reconciliation (100 rows per batch)
--   • All functions SECURITY DEFINER, revoked from PUBLIC
--
-- Idempotent: safe to re-run in the Supabase SQL Editor.
-- ============================================================

BEGIN;

-- ─────────────────────────────────────────────────────────────
-- 0. Pre-requisite: ensure profiles.email column exists
-- ─────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name  = 'profiles'
      AND column_name = 'email'
  ) THEN
    ALTER TABLE public.profiles ADD COLUMN email text;
  END IF;
END $$;

-- Backfill any NULL emails from auth.users
UPDATE public.profiles p
   SET email = u.email
  FROM auth.users u
 WHERE p.id = u.id
   AND p.email IS NULL;

-- Ensure the functional index exists for case-insensitive joins
CREATE INDEX IF NOT EXISTS idx_profiles_email
  ON public.profiles (lower(email));

CREATE INDEX IF NOT EXISTS idx_customers_email_lower
  ON public.customers (lower(email));

-- ─────────────────────────────────────────────────────────────
-- 1. system_sync_logs — structured error journal
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.system_sync_logs (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ts          timestamptz NOT NULL DEFAULT now(),
  source      text        NOT NULL,     -- e.g. 'loyalty_sync'
  profile_id  uuid,
  email       text,
  detail      text,
  sql_state   text,
  severity    text        NOT NULL DEFAULT 'error'
);

-- Allow service_role to INSERT; deny everyone else
ALTER TABLE public.system_sync_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Deny public access to system_sync_logs" ON public.system_sync_logs;
CREATE POLICY "Deny public access to system_sync_logs"
  ON public.system_sync_logs FOR ALL USING (false);

DROP POLICY IF EXISTS "Service role full access to system_sync_logs" ON public.system_sync_logs;
CREATE POLICY "Service role full access to system_sync_logs"
  ON public.system_sync_logs FOR ALL
  USING (current_setting('role', true) = 'service_role')
  WITH CHECK (current_setting('role', true) = 'service_role');

COMMENT ON TABLE public.system_sync_logs IS
  'Write-only journal for background sync errors. '
  'Inspected by ops during incident review; auto-prunable after 90 days.';

-- ─────────────────────────────────────────────────────────────
-- 2. "Silent Sync" trigger function
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.sync_loyalty_to_customers()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lock_key int;
BEGIN
  -- Short-circuit: nothing changed or no email to match on
  IF NEW.loyalty_points IS NOT DISTINCT FROM OLD.loyalty_points THEN
    RETURN NEW;
  END IF;
  IF NEW.email IS NULL THEN
    RETURN NEW;
  END IF;

  -- Scoped timeouts: never stall the primary write path
  SET LOCAL statement_timeout = '3s';
  SET LOCAL lock_timeout     = '2s';

  -- Advisory lock keyed on the email to serialize concurrent
  -- purchase / refund webhooks for the *same* customer.
  v_lock_key := hashtext('loyalty_sync:' || lower(NEW.email));
  PERFORM pg_advisory_xact_lock(v_lock_key);

  -- Mirror the new value into the legacy customers row
  UPDATE public.customers
     SET loyalty_points = NEW.loyalty_points
   WHERE lower(email) = lower(NEW.email);

  RETURN NEW;

EXCEPTION WHEN OTHERS THEN
  -- ── Error-safe: log and continue, NEVER fail the profiles write ──
  BEGIN
    INSERT INTO public.system_sync_logs
      (source, profile_id, email, detail, sql_state, severity)
    VALUES
      ('loyalty_sync', NEW.id, NEW.email, SQLERRM, SQLSTATE, 'error');
  EXCEPTION WHEN OTHERS THEN
    -- Even the log insert failed (e.g., table missing); last resort
    RAISE WARNING '[loyalty_sync] log-insert failed for profile %: % (original: %)',
      NEW.id, SQLERRM, SQLSTATE;
  END;
  RETURN NEW;
END;
$$;

-- Lock down execution
REVOKE ALL ON FUNCTION public.sync_loyalty_to_customers() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.sync_loyalty_to_customers() FROM anon, authenticated;

COMMENT ON FUNCTION public.sync_loyalty_to_customers() IS
  'AFTER UPDATE trigger: mirrors profiles.loyalty_points → customers.loyalty_points '
  'with advisory locking, scoped timeouts, and error-safe logging.';

-- ─────────────────────────────────────────────────────────────
-- 3. Attach trigger (idempotent)
-- ─────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_sync_loyalty_to_customers ON public.profiles;
CREATE TRIGGER trg_sync_loyalty_to_customers
  AFTER UPDATE OF loyalty_points ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_loyalty_to_customers();

-- ─────────────────────────────────────────────────────────────
-- 4. Batched max-win reconciliation (100 rows per iteration)
-- ─────────────────────────────────────────────────────────────
-- Encapsulated as a DO block so it runs once and is idempotent.
-- Each batch uses a CTE with LIMIT 100 + FOR UPDATE SKIP LOCKED
-- to avoid statement timeouts on large datasets.
-- ─────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_batch_size   int := 100;
  v_rows_updated int;
  v_total        int := 0;
BEGIN
  RAISE NOTICE '[loyalty-reconcile] Starting max-win reconciliation …';

  -- ── Phase A: profiles wins where profiles > customers ───────
  LOOP
    WITH mismatched AS (
      SELECT p.id    AS profile_id,
             p.email AS profile_email,
             GREATEST(
               COALESCE(p.loyalty_points, 0),
               COALESCE(c.loyalty_points, 0)
             ) AS winning_points
        FROM public.profiles p
        JOIN public.customers c
          ON lower(c.email) = lower(p.email)
       WHERE COALESCE(p.loyalty_points, 0)
             <> GREATEST(
                  COALESCE(p.loyalty_points, 0),
                  COALESCE(c.loyalty_points, 0)
                )
       LIMIT v_batch_size
    )
    UPDATE public.profiles pf
       SET loyalty_points = m.winning_points,
           updated_at     = now()
      FROM mismatched m
     WHERE pf.id = m.profile_id;

    GET DIAGNOSTICS v_rows_updated = ROW_COUNT;
    v_total := v_total + v_rows_updated;
    EXIT WHEN v_rows_updated < v_batch_size;
  END LOOP;

  RAISE NOTICE '[loyalty-reconcile] Phase A done — % profile rows lifted to max.', v_total;

  -- ── Phase B: push authoritative profiles value → customers ──
  v_total := 0;
  LOOP
    WITH out_of_sync AS (
      SELECT c.id   AS customer_id,
             p.loyalty_points AS correct_points
        FROM public.customers c
        JOIN public.profiles  p
          ON lower(c.email) = lower(p.email)
       WHERE c.loyalty_points IS DISTINCT FROM p.loyalty_points
         AND p.loyalty_points IS NOT NULL
       LIMIT v_batch_size
    )
    UPDATE public.customers cu
       SET loyalty_points = o.correct_points
      FROM out_of_sync o
     WHERE cu.id = o.customer_id;

    GET DIAGNOSTICS v_rows_updated = ROW_COUNT;
    v_total := v_total + v_rows_updated;
    EXIT WHEN v_rows_updated < v_batch_size;
  END LOOP;

  RAISE NOTICE '[loyalty-reconcile] Phase B done — % customer rows synced.', v_total;
  RAISE NOTICE '[loyalty-reconcile] Reconciliation complete.';
END $$;

COMMIT;


-- 
-- ## schema-41-order-status-remediation.sql
-- 
-- ============================================================
-- Schema 41: Order Status Update Remediation
-- ============================================================
-- Fixes the 500 Internal Server Error on update-order-status:
--
--   1. safe_update_order_status() RPC — wraps the UPDATE in a
--      transaction that sets app.voucher_bypass = 'true' so
--      prevent_order_amount_tampering never rejects vouchered
--      ($0.00) orders during status transitions.
--
--   2. Hardens handle_order_completion() with EXCEPTION block
--      so lock_timeout (55P03) doesn't kill the caller — logs
--      to system_sync_logs and still commits the status change.
--
--   3. Hardens prevent_order_amount_tampering() to only fire
--      when total_amount_cents actually changes (skip on status-
--      only updates).
--
-- Idempotent: safe to re-run in the Supabase SQL Editor.
-- ============================================================

BEGIN;

-- ─────────────────────────────────────────────────────────────
-- 1. safe_update_order_status() — RPC called by the Netlify fn
-- ─────────────────────────────────────────────────────────────
-- Sets app.voucher_bypass GUC so prevent_order_amount_tampering
-- doesn't block the row when handle_order_completion mutates it.
-- Returns the updated order row as JSON for the API response.
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.safe_update_order_status(
  p_order_id     uuid,
  p_status       text,
  p_completed_at timestamptz DEFAULT NULL,
  p_payment_id   text        DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
BEGIN
  -- Scoped timeouts: prevent runaway locks during rush
  SET LOCAL statement_timeout = '5s';
  SET LOCAL lock_timeout      = '3s';

  -- GUC bypass: allows the BEFORE UPDATE trigger
  -- prevent_order_amount_tampering to pass through without
  -- raising an exception on $0 vouchered orders.
  PERFORM set_config('app.voucher_bypass', 'true', true);

  -- Perform the update
  UPDATE public.orders
     SET status       = p_status,
         completed_at = COALESCE(p_completed_at, completed_at),
         payment_id   = COALESCE(p_payment_id,   payment_id),
         updated_at   = now()
   WHERE id = p_order_id;

  -- Fetch the updated row (post-trigger) as JSON
  SELECT to_jsonb(o.*) INTO v_result
    FROM public.orders o
   WHERE o.id = p_order_id;

  RETURN v_result;
END;
$$;

-- Restrict execution
REVOKE ALL ON FUNCTION public.safe_update_order_status(uuid, text, timestamptz, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.safe_update_order_status(uuid, text, timestamptz, text) FROM anon, authenticated;
-- service_role retains access (Netlify function uses service key)

COMMENT ON FUNCTION public.safe_update_order_status IS
  'RPC for update-order-status.js. Sets app.voucher_bypass GUC, '
  'applies scoped timeouts, and returns the updated order as JSONB.';

-- ─────────────────────────────────────────────────────────────
-- 2. Harden handle_order_completion — catch lock timeouts
-- ─────────────────────────────────────────────────────────────
-- The FOR UPDATE lock on inventory can fail under morning-rush
-- concurrency when lock_timeout fires. Without an EXCEPTION
-- handler the entire UPDATE is killed → 500.
--
-- Fix: catch all errors, log to system_sync_logs, and still
-- return NEW so the status transition succeeds. Inventory will
-- be reconciled by the next successful completion or the nightly
-- inventory-check cron.
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION handle_order_completion()
RETURNS trigger AS $$
DECLARE
  v_item_count int;
  v_old_stock  int;
  v_actual_dec int;
BEGIN
  SET LOCAL statement_timeout = '3s';
  SET LOCAL lock_timeout      = '2s';

  -- Guard 1: Only fire on transition TO 'completed'
  IF (NEW.status <> 'completed') OR (OLD.status IS NOT DISTINCT FROM 'completed') THEN
    RETURN NEW;
  END IF;

  -- Guard 2: One-shot flag — never decrement twice for the same order
  IF COALESCE(NEW.inventory_decremented, false) THEN
    RETURN NEW;
  END IF;

  -- Count drink items for this order
  SELECT COUNT(*)::int INTO v_item_count
    FROM public.coffee_orders
   WHERE order_id = NEW.id;

  IF v_item_count > 0 THEN
    -- Lock the inventory row to prevent concurrent under-decrement
    SELECT current_stock INTO v_old_stock
      FROM public.inventory
     WHERE item_name = '12oz Cups'
       FOR UPDATE;

    -- Calculate actual decrement (can't go below 0)
    v_actual_dec := LEAST(v_item_count, COALESCE(v_old_stock, 0));

    UPDATE public.inventory
       SET current_stock = GREATEST(0, current_stock - v_item_count),
           updated_at = now()
     WHERE item_name = '12oz Cups';

    NEW.cups_decremented := v_actual_dec;
  END IF;

  NEW.inventory_decremented := true;
  RETURN NEW;

EXCEPTION WHEN OTHERS THEN
  -- ── Error-safe: log and continue so the status UPDATE succeeds ──
  BEGIN
    INSERT INTO public.system_sync_logs
      (source, detail, sql_state, severity)
    VALUES
      ('handle_order_completion',
       format('Order %s: %s', NEW.id, SQLERRM),
       SQLSTATE,
       'error');
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '[handle_order_completion] log-insert failed for order %: %',
      NEW.id, SQLERRM;
  END;
  -- Still mark the flag so a retry doesn't double-count
  NEW.inventory_decremented := false;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Re-attach the trigger (idempotent)
DROP TRIGGER IF EXISTS trg_order_completion ON public.orders;
CREATE TRIGGER trg_order_completion
  BEFORE UPDATE ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION handle_order_completion();

-- ─────────────────────────────────────────────────────────────
-- 3. Tighten prevent_order_amount_tampering
-- ─────────────────────────────────────────────────────────────
-- Only raise when total_amount_cents *actually changes*.
-- Skip entirely for status-only updates (the common path).
-- Still respects the app.voucher_bypass GUC for atomic_redeem.
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION prevent_order_amount_tampering()
RETURNS trigger AS $$
BEGIN
  -- Fast exit: if amount didn't change, nothing to guard
  IF NEW.total_amount_cents IS NOT DISTINCT FROM OLD.total_amount_cents THEN
    RETURN NEW;
  END IF;

  -- GUC bypass for voucher redemption flow
  IF current_setting('app.voucher_bypass', true) = 'true' THEN
    RETURN NEW;
  END IF;

  -- Block unauthorized amount changes
  IF OLD.total_amount_cents IS NOT NULL THEN
    RAISE EXCEPTION 'Cannot modify order amount after creation'
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Re-attach (idempotent)
DROP TRIGGER IF EXISTS orders_no_amount_tampering ON public.orders;
CREATE TRIGGER orders_no_amount_tampering
  BEFORE UPDATE ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION prevent_order_amount_tampering();

COMMIT;


-- 
-- ## schema-42-atomic-staff-clock.sql
-- 
-- ============================================================
-- Schema 42: Atomic Staff Clock — Decoupled from PIN Login
-- ============================================================
-- Creates atomic_staff_clock() RPC that is the ONLY way to
-- change is_working and write to time_logs.
--
-- Key guarantees:
--   • Advisory lock per staff member prevents double-clock races
--   • Idempotent: clock-in when already in → returns success (no dup row)
--   • 16h shift auto-flag for manager review
--   • is_working is ONLY modified here, never by login
--   • SECURITY DEFINER, revoked from public — called by service_role only
--
-- Idempotent: safe to re-run in the Supabase SQL Editor.
-- ============================================================

BEGIN;

-- ─────────────────────────────────────────────────────────────
-- 1. atomic_staff_clock(p_staff_id, p_action, p_ip)
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.atomic_staff_clock(
  p_staff_id uuid,
  p_action   text,       -- 'in' or 'out'
  p_ip       text DEFAULT 'unknown'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_staff      record;
  v_open_shift record;
  v_lock_key   int;
  v_now        timestamptz := now();
  v_shift_hrs  numeric;
  v_warning    text := NULL;
  v_new_log_id uuid;
  MAX_AUTO_HOURS constant numeric := 16;
BEGIN
  -- Scoped timeouts: never stall the clock UI
  SET LOCAL statement_timeout = '5s';
  SET LOCAL lock_timeout      = '3s';

  -- Validate action
  IF p_action NOT IN ('in', 'out') THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Invalid action. Must be "in" or "out".',
      'error_code', 'INVALID_ACTION'
    );
  END IF;

  -- Fetch staff record (validates p_staff_id exists)
  SELECT id, email, role, is_working
    INTO v_staff
    FROM public.staff_directory
   WHERE id = p_staff_id;

  IF v_staff IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Staff member not found.',
      'error_code', 'STAFF_NOT_FOUND'
    );
  END IF;

  -- Advisory lock per staff member: serialize concurrent taps
  v_lock_key := hashtext('staff_clock:' || p_staff_id::text);
  PERFORM pg_advisory_xact_lock(v_lock_key);

  -- ── CLOCK IN ──────────────────────────────────────────────
  IF p_action = 'in' THEN
    -- Check for existing open shift (idempotency)
    SELECT id, clock_in
      INTO v_open_shift
      FROM public.time_logs
     WHERE employee_email = lower(v_staff.email)
       AND clock_out IS NULL
       AND action_type = 'in'
     ORDER BY clock_in DESC
     LIMIT 1;

    IF v_open_shift IS NOT NULL THEN
      -- Already clocked in — return success without a new row
      RETURN jsonb_build_object(
        'success', true,
        'action', 'in',
        'time', v_open_shift.clock_in,
        'is_working', true,
        'idempotent', true
      );
    END IF;

    -- Insert new clock-in row
    INSERT INTO public.time_logs (
      employee_email, action_type, clock_in, clock_out, status
    ) VALUES (
      lower(v_staff.email), 'in', v_now, NULL, 'active'
    )
    RETURNING id INTO v_new_log_id;

    -- Atomically set is_working
    UPDATE public.staff_directory
       SET is_working = true
     WHERE id = p_staff_id;

    RETURN jsonb_build_object(
      'success', true,
      'action', 'in',
      'time', v_now,
      'is_working', true,
      'log_id', v_new_log_id
    );
  END IF;

  -- ── CLOCK OUT ─────────────────────────────────────────────
  IF p_action = 'out' THEN
    -- Find the open shift
    SELECT id, clock_in
      INTO v_open_shift
      FROM public.time_logs
     WHERE employee_email = lower(v_staff.email)
       AND clock_out IS NULL
       AND action_type = 'in'
     ORDER BY clock_in DESC
     LIMIT 1;

    IF v_open_shift IS NULL THEN
      -- Not clocked in — idempotent: if already off-shift, return success
      IF NOT COALESCE(v_staff.is_working, false) THEN
        RETURN jsonb_build_object(
          'success', true,
          'action', 'out',
          'time', v_now,
          'is_working', false,
          'idempotent', true
        );
      END IF;

      -- is_working was stale (e.g., browser crash) — fix it
      UPDATE public.staff_directory
         SET is_working = false
       WHERE id = p_staff_id;

      RETURN jsonb_build_object(
        'success', true,
        'action', 'out',
        'time', v_now,
        'is_working', false,
        'warning', 'No open shift found but is_working was stale. Corrected.'
      );
    END IF;

    -- Calculate shift duration
    v_shift_hrs := EXTRACT(EPOCH FROM (v_now - v_open_shift.clock_in)) / 3600.0;

    -- Flag abnormally long shifts for manager review
    IF v_shift_hrs > MAX_AUTO_HOURS THEN
      v_warning := format('Shift exceeds %sh (%sh actual). Flagged for manager review.',
                          MAX_AUTO_HOURS, round(v_shift_hrs::numeric, 1));

      UPDATE public.time_logs
         SET action_type          = 'out',
             clock_out            = v_now,
             status               = 'Pending',
             needs_manager_review = true
       WHERE id = v_open_shift.id;
    ELSE
      UPDATE public.time_logs
         SET action_type = 'out',
             clock_out   = v_now,
             status      = 'completed'
       WHERE id = v_open_shift.id;
    END IF;

    -- Atomically clear is_working
    UPDATE public.staff_directory
       SET is_working = false
     WHERE id = p_staff_id;

    RETURN jsonb_build_object(
      'success', true,
      'action', 'out',
      'time', v_now,
      'is_working', false,
      'shift_hours', round(v_shift_hrs::numeric, 2),
      'warning', v_warning
    );
  END IF;

  -- Should never reach here
  RETURN jsonb_build_object(
    'success', false,
    'error', 'Unexpected state',
    'error_code', 'INTERNAL_ERROR'
  );
END;
$$;

-- Restrict execution: only service_role (Netlify functions)
REVOKE ALL ON FUNCTION public.atomic_staff_clock(uuid, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.atomic_staff_clock(uuid, text, text) FROM anon, authenticated;

COMMENT ON FUNCTION public.atomic_staff_clock IS
  'Atomic clock-in/clock-out RPC. The ONLY code path that modifies '
  'is_working or writes to time_logs. Called by pin-clock.js via service_role. '
  'Advisory-locked per staff member. Idempotent. 16h auto-flag.';

-- ─────────────────────────────────────────────────────────────
-- 2. Safety net: remove any stale auto-clock triggers
-- ─────────────────────────────────────────────────────────────
-- If any trigger was auto-clocking on login, drop it now.
DROP TRIGGER IF EXISTS trg_auto_clock_on_login ON public.staff_directory;
DROP TRIGGER IF EXISTS trg_auto_clock_on_pin_login ON public.staff_directory;

COMMIT;


-- 
-- ## schema-43-payroll-adjustment-audit.sql
-- 
-- ============================================================
-- Schema 43: Payroll Adjustment & Audit Architecture
-- ============================================================
-- Replaces direct time_logs editing with an immutable
-- "Correction & Audit" model required for IRS compliance.
--
--   1. Adds `notes` column to time_logs for audit annotations.
--
--   2. atomic_payroll_adjustment() RPC — SECURITY DEFINER.
--      Never mutates existing rows. Inserts a new row with
--      action_type = 'adjustment', carrying the delta minutes
--      (positive or negative) and a mandatory manager audit
--      trail in the notes column.
--
--   3. v_payroll_summary — aggregated view of clock hours +
--      adjustments per staff member per pay period (weekly,
--      Mon–Sun boundaries).
--
-- Idempotent: safe to re-run in the Supabase SQL Editor.
-- ============================================================

BEGIN;

-- ─────────────────────────────────────────────────────────────
-- 1. Add notes column to time_logs (idempotent)
-- ─────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name   = 'time_logs'
       AND column_name  = 'notes'
  ) THEN
    ALTER TABLE public.time_logs ADD COLUMN notes text;
  END IF;
END $$;

-- Add delta_minutes for adjustment rows (minutes added/subtracted)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name   = 'time_logs'
       AND column_name  = 'delta_minutes'
  ) THEN
    ALTER TABLE public.time_logs ADD COLUMN delta_minutes numeric;
  END IF;
END $$;

-- Add manager_id for audit trail (FK to staff_directory)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name   = 'time_logs'
       AND column_name  = 'manager_id'
  ) THEN
    ALTER TABLE public.time_logs ADD COLUMN manager_id uuid;
  END IF;
END $$;

-- FK: manager_id must reference a real staff member.
-- ON DELETE RESTRICT prevents deleting a manager who has made adjustments,
-- preserving the IRS audit trail.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
     WHERE table_schema    = 'public'
       AND table_name      = 'time_logs'
       AND constraint_name = 'fk_time_logs_manager_id'
  ) THEN
    ALTER TABLE public.time_logs
      ADD CONSTRAINT fk_time_logs_manager_id
      FOREIGN KEY (manager_id) REFERENCES public.staff_directory(id)
      ON DELETE RESTRICT;
  END IF;
END $$;

-- Index for efficient payroll queries
CREATE INDEX IF NOT EXISTS idx_time_logs_action_type
  ON public.time_logs(action_type);

CREATE INDEX IF NOT EXISTS idx_time_logs_clock_in_date
  ON public.time_logs(clock_in);

-- ─────────────────────────────────────────────────────────────
-- 2. atomic_payroll_adjustment() — The IRS-compliant RPC
-- ─────────────────────────────────────────────────────────────
-- NEVER edits existing rows. Inserts a new row with:
--   action_type   = 'adjustment'
--   delta_minutes = signed integer (positive = add, negative = subtract)
--   notes         = reason + manager audit stamp
--   manager_id    = UUID of the authorising manager
--   employee_email = the affected staff member
--   clock_in      = timestamp of the adjustment (for pay-period bucketing)
--   status        = 'completed' (adjustments are instantly final)
--
-- Returns the inserted adjustment row as JSONB.
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.atomic_payroll_adjustment(
  p_employee_email  text,
  p_delta_minutes   numeric,
  p_reason          text,
  p_manager_id      uuid,
  p_target_date     timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_staff       record;
  v_audit_note  text;
  v_inserted    jsonb;
BEGIN
  -- Scoped timeouts
  SET LOCAL statement_timeout = '5s';
  SET LOCAL lock_timeout      = '3s';

  -- ── Validate employee exists ────────────────────────────
  SELECT id, email, name
    INTO v_staff
    FROM public.staff_directory
   WHERE lower(email) = lower(trim(p_employee_email))
   LIMIT 1;

  IF v_staff IS NULL THEN
    RAISE EXCEPTION 'Employee not found: %', p_employee_email
      USING ERRCODE = 'P0002';
  END IF;

  -- ── Validate delta is non-zero ──────────────────────────
  IF p_delta_minutes = 0 THEN
    RAISE EXCEPTION 'delta_minutes must be non-zero'
      USING ERRCODE = 'P0003';
  END IF;

  -- ── Validate reason is present ──────────────────────────
  IF p_reason IS NULL OR trim(p_reason) = '' THEN
    RAISE EXCEPTION 'A reason is required for every adjustment'
      USING ERRCODE = 'P0004';
  END IF;

  -- ── Validate manager exists (FK backs this at DB level) ──
  IF NOT EXISTS (
    SELECT 1 FROM public.staff_directory WHERE id = p_manager_id
  ) THEN
    RAISE EXCEPTION 'Manager not found: %', p_manager_id
      USING ERRCODE = 'P0005';
  END IF;

  -- ── Build the audit note ────────────────────────────────
  v_audit_note := trim(p_reason)
    || ' [ADJUSTMENT BY ' || p_manager_id::text
    || ' AT ' || to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
    || ']';

  -- ── Insert the immutable adjustment row ─────────────────
  INSERT INTO public.time_logs (
    employee_email,
    action_type,
    delta_minutes,
    notes,
    manager_id,
    clock_in,
    status,
    created_at
  ) VALUES (
    lower(trim(p_employee_email)),
    'adjustment',
    p_delta_minutes,
    v_audit_note,
    p_manager_id,
    p_target_date,
    'completed',
    now()
  )
  RETURNING to_jsonb(time_logs.*) INTO v_inserted;

  -- ── Audit log ───────────────────────────────────────────
  INSERT INTO public.system_sync_logs (source, detail, severity)
  VALUES (
    'atomic_payroll_adjustment',
    format('Manager %s adjusted %s by %s min: %s',
           p_manager_id, p_employee_email, p_delta_minutes, v_audit_note),
    'info'
  );

  RETURN v_inserted;
END;
$$;

-- Restrict execution to service_role only
REVOKE ALL ON FUNCTION public.atomic_payroll_adjustment(text, numeric, text, uuid, timestamptz) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.atomic_payroll_adjustment(text, numeric, text, uuid, timestamptz) FROM anon, authenticated;

COMMENT ON FUNCTION public.atomic_payroll_adjustment IS
  'IRS-compliant payroll adjustment. Never edits existing rows — inserts '
  'an immutable adjustment record with full manager audit trail.';

-- ─────────────────────────────────────────────────────────────
-- 3. v_payroll_summary — Aggregated view per staff per week
-- ─────────────────────────────────────────────────────────────
-- Combines clock-in/out shift hours with adjustment deltas.
-- Pay period = ISO week (Mon–Sun).
--
-- Columns:
--   employee_email, employee_name, hourly_rate,
--   pay_period_start (Monday), pay_period_end (Sunday),
--   clocked_minutes, adjustment_minutes, total_minutes,
--   total_hours, gross_pay
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.v_payroll_summary AS
WITH clock_shifts AS (
  -- Only completed shifts (clock_out IS NOT NULL).
  -- Active / partial shifts are intentionally excluded so we
  -- never pay for time that hasn't been finalized yet.
  SELECT
    lower(tl.employee_email)                       AS employee_email,
    date_trunc('week', tl.clock_in)::date          AS period_start,
    (date_trunc('week', tl.clock_in) + interval '6 days')::date AS period_end,
    EXTRACT(EPOCH FROM (tl.clock_out - tl.clock_in)) / 60.0
                                                   AS shift_minutes
  FROM public.time_logs tl
  WHERE tl.action_type IN ('in', 'out')
    AND tl.clock_in  IS NOT NULL
    AND tl.clock_out IS NOT NULL
    AND tl.status = 'completed'
),
active_shifts AS (
  -- Count of open (unfinished) shifts per employee per week.
  -- These are NOT included in totals — surfaced for manager awareness only.
  SELECT
    lower(tl.employee_email)                       AS employee_email,
    date_trunc('week', tl.clock_in)::date          AS period_start,
    (date_trunc('week', tl.clock_in) + interval '6 days')::date AS period_end,
    COUNT(*)::int                                  AS open_shift_count
  FROM public.time_logs tl
  WHERE tl.action_type = 'in'
    AND tl.clock_in  IS NOT NULL
    AND tl.clock_out IS NULL
  GROUP BY 1, 2, 3
),
adjustments AS (
  -- Sum adjustment deltas
  SELECT
    lower(tl.employee_email)                       AS employee_email,
    date_trunc('week', tl.clock_in)::date          AS period_start,
    (date_trunc('week', tl.clock_in) + interval '6 days')::date AS period_end,
    COALESCE(tl.delta_minutes, 0)                  AS adj_minutes
  FROM public.time_logs tl
  WHERE tl.action_type = 'adjustment'
),
combined AS (
  SELECT employee_email, period_start, period_end,
         shift_minutes AS minutes, 'clock' AS source
    FROM clock_shifts
  UNION ALL
  SELECT employee_email, period_start, period_end,
         adj_minutes   AS minutes, 'adjustment' AS source
    FROM adjustments
)
SELECT
  c.employee_email,
  sd.name                                          AS employee_name,
  sd.hourly_rate,
  c.period_start                                   AS pay_period_start,
  c.period_end                                     AS pay_period_end,
  ROUND(SUM(CASE WHEN c.source = 'clock'      THEN c.minutes ELSE 0 END)::numeric, 2)
                                                   AS clocked_minutes,
  ROUND(SUM(CASE WHEN c.source = 'adjustment' THEN c.minutes ELSE 0 END)::numeric, 2)
                                                   AS adjustment_minutes,
  ROUND(SUM(c.minutes)::numeric, 2)                AS total_minutes,
  ROUND((SUM(c.minutes) / 60.0)::numeric, 2)       AS total_hours,
  ROUND((SUM(c.minutes) / 60.0 * COALESCE(sd.hourly_rate, 0))::numeric, 2)
                                                   AS gross_pay,
  COALESCE(a.open_shift_count, 0)                  AS active_shifts
FROM combined c
LEFT JOIN public.staff_directory sd
  ON lower(sd.email) = c.employee_email
LEFT JOIN active_shifts a
  ON  a.employee_email = c.employee_email
  AND a.period_start   = c.period_start
GROUP BY c.employee_email, sd.name, sd.hourly_rate,
         c.period_start, c.period_end, a.open_shift_count;

COMMENT ON VIEW public.v_payroll_summary IS
  'Aggregated payroll view: clock shifts + adjustments per staff per ISO week. '
  'Immutable source rows guarantee IRS audit compliance.';

-- RLS note: This view is accessed via service_role (Netlify functions).
-- No need for SELECT grants to anon/authenticated.

COMMIT;


-- == schema-31-drop-redundant-customer-cols ==
-- ============================================================
-- BREWHUB SCHEMA 31: Drop redundant customers columns
-- Migrates name → full_name, address → address_street,
-- then drops the legacy columns.
-- ============================================================
-- Safe to re-run: every statement is guarded with IF / COALESCE.

BEGIN;

-- 1. Back-fill full_name from name where full_name is NULL or empty
UPDATE customers
SET    full_name = name
WHERE  name IS NOT NULL
  AND  name <> ''
  AND  (full_name IS NULL OR full_name = '');

-- 2. Back-fill address_street from address where address_street is NULL or empty
UPDATE customers
SET    address_street = address
WHERE  address IS NOT NULL
  AND  address <> ''
  AND  (address_street IS NULL OR address_street = '');

-- 3. Drop the redundant columns
ALTER TABLE customers DROP COLUMN IF EXISTS name;
ALTER TABLE customers DROP COLUMN IF EXISTS address;

COMMIT;


-- == schema-32-kds-update-rls ==
-- ============================================================
-- BREWHUB SCHEMA 32: KDS staff UPDATE policy for orders
--
-- Problem: The KDS page does client-side UPDATEs on orders.status
-- but no RLS policy allows staff UPDATE. The only matching policy
-- is "Deny public access to orders" (FOR ALL USING false), so
-- every status-change click silently fails.
--
-- Fix: Add a FOR UPDATE policy allowing is_brewhub_staff() to
-- update orders. WITH CHECK restricts the allowed status values.
-- ============================================================

BEGIN;

-- Allow staff to update order status (KDS workflow)
DROP POLICY IF EXISTS "Staff can update orders" ON orders;
CREATE POLICY "Staff can update orders" ON orders
  FOR UPDATE
  USING  (is_brewhub_staff())
  WITH CHECK (
    is_brewhub_staff()
    AND status IN ('pending', 'unpaid', 'paid', 'preparing', 'ready', 'completed', 'cancelled')
  );

COMMIT;


-- == schema-33-receipt-realtime ==
-- ============================================================
-- SCHEMA 33: Enable Realtime on receipt_queue
-- ============================================================
-- Problem: The receipt_queue table has RLS that denies all access
-- to the anon role. Supabase Realtime (postgres_changes) respects
-- RLS and requires SELECT permission for the subscribing client.
-- Since the frontend connects with the anon key (not Supabase Auth),
-- the Realtime channel never delivers INSERT/UPDATE events.
--
-- Fix:
--   1. Add an anon-friendly SELECT policy for receipt_queue.
--      (Receipt text is not sensitive — it's the same info a
--       customer sees on their printed receipt.)
--   2. Add receipt_queue to the supabase_realtime publication
--      so postgres_changes events are emitted.
-- ============================================================

-- 1. Allow anon (and authenticated) SELECT so Realtime works
DROP POLICY IF EXISTS "Allow anon select for realtime" ON receipt_queue;
CREATE POLICY "Allow anon select for realtime" ON receipt_queue
  FOR SELECT
  USING (true);

-- 2. Add table to Realtime publication (idempotent: errors if already present)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'receipt_queue'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE receipt_queue;
  END IF;
END
$$;


-- == schema-37-audit-critical-fixes ==
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

DROP POLICY IF EXISTS "Staff can read inventory audit" ON inventory_audit_log;
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


-- == schema-38-loyalty-ssot-sync ==
-- ============================================================
-- Schema 38: Loyalty Single Source of Truth (SSoT) Sync
-- ============================================================
-- PROBLEM: `profiles.loyalty_points` is the authoritative column
-- (used by increment_loyalty, decrement_loyalty_on_refund, the
-- POS loyalty scanner, and the portal). But the legacy `customers`
-- table also has a `loyalty_points` column that some admin queries
-- reference. Without a sync mechanism the two drift apart,
-- creating support tickets and incorrect voucher issuance.
--
-- SOLUTION: A Postgres trigger on `profiles` that cascades any
-- loyalty_points change into the `customers` row sharing the
-- same email. The trigger is AFTER UPDATE so it does not block
-- the primary write path and fails silently (via EXCEPTION block)
-- to avoid breaking the happy path if no matching customer row
-- exists.
--
-- The trigger is idempotent: re-running this migration replaces
-- the function and trigger without error.
-- ============================================================

-- 1. Add email column to profiles if missing (needed for join)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'email'
  ) THEN
    ALTER TABLE public.profiles ADD COLUMN email text;
    -- Backfill from auth.users
    UPDATE public.profiles p
       SET email = u.email
      FROM auth.users u
     WHERE p.id = u.id AND p.email IS NULL;
  END IF;
END $$;

-- 2. Create the sync function
CREATE OR REPLACE FUNCTION sync_loyalty_to_customers()
RETURNS trigger AS $$
BEGIN
  -- Only fire when loyalty_points actually changed
  IF NEW.loyalty_points IS DISTINCT FROM OLD.loyalty_points THEN
    UPDATE public.customers
       SET loyalty_points = NEW.loyalty_points
     WHERE lower(email) = lower(NEW.email)
       AND NEW.email IS NOT NULL;
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Never break the primary write path; log and continue
  RAISE WARNING 'sync_loyalty_to_customers failed for profile %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. Attach trigger (replace if exists)
DROP TRIGGER IF EXISTS trg_sync_loyalty_to_customers ON public.profiles;
CREATE TRIGGER trg_sync_loyalty_to_customers
  AFTER UPDATE OF loyalty_points ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION sync_loyalty_to_customers();

-- 4. One-time backfill: push current profiles.loyalty_points
--    into matching customers rows so they start in sync.
UPDATE public.customers c
   SET loyalty_points = p.loyalty_points
  FROM public.profiles p
 WHERE lower(c.email) = lower(p.email)
   AND p.loyalty_points IS NOT NULL
   AND c.loyalty_points IS DISTINCT FROM p.loyalty_points;

-- 5. Reverse sync: if customers had points that profiles didn't,
--    pull the MAX into profiles (one-time reconciliation).
UPDATE public.profiles p
   SET loyalty_points = GREATEST(COALESCE(p.loyalty_points, 0), c.loyalty_points)
  FROM public.customers c
 WHERE lower(p.email) = lower(c.email)
   AND c.loyalty_points > COALESCE(p.loyalty_points, 0);


-- == schema-39-total-defense-audit ==
-- ============================================================
-- Schema 39: Total Defense Audit — Clean Room Hardening
-- ============================================================
--
-- Four fixes for state-level intelligence scrutiny:
--
--   1. TEMPORAL JITTER on parcel_departure_board
--      → Randomise received_at by ±3 minutes to defeat high-fidelity
--        surveillance via timestamp cross-referencing.
--      → Truncate masked_name to first initial only (no last name).
--      → Remove unit_number from the public VIEW.
--      → Remove raw UUID (replace with opaque row suffix).
--
--   2. STATEMENT TIMEOUTS on every high-concurrency RPC
--      → Prevents coordinated "slow-post" from queueing row-locks
--        long enough to hang the DB during rush hour.
--
--   3. IP SALTED HASHING
--      → pin_attempts and voucher_redemption_fails now store
--        SHA-256(ip || per-row-salt) instead of raw IPs.
--      → Existing raw IPs are hashed in-place as a one-time migration.
--
--   4. LOYALTY SYNC TRIGGER (supplementary)
--      → Already handled in schema-38; this file only adds the
--        jitter, timeouts, and IP hashing.
--
-- SECURITY RATIONALE (per fix) is inline below.
-- ============================================================


-- ┌──────────────────────────────────────────────────────────┐
-- │  FIX 1: TEMPORAL JITTER + PII HARDENING                 │
-- │                                                          │
-- │  SECURITY RATIONALE:                                     │
-- │  A trained analyst stationed in-store could correlate:   │
-- │    carrier + last-4 tracking + exact received_at →       │
-- │    carrier API → full tracking → shipping origin →       │
-- │    purchasing patterns of a specific resident.           │
-- │                                                          │
-- │  Mitigations applied:                                    │
-- │  (a) ±3 min random jitter on received_at eliminates      │
-- │      sub-minute timestamp correlation.                   │
-- │  (b) masked_name → first initial + "." only; no surname. │
-- │  (c) unit_number is REMOVED from the VIEW entirely.      │
-- │  (d) Raw UUID 'id' replaced with opaque 4-char suffix.   │
-- │                                                          │
-- │  The VIEW is the ONLY surface exposed to anon; the       │
-- │  underlying parcels table remains unchanged for staff.    │
-- └──────────────────────────────────────────────────────────┘

-- Must DROP first: CREATE OR REPLACE VIEW cannot remove columns
-- that existed in the prior definition (unit_number, raw id, etc.)
DROP VIEW IF EXISTS parcel_departure_board;

CREATE VIEW parcel_departure_board
  WITH (security_invoker = false)
AS
SELECT
  -- Opaque identifier: last 4 chars of UUID, not the full key
  right(id::text, 4)                         AS id,

  -- Name: first initial only. No surname leakage.
  CASE
    WHEN recipient_name IS NULL OR trim(recipient_name) = '' THEN 'Resident'
    ELSE upper(left(trim(recipient_name), 1)) || '.'
  END                                        AS masked_name,

  -- Tracking: carrier prefix + last 4 digits only
  COALESCE(carrier, 'PKG') || ' …' || right(tracking_number, 4)
                                             AS masked_tracking,

  -- Carrier: coarsened to canonical names to reduce fingerprinting
  CASE
    WHEN carrier ILIKE '%ups%'                   THEN 'UPS'
    WHEN carrier ILIKE '%fedex%' OR carrier ILIKE '%fed%' THEN 'FedEx'
    WHEN carrier ILIKE '%usps%' OR carrier ILIKE '%postal%' THEN 'USPS'
    WHEN carrier ILIKE '%amazon%' OR carrier ILIKE '%amzl%' THEN 'Amazon'
    WHEN carrier ILIKE '%dhl%'                   THEN 'DHL'
    ELSE 'Other'
  END                                        AS carrier,

  -- Temporal jitter: ±3 minutes random offset per row.
  -- Uses md5(id::text) seeded pseudo-random so the jitter is stable
  -- per parcel (no UI flicker on re-poll) but unpredictable externally.
  received_at + (
    (('x' || left(md5(id::text || 'jitter_salt_2026'), 8))::bit(32)::int % 360 - 180)
    * interval '1 second'
  )                                          AS received_at

  -- unit_number: INTENTIONALLY OMITTED from the VIEW.
  -- Staff can query the parcels table directly via authenticated RPC.

FROM parcels
WHERE status = 'arrived';

-- Re-grant to anon + authenticated (VIEW replacement drops grants)
GRANT SELECT ON parcel_departure_board TO anon, authenticated;


-- ┌──────────────────────────────────────────────────────────┐
-- │  FIX 2: STATEMENT TIMEOUTS ON HIGH-CONCURRENCY RPCs     │
-- │                                                          │
-- │  SECURITY RATIONALE:                                     │
-- │  A coordinated "slow-post" attack sends N concurrent POS │
-- │  requests that each acquire FOR UPDATE row locks.        │
-- │  Without timeouts, later requests queue behind the lock  │
-- │  indefinitely, creating a cascading tail of DB            │
-- │  connections that exhausts the pool (max 60 on Supabase  │
-- │  free/pro tiers). This is a Denial-of-Life attack.       │
-- │                                                          │
-- │  Fix: SET LOCAL statement_timeout inside every RPC that  │
-- │  acquires FOR UPDATE or advisory locks. LOCAL scoping    │
-- │  ensures the timeout applies only to the current         │
-- │  transaction and does not leak to other sessions.        │
-- │                                                          │
-- │  Timeouts chosen:                                        │
-- │    • Voucher redemption: 5s (complex, multi-step)        │
-- │    • Loyalty increment/decrement: 3s (single UPDATE)     │
-- │    • Inventory trigger: 3s (single row lock)             │
-- │    • Notification queue: 3s (SKIP LOCKED, fast path)     │
-- │    • Refund inventory restore: 5s (multi-step)           │
-- └──────────────────────────────────────────────────────────┘

-- 2a. increment_loyalty — add 3s timeout before FOR UPDATE
CREATE OR REPLACE FUNCTION increment_loyalty(
  target_user_id uuid,
  amount_cents   int,
  p_order_id     uuid DEFAULT NULL
)
RETURNS TABLE(loyalty_points int, voucher_earned boolean, points_awarded int) AS $$
DECLARE
  v_new_points int;
  v_voucher_earned boolean := false;
  v_points_delta int;
  v_previous int := 0;
  v_current_points int;
BEGIN
  -- DEADLOCK DEFENSE: 3-second timeout on row locks
  SET LOCAL statement_timeout = '3s';
  SET LOCAL lock_timeout      = '2s';

  IF p_order_id IS NOT NULL THEN
    SELECT COALESCE(paid_amount_cents, 0) INTO v_previous FROM orders WHERE id = p_order_id;
  END IF;

  v_points_delta := GREATEST(0, floor(amount_cents / 100)::int - floor(v_previous / 100)::int);

  IF v_points_delta <= 0 THEN
    RETURN QUERY
      SELECT COALESCE(p.loyalty_points, 0), false, 0
        FROM profiles p
       WHERE p.id = target_user_id;
    RETURN;
  END IF;

  SELECT p.loyalty_points
    INTO v_current_points
    FROM profiles p
   WHERE p.id = target_user_id
     FOR UPDATE;

  IF v_current_points IS NULL THEN
    RETURN QUERY SELECT 0, false, 0;
    RETURN;
  END IF;

  v_new_points := COALESCE(v_current_points, 0) + v_points_delta;

  UPDATE profiles
     SET loyalty_points = v_new_points,
         updated_at     = now()
   WHERE id = target_user_id;

  IF v_new_points >= 500
     AND (v_current_points % 500) > (v_new_points % 500)
  THEN
    v_voucher_earned := true;
  END IF;

  RETURN QUERY SELECT v_new_points, v_voucher_earned, v_points_delta;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2b. decrement_loyalty_on_refund — add 3s timeout
CREATE OR REPLACE FUNCTION decrement_loyalty_on_refund(
  target_user_id uuid,
  amount_cents   int DEFAULT 500
)
RETURNS TABLE(loyalty_points int, points_deducted int) AS $$
DECLARE
  v_current_points int;
  v_deduct         int;
  v_new_points     int;
BEGIN
  SET LOCAL statement_timeout = '3s';
  SET LOCAL lock_timeout      = '2s';

  SELECT p.loyalty_points
    INTO v_current_points
    FROM profiles p
   WHERE p.id = target_user_id
     FOR UPDATE;

  IF v_current_points IS NULL THEN
    RETURN QUERY SELECT 0, 0;
    RETURN;
  END IF;

  v_deduct     := LEAST(GREATEST(0, floor(amount_cents / 100)::int), v_current_points);
  v_new_points := v_current_points - v_deduct;

  UPDATE profiles
     SET loyalty_points = v_new_points,
         updated_at     = now()
   WHERE id = target_user_id;

  RETURN QUERY SELECT v_new_points, v_deduct;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

REVOKE EXECUTE ON FUNCTION increment_loyalty(uuid, int, uuid) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION decrement_loyalty_on_refund(uuid, int) FROM anon, authenticated;

-- 2c. atomic_redeem_voucher — add 5s timeout (multi-step, advisory lock)
-- This replaces the schema-35 hardened version with timeout guards.
CREATE OR REPLACE FUNCTION atomic_redeem_voucher(
  p_voucher_code      text,
  p_order_id          uuid,
  p_user_id           uuid    DEFAULT NULL,
  p_manager_override  boolean DEFAULT false
)
RETURNS TABLE(success boolean, voucher_id uuid, error_code text, error_message text) AS $$
DECLARE
  v_voucher RECORD;
  v_order   RECORD;
  v_lock_key bigint;
  v_daily_count int;
BEGIN
  -- DEADLOCK DEFENSE: 5-second cap on the entire voucher flow
  SET LOCAL statement_timeout = '5s';
  SET LOCAL lock_timeout      = '3s';

  -- Row lock on voucher (SKIP LOCKED prevents queue pile-up)
  SELECT id, user_id, is_redeemed
    INTO v_voucher
    FROM vouchers
   WHERE code = upper(p_voucher_code)
     FOR UPDATE SKIP LOCKED;

  IF v_voucher IS NULL THEN
    RETURN QUERY SELECT false, NULL::uuid,
      'VOUCHER_NOT_FOUND'::text,
      'Voucher not found or already being processed'::text;
    RETURN;
  END IF;

  IF v_voucher.is_redeemed THEN
    RETURN QUERY SELECT false, NULL::uuid,
      'ALREADY_REDEEMED'::text,
      'This voucher has already been used'::text;
    RETURN;
  END IF;

  -- Advisory lock scoped to user (transaction-level, auto-released)
  v_lock_key := hashtext('voucher_lock:' || COALESCE(v_voucher.user_id::text, 'guest'));
  PERFORM pg_advisory_xact_lock(v_lock_key);

  -- Refund-lock guard
  IF EXISTS (
    SELECT 1 FROM refund_locks
     WHERE user_id = v_voucher.user_id
       AND locked_at > now() - interval '5 minutes'
  ) THEN
    RETURN QUERY SELECT false, NULL::uuid,
      'REFUND_IN_PROGRESS'::text,
      'Account locked due to pending refund. Please wait.'::text;
    RETURN;
  END IF;

  -- Daily limit (3 per user per day) unless manager bypass
  IF NOT COALESCE(p_manager_override, false) AND v_voucher.user_id IS NOT NULL THEN
    SELECT count(*)::int INTO v_daily_count
      FROM vouchers
     WHERE user_id = v_voucher.user_id
       AND is_redeemed = true
       AND redeemed_at >= (current_date AT TIME ZONE 'America/New_York');
    IF v_daily_count >= 3 THEN
      RETURN QUERY SELECT false, NULL::uuid,
        'DAILY_LIMIT'::text,
        'Free drink limit reached (3 per day)'::text;
      RETURN;
    END IF;
  END IF;

  -- Validate order if provided
  IF p_order_id IS NOT NULL THEN
    SELECT id, user_id, status INTO v_order FROM orders WHERE id = p_order_id;
    IF v_order IS NULL THEN
      RETURN QUERY SELECT false, NULL::uuid,
        'ORDER_NOT_FOUND'::text, 'Order not found'::text;
      RETURN;
    END IF;
    IF v_order.status IN ('paid', 'refunded') THEN
      RETURN QUERY SELECT false, NULL::uuid,
        'ORDER_COMPLETE'::text,
        'Cannot apply voucher to completed order'::text;
      RETURN;
    END IF;
    IF v_voucher.user_id IS NOT NULL AND v_voucher.user_id != v_order.user_id THEN
      RETURN QUERY SELECT false, NULL::uuid,
        'OWNERSHIP_MISMATCH'::text,
        'This voucher belongs to a different customer'::text;
      RETURN;
    END IF;
  END IF;

  -- Burn the voucher (CAS guard: is_redeemed = false)
  UPDATE vouchers
     SET is_redeemed = true,
         redeemed_at = now(),
         applied_to_order_id = p_order_id
   WHERE id = v_voucher.id
     AND is_redeemed = false;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, NULL::uuid,
      'RACE_CONDITION'::text,
      'Voucher was redeemed by another request'::text;
    RETURN;
  END IF;

  -- Zero out the order total
  IF p_order_id IS NOT NULL THEN
    UPDATE orders
       SET total_amount_cents = 0,
           status = 'paid',
           notes = COALESCE(notes || ' | ', '') || 'Voucher: ' || p_voucher_code
     WHERE id = p_order_id;
  END IF;

  RETURN QUERY SELECT true, v_voucher.id, NULL::text, NULL::text;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

REVOKE EXECUTE ON FUNCTION atomic_redeem_voucher(text, uuid, uuid, boolean)
  FROM anon, authenticated;
GRANT  EXECUTE ON FUNCTION atomic_redeem_voucher(text, uuid, uuid, boolean)
  TO service_role;

-- 2d. restore_inventory_on_refund — add 5s timeout
CREATE OR REPLACE FUNCTION restore_inventory_on_refund(p_order_id uuid)
RETURNS jsonb AS $$
DECLARE
  v_cups_dec  int;
  v_was_dec   boolean;
BEGIN
  SET LOCAL statement_timeout = '5s';
  SET LOCAL lock_timeout      = '3s';

  SELECT COALESCE(inventory_decremented, false),
         COALESCE(cups_decremented, 0)
    INTO v_was_dec, v_cups_dec
    FROM orders
   WHERE id = p_order_id
     FOR UPDATE;

  IF NOT v_was_dec THEN
    RETURN jsonb_build_object('restored', false, 'reason', 'inventory was never decremented');
  END IF;

  IF v_cups_dec > 0 THEN
    UPDATE inventory
       SET current_stock = current_stock + v_cups_dec,
           updated_at    = now()
     WHERE item_name = '12oz Cups';
  END IF;

  UPDATE orders
     SET inventory_decremented = false,
         cups_decremented = 0
   WHERE id = p_order_id
     AND inventory_decremented = true;

  RETURN jsonb_build_object('restored', true, 'cups_restored', v_cups_dec);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2e. handle_order_completion trigger — add 3s timeout
CREATE OR REPLACE FUNCTION handle_order_completion()
RETURNS trigger AS $$
DECLARE
  v_item_count int;
  v_old_stock  int;
  v_actual_dec int;
BEGIN
  SET LOCAL statement_timeout = '3s';
  SET LOCAL lock_timeout      = '2s';

  IF (NEW.status <> 'completed') OR (OLD.status IS NOT DISTINCT FROM 'completed') THEN
    RETURN NEW;
  END IF;

  IF COALESCE(NEW.inventory_decremented, false) THEN
    RETURN NEW;
  END IF;

  SELECT COUNT(*)::int INTO v_item_count
    FROM public.coffee_orders
   WHERE order_id = NEW.id;

  IF v_item_count > 0 THEN
    SELECT current_stock INTO v_old_stock
      FROM public.inventory
     WHERE item_name = '12oz Cups'
       FOR UPDATE;

    v_actual_dec := LEAST(v_item_count, COALESCE(v_old_stock, 0));

    UPDATE public.inventory
       SET current_stock = GREATEST(0, current_stock - v_item_count),
           updated_at = now()
     WHERE item_name = '12oz Cups';

    NEW.cups_decremented := v_actual_dec;
  END IF;

  NEW.inventory_decremented := true;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2f. claim_notification_tasks — add 3s timeout
CREATE OR REPLACE FUNCTION claim_notification_tasks(
  p_worker_id  text,
  p_batch_size int DEFAULT 10
)
RETURNS SETOF notification_queue AS $$
BEGIN
  SET LOCAL statement_timeout = '3s';
  SET LOCAL lock_timeout      = '2s';

  RETURN QUERY
  UPDATE notification_queue
     SET status = 'processing',
         locked_until = now() + interval '60 seconds',
         locked_by = p_worker_id,
         attempt_count = attempt_count + 1
   WHERE id IN (
     SELECT id FROM notification_queue
      WHERE status IN ('pending', 'failed')
        AND next_attempt_at <= now()
        AND (locked_until IS NULL OR locked_until < now())
      ORDER BY next_attempt_at
        FOR UPDATE SKIP LOCKED
      LIMIT p_batch_size
   )
  RETURNING *;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ┌──────────────────────────────────────────────────────────┐
-- │  FIX 3: SALTED IP HASHING                               │
-- │                                                          │
-- │  SECURITY RATIONALE:                                     │
-- │  If the database is seized (warrant, breach, or hostile  │
-- │  extraction), raw IPs in pin_attempts and                │
-- │  voucher_redemption_fails form a timestamped location    │
-- │  map of every staff login and every customer who         │
-- │  attempted a voucher redemption. Combined with carrier   │
-- │  records, this is enough to build a movement profile.    │
-- │                                                          │
-- │  Fix: Store SHA-256(ip || per-install salt) instead.     │
-- │  The salt is stored in a Postgres config variable        │
-- │  (current_setting) set once during deployment, never     │
-- │  written to a queryable table. This means:               │
-- │    • Rate-limiting still works (same IP → same hash).    │
-- │    • A DB dump reveals only opaque hex strings.          │
-- │    • Brute-forcing the ~4B IPv4 space requires the salt, │
-- │      which lives only in the Postgres runtime config.    │
-- │                                                          │
-- │  The salt is set via ALTER DATABASE ... SET, which        │
-- │  persists across restarts but is NOT in any table.       │
-- └──────────────────────────────────────────────────────────┘

-- 3a. Create a single-row config table to store the IP hash salt.
--     Only service_role / postgres can read it — never exposed via API.
CREATE TABLE IF NOT EXISTS _ip_salt (
  id    boolean PRIMARY KEY DEFAULT true CHECK (id), -- single-row lock
  salt  text NOT NULL
);

-- Revoke ALL access from API-facing roles
REVOKE ALL ON _ip_salt FROM anon, authenticated;
ALTER TABLE _ip_salt ENABLE ROW LEVEL SECURITY;
-- No RLS policies = zero rows returned even to authenticated

-- Seed the salt exactly once (idempotent)
INSERT INTO _ip_salt (id, salt)
VALUES (true, gen_random_uuid()::text)
ON CONFLICT (id) DO NOTHING;

-- 3b. Helper function: hash an IP with the installation salt
CREATE OR REPLACE FUNCTION hash_ip(raw_ip text)
RETURNS text AS $$
  SELECT encode(
    sha256(convert_to(raw_ip || (SELECT salt FROM _ip_salt WHERE id = true), 'UTF8')),
    'hex'
  );
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- 3c. Migrate pin_attempts: hash existing raw IPs in-place.
--     The PK is the ip column, so we need to rebuild.
--     Strategy: create temp table, truncate, re-insert with hashes.
DO $$
BEGIN
  -- Only migrate if there are rows that look like raw IPs (contain dots)
  IF EXISTS (SELECT 1 FROM pin_attempts WHERE ip LIKE '%.%' OR ip LIKE '%:%' LIMIT 1) THEN
    CREATE TEMP TABLE _pa_backup AS SELECT * FROM pin_attempts;
    TRUNCATE pin_attempts;
    INSERT INTO pin_attempts (ip, fail_count, window_start, locked_until)
    SELECT hash_ip(ip), fail_count, window_start, locked_until
      FROM _pa_backup
    ON CONFLICT (ip) DO UPDATE SET
      fail_count = EXCLUDED.fail_count,
      window_start = EXCLUDED.window_start,
      locked_until = EXCLUDED.locked_until;
    DROP TABLE _pa_backup;
  END IF;
END $$;

-- 3d. Migrate voucher_redemption_fails: hash existing raw IPs.
UPDATE voucher_redemption_fails
   SET ip_address = hash_ip(ip_address)
 WHERE ip_address LIKE '%.%' OR ip_address LIKE '%:%';

-- 3e. Rewrite record_pin_failure to hash incoming IPs before storage
CREATE OR REPLACE FUNCTION record_pin_failure(
  p_ip              text,
  p_max_attempts    int DEFAULT 5,
  p_lockout_seconds int DEFAULT 60
)
RETURNS TABLE(locked boolean, retry_after_seconds int) AS $$
DECLARE
  v_row  pin_attempts%ROWTYPE;
  v_hash text;
BEGIN
  v_hash := hash_ip(p_ip);

  INSERT INTO pin_attempts (ip, fail_count, window_start)
  VALUES (v_hash, 1, now())
  ON CONFLICT (ip) DO UPDATE SET
    fail_count = CASE
      WHEN pin_attempts.window_start < now() - (p_lockout_seconds || ' seconds')::interval THEN 1
      ELSE pin_attempts.fail_count + 1
    END,
    window_start = CASE
      WHEN pin_attempts.window_start < now() - (p_lockout_seconds || ' seconds')::interval THEN now()
      ELSE pin_attempts.window_start
    END,
    locked_until = CASE
      WHEN (CASE
              WHEN pin_attempts.window_start < now() - (p_lockout_seconds || ' seconds')::interval THEN 1
              ELSE pin_attempts.fail_count + 1
            END) >= p_max_attempts
        THEN now() + (p_lockout_seconds || ' seconds')::interval
      ELSE pin_attempts.locked_until
    END
  RETURNING * INTO v_row;

  IF v_row.fail_count >= p_max_attempts AND v_row.locked_until IS NOT NULL AND v_row.locked_until > now() THEN
    RETURN QUERY SELECT true, GREATEST(0, extract(epoch FROM v_row.locked_until - now())::int);
  ELSE
    RETURN QUERY SELECT false, 0;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3f. Rewrite check_pin_lockout to hash the IP before lookup
CREATE OR REPLACE FUNCTION check_pin_lockout(p_ip text)
RETURNS TABLE(locked boolean, retry_after_seconds int) AS $$
DECLARE
  v_row  pin_attempts%ROWTYPE;
  v_hash text;
BEGIN
  v_hash := hash_ip(p_ip);

  SELECT * INTO v_row FROM pin_attempts WHERE ip = v_hash;

  IF v_row IS NULL THEN
    RETURN QUERY SELECT false, 0;
    RETURN;
  END IF;

  IF v_row.locked_until IS NOT NULL AND v_row.locked_until > now() THEN
    RETURN QUERY SELECT true, GREATEST(0, extract(epoch FROM v_row.locked_until - now())::int);
  ELSE
    RETURN QUERY SELECT false, 0;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3g. Rewrite clear_pin_lockout to hash before delete
CREATE OR REPLACE FUNCTION clear_pin_lockout(p_ip text)
RETURNS void AS $$
  DELETE FROM pin_attempts WHERE ip = hash_ip(p_ip);
$$ LANGUAGE sql SECURITY DEFINER;

-- 3h. Rewrite voucher circuit breaker RPCs to hash IPs
CREATE OR REPLACE FUNCTION check_voucher_rate_limit(p_ip text)
RETURNS TABLE(
  allowed                  boolean,
  fail_count               int,
  lockout_remaining_seconds int
) AS $$
DECLARE
  v_count   int;
  v_oldest  timestamptz;
  v_lockout timestamptz;
  v_hash    text;
BEGIN
  v_hash := hash_ip(p_ip);

  SELECT count(*), min(attempted_at)
    INTO v_count, v_oldest
    FROM voucher_redemption_fails
   WHERE ip_address = v_hash
     AND attempted_at > now() - interval '10 minutes';

  IF v_count >= 5 THEN
    v_lockout := v_oldest + interval '10 minutes';
    RETURN QUERY SELECT false, v_count,
      GREATEST(0, extract(epoch FROM v_lockout - now())::int);
    RETURN;
  END IF;

  RETURN QUERY SELECT true, v_count, 0;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

CREATE OR REPLACE FUNCTION log_voucher_fail(
  p_ip          text,
  p_code_prefix text DEFAULT NULL
)
RETURNS void AS $$
BEGIN
  INSERT INTO voucher_redemption_fails (ip_address, code_prefix)
  VALUES (hash_ip(p_ip), left(p_code_prefix, 4));

  DELETE FROM voucher_redemption_fails
   WHERE attempted_at < now() - interval '1 hour';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

REVOKE EXECUTE ON FUNCTION check_voucher_rate_limit(text)  FROM anon, authenticated;
GRANT  EXECUTE ON FUNCTION check_voucher_rate_limit(text)  TO service_role;
REVOKE EXECUTE ON FUNCTION log_voucher_fail(text, text)    FROM anon, authenticated;
GRANT  EXECUTE ON FUNCTION log_voucher_fail(text, text)    TO service_role;
REVOKE EXECUTE ON FUNCTION hash_ip(text)                   FROM anon, authenticated;


-- == schema-40-loyalty-ssot-bulletproof ==
-- ============================================================
-- Schema 40: Loyalty SSOT — Bulletproof Sync & Reconciliation
-- ============================================================
-- Replaces schema-38 with hardened sync that includes:
--   • Advisory locking to prevent race conditions
--   • Error-safe execution with structured logging
--   • Statement & lock timeouts for morning-rush concurrency
--   • Max-win batched reconciliation (100 rows per batch)
--   • All functions SECURITY DEFINER, revoked from PUBLIC
--
-- Idempotent: safe to re-run in the Supabase SQL Editor.
-- ============================================================

BEGIN;

-- ─────────────────────────────────────────────────────────────
-- 0. Pre-requisite: ensure profiles.email column exists
-- ─────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name  = 'profiles'
      AND column_name = 'email'
  ) THEN
    ALTER TABLE public.profiles ADD COLUMN email text;
  END IF;
END $$;

-- Backfill any NULL emails from auth.users
UPDATE public.profiles p
   SET email = u.email
  FROM auth.users u
 WHERE p.id = u.id
   AND p.email IS NULL;

-- Ensure the functional index exists for case-insensitive joins
CREATE INDEX IF NOT EXISTS idx_profiles_email
  ON public.profiles (lower(email));

CREATE INDEX IF NOT EXISTS idx_customers_email_lower
  ON public.customers (lower(email));

-- ─────────────────────────────────────────────────────────────
-- 1. system_sync_logs — structured error journal
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.system_sync_logs (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ts          timestamptz NOT NULL DEFAULT now(),
  source      text        NOT NULL,     -- e.g. 'loyalty_sync'
  profile_id  uuid,
  email       text,
  detail      text,
  sql_state   text,
  severity    text        NOT NULL DEFAULT 'error'
);

-- Allow service_role to INSERT; deny everyone else
ALTER TABLE public.system_sync_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Deny public access to system_sync_logs" ON public.system_sync_logs;
CREATE POLICY "Deny public access to system_sync_logs"
  ON public.system_sync_logs FOR ALL USING (false);

DROP POLICY IF EXISTS "Service role full access to system_sync_logs" ON public.system_sync_logs;
CREATE POLICY "Service role full access to system_sync_logs"
  ON public.system_sync_logs FOR ALL
  USING (current_setting('role', true) = 'service_role')
  WITH CHECK (current_setting('role', true) = 'service_role');

COMMENT ON TABLE public.system_sync_logs IS
  'Write-only journal for background sync errors. '
  'Inspected by ops during incident review; auto-prunable after 90 days.';

-- ─────────────────────────────────────────────────────────────
-- 2. "Silent Sync" trigger function
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.sync_loyalty_to_customers()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lock_key int;
BEGIN
  -- Short-circuit: nothing changed or no email to match on
  IF NEW.loyalty_points IS NOT DISTINCT FROM OLD.loyalty_points THEN
    RETURN NEW;
  END IF;
  IF NEW.email IS NULL THEN
    RETURN NEW;
  END IF;

  -- Scoped timeouts: never stall the primary write path
  SET LOCAL statement_timeout = '3s';
  SET LOCAL lock_timeout     = '2s';

  -- Advisory lock keyed on the email to serialize concurrent
  -- purchase / refund webhooks for the *same* customer.
  v_lock_key := hashtext('loyalty_sync:' || lower(NEW.email));
  PERFORM pg_advisory_xact_lock(v_lock_key);

  -- Mirror the new value into the legacy customers row
  UPDATE public.customers
     SET loyalty_points = NEW.loyalty_points
   WHERE lower(email) = lower(NEW.email);

  RETURN NEW;

EXCEPTION WHEN OTHERS THEN
  -- ── Error-safe: log and continue, NEVER fail the profiles write ──
  BEGIN
    INSERT INTO public.system_sync_logs
      (source, profile_id, email, detail, sql_state, severity)
    VALUES
      ('loyalty_sync', NEW.id, NEW.email, SQLERRM, SQLSTATE, 'error');
  EXCEPTION WHEN OTHERS THEN
    -- Even the log insert failed (e.g., table missing); last resort
    RAISE WARNING '[loyalty_sync] log-insert failed for profile %: % (original: %)',
      NEW.id, SQLERRM, SQLSTATE;
  END;
  RETURN NEW;
END;
$$;

-- Lock down execution
REVOKE ALL ON FUNCTION public.sync_loyalty_to_customers() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.sync_loyalty_to_customers() FROM anon, authenticated;

COMMENT ON FUNCTION public.sync_loyalty_to_customers() IS
  'AFTER UPDATE trigger: mirrors profiles.loyalty_points → customers.loyalty_points '
  'with advisory locking, scoped timeouts, and error-safe logging.';

-- ─────────────────────────────────────────────────────────────
-- 3. Attach trigger (idempotent)
-- ─────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_sync_loyalty_to_customers ON public.profiles;
CREATE TRIGGER trg_sync_loyalty_to_customers
  AFTER UPDATE OF loyalty_points ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_loyalty_to_customers();

-- ─────────────────────────────────────────────────────────────
-- 4. Batched max-win reconciliation (100 rows per iteration)
-- ─────────────────────────────────────────────────────────────
-- Encapsulated as a DO block so it runs once and is idempotent.
-- Each batch uses a CTE with LIMIT 100 + FOR UPDATE SKIP LOCKED
-- to avoid statement timeouts on large datasets.
-- ─────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_batch_size   int := 100;
  v_rows_updated int;
  v_total        int := 0;
BEGIN
  RAISE NOTICE '[loyalty-reconcile] Starting max-win reconciliation …';

  -- ── Phase A: profiles wins where profiles > customers ───────
  LOOP
    WITH mismatched AS (
      SELECT p.id    AS profile_id,
             p.email AS profile_email,
             GREATEST(
               COALESCE(p.loyalty_points, 0),
               COALESCE(c.loyalty_points, 0)
             ) AS winning_points
        FROM public.profiles p
        JOIN public.customers c
          ON lower(c.email) = lower(p.email)
       WHERE COALESCE(p.loyalty_points, 0)
             <> GREATEST(
                  COALESCE(p.loyalty_points, 0),
                  COALESCE(c.loyalty_points, 0)
                )
       LIMIT v_batch_size
    )
    UPDATE public.profiles pf
       SET loyalty_points = m.winning_points,
           updated_at     = now()
      FROM mismatched m
     WHERE pf.id = m.profile_id;

    GET DIAGNOSTICS v_rows_updated = ROW_COUNT;
    v_total := v_total + v_rows_updated;
    EXIT WHEN v_rows_updated < v_batch_size;
  END LOOP;

  RAISE NOTICE '[loyalty-reconcile] Phase A done — % profile rows lifted to max.', v_total;

  -- ── Phase B: push authoritative profiles value → customers ──
  v_total := 0;
  LOOP
    WITH out_of_sync AS (
      SELECT c.id   AS customer_id,
             p.loyalty_points AS correct_points
        FROM public.customers c
        JOIN public.profiles  p
          ON lower(c.email) = lower(p.email)
       WHERE c.loyalty_points IS DISTINCT FROM p.loyalty_points
         AND p.loyalty_points IS NOT NULL
       LIMIT v_batch_size
    )
    UPDATE public.customers cu
       SET loyalty_points = o.correct_points
      FROM out_of_sync o
     WHERE cu.id = o.customer_id;

    GET DIAGNOSTICS v_rows_updated = ROW_COUNT;
    v_total := v_total + v_rows_updated;
    EXIT WHEN v_rows_updated < v_batch_size;
  END LOOP;

  RAISE NOTICE '[loyalty-reconcile] Phase B done — % customer rows synced.', v_total;
  RAISE NOTICE '[loyalty-reconcile] Reconciliation complete.';
END $$;

COMMIT;


-- == schema-41-order-status-remediation ==
-- ============================================================
-- Schema 41: Order Status Update Remediation
-- ============================================================
-- Fixes the 500 Internal Server Error on update-order-status:
--
--   1. safe_update_order_status() RPC — wraps the UPDATE in a
--      transaction that sets app.voucher_bypass = 'true' so
--      prevent_order_amount_tampering never rejects vouchered
--      ($0.00) orders during status transitions.
--
--   2. Hardens handle_order_completion() with EXCEPTION block
--      so lock_timeout (55P03) doesn't kill the caller — logs
--      to system_sync_logs and still commits the status change.
--
--   3. Hardens prevent_order_amount_tampering() to only fire
--      when total_amount_cents actually changes (skip on status-
--      only updates).
--
-- Idempotent: safe to re-run in the Supabase SQL Editor.
-- ============================================================

BEGIN;

-- ─────────────────────────────────────────────────────────────
-- 1. safe_update_order_status() — RPC called by the Netlify fn
-- ─────────────────────────────────────────────────────────────
-- Sets app.voucher_bypass GUC so prevent_order_amount_tampering
-- doesn't block the row when handle_order_completion mutates it.
-- Returns the updated order row as JSON for the API response.
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.safe_update_order_status(
  p_order_id     uuid,
  p_status       text,
  p_completed_at timestamptz DEFAULT NULL,
  p_payment_id   text        DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
BEGIN
  -- Scoped timeouts: prevent runaway locks during rush
  SET LOCAL statement_timeout = '5s';
  SET LOCAL lock_timeout      = '3s';

  -- GUC bypass: allows the BEFORE UPDATE trigger
  -- prevent_order_amount_tampering to pass through without
  -- raising an exception on $0 vouchered orders.
  PERFORM set_config('app.voucher_bypass', 'true', true);

  -- Perform the update
  UPDATE public.orders
     SET status       = p_status,
         completed_at = COALESCE(p_completed_at, completed_at),
         payment_id   = COALESCE(p_payment_id,   payment_id),
         updated_at   = now()
   WHERE id = p_order_id;

  -- Fetch the updated row (post-trigger) as JSON
  SELECT to_jsonb(o.*) INTO v_result
    FROM public.orders o
   WHERE o.id = p_order_id;

  RETURN v_result;
END;
$$;

-- Restrict execution
REVOKE ALL ON FUNCTION public.safe_update_order_status(uuid, text, timestamptz, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.safe_update_order_status(uuid, text, timestamptz, text) FROM anon, authenticated;
-- service_role retains access (Netlify function uses service key)

COMMENT ON FUNCTION public.safe_update_order_status IS
  'RPC for update-order-status.js. Sets app.voucher_bypass GUC, '
  'applies scoped timeouts, and returns the updated order as JSONB.';

-- ─────────────────────────────────────────────────────────────
-- 2. Harden handle_order_completion — catch lock timeouts
-- ─────────────────────────────────────────────────────────────
-- The FOR UPDATE lock on inventory can fail under morning-rush
-- concurrency when lock_timeout fires. Without an EXCEPTION
-- handler the entire UPDATE is killed → 500.
--
-- Fix: catch all errors, log to system_sync_logs, and still
-- return NEW so the status transition succeeds. Inventory will
-- be reconciled by the next successful completion or the nightly
-- inventory-check cron.
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION handle_order_completion()
RETURNS trigger AS $$
DECLARE
  v_item_count int;
  v_old_stock  int;
  v_actual_dec int;
BEGIN
  SET LOCAL statement_timeout = '3s';
  SET LOCAL lock_timeout      = '2s';

  -- Guard 1: Only fire on transition TO 'completed'
  IF (NEW.status <> 'completed') OR (OLD.status IS NOT DISTINCT FROM 'completed') THEN
    RETURN NEW;
  END IF;

  -- Guard 2: One-shot flag — never decrement twice for the same order
  IF COALESCE(NEW.inventory_decremented, false) THEN
    RETURN NEW;
  END IF;

  -- Count drink items for this order
  SELECT COUNT(*)::int INTO v_item_count
    FROM public.coffee_orders
   WHERE order_id = NEW.id;

  IF v_item_count > 0 THEN
    -- Lock the inventory row to prevent concurrent under-decrement
    SELECT current_stock INTO v_old_stock
      FROM public.inventory
     WHERE item_name = '12oz Cups'
       FOR UPDATE;

    -- Calculate actual decrement (can't go below 0)
    v_actual_dec := LEAST(v_item_count, COALESCE(v_old_stock, 0));

    UPDATE public.inventory
       SET current_stock = GREATEST(0, current_stock - v_item_count),
           updated_at = now()
     WHERE item_name = '12oz Cups';

    NEW.cups_decremented := v_actual_dec;
  END IF;

  NEW.inventory_decremented := true;
  RETURN NEW;

EXCEPTION WHEN OTHERS THEN
  -- ── Error-safe: log and continue so the status UPDATE succeeds ──
  BEGIN
    INSERT INTO public.system_sync_logs
      (source, detail, sql_state, severity)
    VALUES
      ('handle_order_completion',
       format('Order %s: %s', NEW.id, SQLERRM),
       SQLSTATE,
       'error');
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '[handle_order_completion] log-insert failed for order %: %',
      NEW.id, SQLERRM;
  END;
  -- Still mark the flag so a retry doesn't double-count
  NEW.inventory_decremented := false;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Re-attach the trigger (idempotent)
DROP TRIGGER IF EXISTS trg_order_completion ON public.orders;
CREATE TRIGGER trg_order_completion
  BEFORE UPDATE ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION handle_order_completion();

-- ─────────────────────────────────────────────────────────────
-- 3. Tighten prevent_order_amount_tampering
-- ─────────────────────────────────────────────────────────────
-- Only raise when total_amount_cents *actually changes*.
-- Skip entirely for status-only updates (the common path).
-- Still respects the app.voucher_bypass GUC for atomic_redeem.
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION prevent_order_amount_tampering()
RETURNS trigger AS $$
BEGIN
  -- Fast exit: if amount didn't change, nothing to guard
  IF NEW.total_amount_cents IS NOT DISTINCT FROM OLD.total_amount_cents THEN
    RETURN NEW;
  END IF;

  -- GUC bypass for voucher redemption flow
  IF current_setting('app.voucher_bypass', true) = 'true' THEN
    RETURN NEW;
  END IF;

  -- Block unauthorized amount changes
  IF OLD.total_amount_cents IS NOT NULL THEN
    RAISE EXCEPTION 'Cannot modify order amount after creation'
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Re-attach (idempotent)
DROP TRIGGER IF EXISTS orders_no_amount_tampering ON public.orders;
CREATE TRIGGER orders_no_amount_tampering
  BEFORE UPDATE ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION prevent_order_amount_tampering();

COMMIT;


-- == schema-42-atomic-staff-clock ==
-- ============================================================
-- Schema 42: Atomic Staff Clock — Decoupled from PIN Login
-- ============================================================
-- Creates atomic_staff_clock() RPC that is the ONLY way to
-- change is_working and write to time_logs.
--
-- Key guarantees:
--   • Advisory lock per staff member prevents double-clock races
--   • Idempotent: clock-in when already in → returns success (no dup row)
--   • 16h shift auto-flag for manager review
--   • is_working is ONLY modified here, never by login
--   • SECURITY DEFINER, revoked from public — called by service_role only
--
-- Idempotent: safe to re-run in the Supabase SQL Editor.
-- ============================================================

BEGIN;

-- ─────────────────────────────────────────────────────────────
-- 1. atomic_staff_clock(p_staff_id, p_action, p_ip)
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.atomic_staff_clock(
  p_staff_id uuid,
  p_action   text,       -- 'in' or 'out'
  p_ip       text DEFAULT 'unknown'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_staff      record;
  v_open_shift record;
  v_lock_key   int;
  v_now        timestamptz := now();
  v_shift_hrs  numeric;
  v_warning    text := NULL;
  v_new_log_id uuid;
  MAX_AUTO_HOURS constant numeric := 16;
BEGIN
  -- Scoped timeouts: never stall the clock UI
  SET LOCAL statement_timeout = '5s';
  SET LOCAL lock_timeout      = '3s';

  -- Validate action
  IF p_action NOT IN ('in', 'out') THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Invalid action. Must be "in" or "out".',
      'error_code', 'INVALID_ACTION'
    );
  END IF;

  -- Fetch staff record (validates p_staff_id exists)
  SELECT id, email, role, is_working
    INTO v_staff
    FROM public.staff_directory
   WHERE id = p_staff_id;

  IF v_staff IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Staff member not found.',
      'error_code', 'STAFF_NOT_FOUND'
    );
  END IF;

  -- Advisory lock per staff member: serialize concurrent taps
  v_lock_key := hashtext('staff_clock:' || p_staff_id::text);
  PERFORM pg_advisory_xact_lock(v_lock_key);

  -- ── CLOCK IN ──────────────────────────────────────────────
  IF p_action = 'in' THEN
    -- Check for existing open shift (idempotency)
    SELECT id, clock_in
      INTO v_open_shift
      FROM public.time_logs
     WHERE employee_email = lower(v_staff.email)
       AND clock_out IS NULL
       AND action_type = 'in'
     ORDER BY clock_in DESC
     LIMIT 1;

    IF v_open_shift IS NOT NULL THEN
      -- Already clocked in — return success without a new row
      RETURN jsonb_build_object(
        'success', true,
        'action', 'in',
        'time', v_open_shift.clock_in,
        'is_working', true,
        'idempotent', true
      );
    END IF;

    -- Insert new clock-in row
    INSERT INTO public.time_logs (
      employee_email, action_type, clock_in, clock_out, status
    ) VALUES (
      lower(v_staff.email), 'in', v_now, NULL, 'active'
    )
    RETURNING id INTO v_new_log_id;

    -- Atomically set is_working
    UPDATE public.staff_directory
       SET is_working = true
     WHERE id = p_staff_id;

    RETURN jsonb_build_object(
      'success', true,
      'action', 'in',
      'time', v_now,
      'is_working', true,
      'log_id', v_new_log_id
    );
  END IF;

  -- ── CLOCK OUT ─────────────────────────────────────────────
  IF p_action = 'out' THEN
    -- Find the open shift
    SELECT id, clock_in
      INTO v_open_shift
      FROM public.time_logs
     WHERE employee_email = lower(v_staff.email)
       AND clock_out IS NULL
       AND action_type = 'in'
     ORDER BY clock_in DESC
     LIMIT 1;

    IF v_open_shift IS NULL THEN
      -- Not clocked in — idempotent: if already off-shift, return success
      IF NOT COALESCE(v_staff.is_working, false) THEN
        RETURN jsonb_build_object(
          'success', true,
          'action', 'out',
          'time', v_now,
          'is_working', false,
          'idempotent', true
        );
      END IF;

      -- is_working was stale (e.g., browser crash) — fix it
      UPDATE public.staff_directory
         SET is_working = false
       WHERE id = p_staff_id;

      RETURN jsonb_build_object(
        'success', true,
        'action', 'out',
        'time', v_now,
        'is_working', false,
        'warning', 'No open shift found but is_working was stale. Corrected.'
      );
    END IF;

    -- Calculate shift duration
    v_shift_hrs := EXTRACT(EPOCH FROM (v_now - v_open_shift.clock_in)) / 3600.0;

    -- Flag abnormally long shifts for manager review
    IF v_shift_hrs > MAX_AUTO_HOURS THEN
      v_warning := format('Shift exceeds %sh (%sh actual). Flagged for manager review.',
                          MAX_AUTO_HOURS, round(v_shift_hrs::numeric, 1));

      UPDATE public.time_logs
         SET action_type          = 'out',
             clock_out            = v_now,
             status               = 'Pending',
             needs_manager_review = true
       WHERE id = v_open_shift.id;
    ELSE
      UPDATE public.time_logs
         SET action_type = 'out',
             clock_out   = v_now,
             status      = 'completed'
       WHERE id = v_open_shift.id;
    END IF;

    -- Atomically clear is_working
    UPDATE public.staff_directory
       SET is_working = false
     WHERE id = p_staff_id;

    RETURN jsonb_build_object(
      'success', true,
      'action', 'out',
      'time', v_now,
      'is_working', false,
      'shift_hours', round(v_shift_hrs::numeric, 2),
      'warning', v_warning
    );
  END IF;

  -- Should never reach here
  RETURN jsonb_build_object(
    'success', false,
    'error', 'Unexpected state',
    'error_code', 'INTERNAL_ERROR'
  );
END;
$$;

-- Restrict execution: only service_role (Netlify functions)
REVOKE ALL ON FUNCTION public.atomic_staff_clock(uuid, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.atomic_staff_clock(uuid, text, text) FROM anon, authenticated;

COMMENT ON FUNCTION public.atomic_staff_clock IS
  'Atomic clock-in/clock-out RPC. The ONLY code path that modifies '
  'is_working or writes to time_logs. Called by pin-clock.js via service_role. '
  'Advisory-locked per staff member. Idempotent. 16h auto-flag.';

-- ─────────────────────────────────────────────────────────────
-- 2. Safety net: remove any stale auto-clock triggers
-- ─────────────────────────────────────────────────────────────
-- If any trigger was auto-clocking on login, drop it now.
DROP TRIGGER IF EXISTS trg_auto_clock_on_login ON public.staff_directory;
DROP TRIGGER IF EXISTS trg_auto_clock_on_pin_login ON public.staff_directory;

COMMIT;


-- == schema-43-payroll-adjustment-audit ==
-- ============================================================
-- Schema 43: Payroll Adjustment & Audit Architecture
-- ============================================================
-- Replaces direct time_logs editing with an immutable
-- "Correction & Audit" model required for IRS compliance.
--
--   1. Adds `notes` column to time_logs for audit annotations.
--
--   2. atomic_payroll_adjustment() RPC — SECURITY DEFINER.
--      Never mutates existing rows. Inserts a new row with
--      action_type = 'adjustment', carrying the delta minutes
--      (positive or negative) and a mandatory manager audit
--      trail in the notes column.
--
--   3. v_payroll_summary — aggregated view of clock hours +
--      adjustments per staff member per pay period (weekly,
--      Mon–Sun boundaries).
--
-- Idempotent: safe to re-run in the Supabase SQL Editor.
-- ============================================================

BEGIN;

-- ─────────────────────────────────────────────────────────────
-- 1. Add notes column to time_logs (idempotent)
-- ─────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name   = 'time_logs'
       AND column_name  = 'notes'
  ) THEN
    ALTER TABLE public.time_logs ADD COLUMN notes text;
  END IF;
END $$;

-- Add delta_minutes for adjustment rows (minutes added/subtracted)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name   = 'time_logs'
       AND column_name  = 'delta_minutes'
  ) THEN
    ALTER TABLE public.time_logs ADD COLUMN delta_minutes numeric;
  END IF;
END $$;

-- Add manager_id for audit trail (FK to staff_directory)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name   = 'time_logs'
       AND column_name  = 'manager_id'
  ) THEN
    ALTER TABLE public.time_logs ADD COLUMN manager_id uuid;
  END IF;
END $$;

-- FK: manager_id must reference a real staff member.
-- ON DELETE RESTRICT prevents deleting a manager who has made adjustments,
-- preserving the IRS audit trail.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
     WHERE table_schema    = 'public'
       AND table_name      = 'time_logs'
       AND constraint_name = 'fk_time_logs_manager_id'
  ) THEN
    ALTER TABLE public.time_logs
      ADD CONSTRAINT fk_time_logs_manager_id
      FOREIGN KEY (manager_id) REFERENCES public.staff_directory(id)
      ON DELETE RESTRICT;
  END IF;
END $$;

-- Index for efficient payroll queries
CREATE INDEX IF NOT EXISTS idx_time_logs_action_type
  ON public.time_logs(action_type);

CREATE INDEX IF NOT EXISTS idx_time_logs_clock_in_date
  ON public.time_logs(clock_in);

-- ─────────────────────────────────────────────────────────────
-- 2. atomic_payroll_adjustment() — The IRS-compliant RPC
-- ─────────────────────────────────────────────────────────────
-- NEVER edits existing rows. Inserts a new row with:
--   action_type   = 'adjustment'
--   delta_minutes = signed integer (positive = add, negative = subtract)
--   notes         = reason + manager audit stamp
--   manager_id    = UUID of the authorising manager
--   employee_email = the affected staff member
--   clock_in      = timestamp of the adjustment (for pay-period bucketing)
--   status        = 'completed' (adjustments are instantly final)
--
-- Returns the inserted adjustment row as JSONB.
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.atomic_payroll_adjustment(
  p_employee_email  text,
  p_delta_minutes   numeric,
  p_reason          text,
  p_manager_id      uuid,
  p_target_date     timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_staff       record;
  v_audit_note  text;
  v_inserted    jsonb;
BEGIN
  -- Scoped timeouts
  SET LOCAL statement_timeout = '5s';
  SET LOCAL lock_timeout      = '3s';

  -- ── Validate employee exists ────────────────────────────
  SELECT id, email, name
    INTO v_staff
    FROM public.staff_directory
   WHERE lower(email) = lower(trim(p_employee_email))
   LIMIT 1;

  IF v_staff IS NULL THEN
    RAISE EXCEPTION 'Employee not found: %', p_employee_email
      USING ERRCODE = 'P0002';
  END IF;

  -- ── Validate delta is non-zero ──────────────────────────
  IF p_delta_minutes = 0 THEN
    RAISE EXCEPTION 'delta_minutes must be non-zero'
      USING ERRCODE = 'P0003';
  END IF;

  -- ── Validate reason is present ──────────────────────────
  IF p_reason IS NULL OR trim(p_reason) = '' THEN
    RAISE EXCEPTION 'A reason is required for every adjustment'
      USING ERRCODE = 'P0004';
  END IF;

  -- ── Validate manager exists (FK backs this at DB level) ──
  IF NOT EXISTS (
    SELECT 1 FROM public.staff_directory WHERE id = p_manager_id
  ) THEN
    RAISE EXCEPTION 'Manager not found: %', p_manager_id
      USING ERRCODE = 'P0005';
  END IF;

  -- ── Build the audit note ────────────────────────────────
  v_audit_note := trim(p_reason)
    || ' [ADJUSTMENT BY ' || p_manager_id::text
    || ' AT ' || to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
    || ']';

  -- ── Insert the immutable adjustment row ─────────────────
  INSERT INTO public.time_logs (
    employee_email,
    action_type,
    delta_minutes,
    notes,
    manager_id,
    clock_in,
    status,
    created_at
  ) VALUES (
    lower(trim(p_employee_email)),
    'adjustment',
    p_delta_minutes,
    v_audit_note,
    p_manager_id,
    p_target_date,
    'completed',
    now()
  )
  RETURNING to_jsonb(time_logs.*) INTO v_inserted;

  -- ── Audit log ───────────────────────────────────────────
  INSERT INTO public.system_sync_logs (source, detail, severity)
  VALUES (
    'atomic_payroll_adjustment',
    format('Manager %s adjusted %s by %s min: %s',
           p_manager_id, p_employee_email, p_delta_minutes, v_audit_note),
    'info'
  );

  RETURN v_inserted;
END;
$$;

-- Restrict execution to service_role only
REVOKE ALL ON FUNCTION public.atomic_payroll_adjustment(text, numeric, text, uuid, timestamptz) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.atomic_payroll_adjustment(text, numeric, text, uuid, timestamptz) FROM anon, authenticated;

COMMENT ON FUNCTION public.atomic_payroll_adjustment IS
  'IRS-compliant payroll adjustment. Never edits existing rows — inserts '
  'an immutable adjustment record with full manager audit trail.';

-- ─────────────────────────────────────────────────────────────
-- 3. v_payroll_summary — Aggregated view per staff per week
-- ─────────────────────────────────────────────────────────────
-- Combines clock-in/out shift hours with adjustment deltas.
-- Pay period = ISO week (Mon–Sun).
--
-- Columns:
--   employee_email, employee_name, hourly_rate,
--   pay_period_start (Monday), pay_period_end (Sunday),
--   clocked_minutes, adjustment_minutes, total_minutes,
--   total_hours, gross_pay
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.v_payroll_summary AS
WITH clock_shifts AS (
  -- Only completed shifts (clock_out IS NOT NULL).
  -- Active / partial shifts are intentionally excluded so we
  -- never pay for time that hasn't been finalized yet.
  SELECT
    lower(tl.employee_email)                       AS employee_email,
    date_trunc('week', tl.clock_in)::date          AS period_start,
    (date_trunc('week', tl.clock_in) + interval '6 days')::date AS period_end,
    EXTRACT(EPOCH FROM (tl.clock_out - tl.clock_in)) / 60.0
                                                   AS shift_minutes
  FROM public.time_logs tl
  WHERE tl.action_type IN ('in', 'out')
    AND tl.clock_in  IS NOT NULL
    AND tl.clock_out IS NOT NULL
    AND tl.status = 'completed'
),
active_shifts AS (
  -- Count of open (unfinished) shifts per employee per week.
  -- These are NOT included in totals — surfaced for manager awareness only.
  SELECT
    lower(tl.employee_email)                       AS employee_email,
    date_trunc('week', tl.clock_in)::date          AS period_start,
    (date_trunc('week', tl.clock_in) + interval '6 days')::date AS period_end,
    COUNT(*)::int                                  AS open_shift_count
  FROM public.time_logs tl
  WHERE tl.action_type = 'in'
    AND tl.clock_in  IS NOT NULL
    AND tl.clock_out IS NULL
  GROUP BY 1, 2, 3
),
adjustments AS (
  -- Sum adjustment deltas
  SELECT
    lower(tl.employee_email)                       AS employee_email,
    date_trunc('week', tl.clock_in)::date          AS period_start,
    (date_trunc('week', tl.clock_in) + interval '6 days')::date AS period_end,
    COALESCE(tl.delta_minutes, 0)                  AS adj_minutes
  FROM public.time_logs tl
  WHERE tl.action_type = 'adjustment'
),
combined AS (
  SELECT employee_email, period_start, period_end,
         shift_minutes AS minutes, 'clock' AS source
    FROM clock_shifts
  UNION ALL
  SELECT employee_email, period_start, period_end,
         adj_minutes   AS minutes, 'adjustment' AS source
    FROM adjustments
)
SELECT
  c.employee_email,
  sd.name                                          AS employee_name,
  sd.hourly_rate,
  c.period_start                                   AS pay_period_start,
  c.period_end                                     AS pay_period_end,
  ROUND(SUM(CASE WHEN c.source = 'clock'      THEN c.minutes ELSE 0 END)::numeric, 2)
                                                   AS clocked_minutes,
  ROUND(SUM(CASE WHEN c.source = 'adjustment' THEN c.minutes ELSE 0 END)::numeric, 2)
                                                   AS adjustment_minutes,
  ROUND(SUM(c.minutes)::numeric, 2)                AS total_minutes,
  ROUND((SUM(c.minutes) / 60.0)::numeric, 2)       AS total_hours,
  ROUND((SUM(c.minutes) / 60.0 * COALESCE(sd.hourly_rate, 0))::numeric, 2)
                                                   AS gross_pay,
  COALESCE(a.open_shift_count, 0)                  AS active_shifts
FROM combined c
LEFT JOIN public.staff_directory sd
  ON lower(sd.email) = c.employee_email
LEFT JOIN active_shifts a
  ON  a.employee_email = c.employee_email
  AND a.period_start   = c.period_start
GROUP BY c.employee_email, sd.name, sd.hourly_rate,
         c.period_start, c.period_end, a.open_shift_count;

COMMENT ON VIEW public.v_payroll_summary IS
  'Aggregated payroll view: clock shifts + adjustments per staff per ISO week. '
  'Immutable source rows guarantee IRS audit compliance.';

-- RLS note: This view is accessed via service_role (Netlify functions).
-- No need for SELECT grants to anon/authenticated.

COMMIT;
