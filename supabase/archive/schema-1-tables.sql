-- ============================================================
-- BREWHUB SCHEMA PART 1: Core Tables
-- Synced with live Supabase DB: 2026-02-17
-- ============================================================

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
