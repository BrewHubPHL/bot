-- ============================================================
-- BREWHUB SCHEMA PART 1: Core Tables
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 1. STAFF_DIRECTORY
CREATE TABLE IF NOT EXISTS staff_directory (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  role text NOT NULL CHECK (role IN ('staff', 'manager', 'admin')),
  full_name text,
  token_version int NOT NULL DEFAULT 1,
  version_updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz DEFAULT now()
);

-- 2. TIME_LOGS
CREATE TABLE IF NOT EXISTS time_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id text,
  employee_email text,
  clock_in timestamptz,
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
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL UNIQUE,
  value jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

INSERT INTO site_settings (key, value) VALUES 
  ('shop_enabled', 'true'),
  ('cafe_enabled', 'true'),
  ('parcels_enabled', 'true')
ON CONFLICT (key) DO NOTHING;

-- 5. WAITLIST
CREATE TABLE IF NOT EXISTS waitlist (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  created_at timestamptz DEFAULT now()
);

-- 6. CUSTOMERS
CREATE TABLE IF NOT EXISTS customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  name text,
  address text,
  phone text,
  sms_opt_in boolean DEFAULT false,
  loyalty_points int DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- 7. PROFILES
CREATE TABLE IF NOT EXISTS profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text,
  full_name text,
  loyalty_points int DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- 8. ORDERS
CREATE TABLE IF NOT EXISTS orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'preparing', 'ready', 'completed', 'refunded', 'cancelled')),
  total_amount_cents int NOT NULL DEFAULT 0,
  paid_amount_cents int DEFAULT 0,
  payment_id text UNIQUE,
  square_order_id text,
  customer_name text,
  customer_email text,
  notes text,
  inventory_decremented boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- 9. COFFEE_ORDERS
CREATE TABLE IF NOT EXISTS coffee_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid REFERENCES orders(id) ON DELETE CASCADE,
  drink_name text NOT NULL,
  price numeric(10,2),
  customizations jsonb,
  status text DEFAULT 'pending',
  customer_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
  guest_name text,
  created_at timestamptz DEFAULT now()
);

-- 10. VOUCHERS
CREATE TABLE IF NOT EXISTS vouchers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
  code text NOT NULL UNIQUE,
  is_redeemed boolean DEFAULT false,
  redeemed_at timestamptz,
  applied_to_order_id uuid REFERENCES orders(id) ON DELETE SET NULL,
  qr_code_base64 text,
  created_at timestamptz DEFAULT now()
);

-- 11. MERCH_PRODUCTS
CREATE TABLE IF NOT EXISTS merch_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  price_cents int NOT NULL,
  description text,
  image_url text,
  checkout_url text,
  is_active boolean DEFAULT true,
  sort_order int DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- 12. INVENTORY
CREATE TABLE IF NOT EXISTS inventory (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  barcode text UNIQUE NOT NULL,
  item_name text NOT NULL,
  current_stock int DEFAULT 0,
  min_threshold int DEFAULT 10,
  unit text DEFAULT 'units',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
