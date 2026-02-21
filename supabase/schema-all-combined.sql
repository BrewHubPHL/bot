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
CREATE OR REPLACE FUNCTION restore_inventory_on_refund(p_order_id uuid)
RETURNS jsonb AS $$
DECLARE
  v_cups_dec  int;
  v_was_dec   boolean;
BEGIN
  SELECT COALESCE(inventory_decremented, false),
         COALESCE(cups_decremented, 0)
  INTO v_was_dec, v_cups_dec
  FROM orders WHERE id = p_order_id;

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
  WHERE id = p_order_id;

  RETURN jsonb_build_object('restored', true, 'cups_restored', v_cups_dec);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
