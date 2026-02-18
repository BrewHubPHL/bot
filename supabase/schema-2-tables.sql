-- ============================================================
-- BREWHUB SCHEMA PART 2: More Tables
-- Synced with live Supabase DB: 2026-02-17
-- ============================================================

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

-- 33. BREWHUB_NNN_SUMMARY (view or table)
CREATE TABLE IF NOT EXISTS brewhub_nnn_summary (
  property_address text,
  total_taxes numeric,
  total_insurance numeric,
  total_cam numeric,
  total_tenant_billback numeric
);

-- 34. DAILY_SALES_REPORT (likely a view, represented as table for reference)
-- CREATE VIEW daily_sales_report AS SELECT ... ;

-- ============================================================
-- PERFORMANCE INDEXES
-- ============================================================

-- Orders: frequently filtered by status
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at DESC);

-- Coffee orders: frequently joined with orders
CREATE INDEX IF NOT EXISTS idx_coffee_orders_order_id ON coffee_orders(order_id);

-- Parcels: frequently filtered by status
CREATE INDEX IF NOT EXISTS idx_parcels_status ON parcels(status);
CREATE INDEX IF NOT EXISTS idx_parcels_received_at ON parcels(received_at DESC);

-- Time logs: queried by employee
CREATE INDEX IF NOT EXISTS idx_time_logs_employee_email ON time_logs(employee_email);
CREATE INDEX IF NOT EXISTS idx_time_logs_status ON time_logs(status);

-- Expected parcels: lookup by tracking number
CREATE INDEX IF NOT EXISTS idx_expected_tracking ON expected_parcels(tracking_number);
