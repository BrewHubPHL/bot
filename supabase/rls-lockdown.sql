-- ============================================================
-- BREWHUB SECURITY LOCKDOWN: Row Level Security (RLS) Policies
-- ============================================================
-- 
-- CRITICAL: Run this in the Supabase SQL Editor to protect 
-- against attackers with access to your Anon Key.
--
-- Without these policies, ANYONE with your public Anon Key can:
--   ❌ Read ALL customer data (emails, phones, addresses)
--   ❌ Read ALL voucher codes and redeem them
--   ❌ Read ALL parcel tracking info
--   ❌ Read your entire inventory
--   ❌ Query orders and sales data
--
-- These policies enforce Zero Trust at the database level.
-- ============================================================

-- 1. CUSTOMERS TABLE
-- Staff only via service_role key. Portal users cannot see other customers.
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Deny all public access to customers" ON customers;
CREATE POLICY "Deny all public access to customers" ON customers
  FOR ALL USING (false);

-- 2. VOUCHERS TABLE  
-- Users can only see their OWN vouchers
ALTER TABLE vouchers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users see own vouchers only" ON vouchers;
CREATE POLICY "Users see own vouchers only" ON vouchers
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Deny public insert/update/delete on vouchers" ON vouchers;
CREATE POLICY "Deny public insert/update/delete on vouchers" ON vouchers
  FOR ALL USING (false);

-- Grant SELECT back for authenticated users on their own rows
DROP POLICY IF EXISTS "Authenticated users read own vouchers" ON vouchers;
CREATE POLICY "Authenticated users read own vouchers" ON vouchers
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

-- 3. EXPECTED_PARCELS TABLE
-- Users see only their own expected parcels
ALTER TABLE expected_parcels ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users see own expected parcels" ON expected_parcels;
CREATE POLICY "Users see own expected parcels" ON expected_parcels
  FOR SELECT TO authenticated USING (customer_email = auth.jwt() ->> 'email');

DROP POLICY IF EXISTS "Deny all other access to expected_parcels" ON expected_parcels;
CREATE POLICY "Deny all other access to expected_parcels" ON expected_parcels
  FOR ALL USING (false);

-- 4. PARCELS TABLE
-- Staff only via service_role. No email column exists in this table.
-- Portal users should query via expected_parcels instead.
ALTER TABLE parcels ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Deny all public access to parcels" ON parcels;
CREATE POLICY "Deny all public access to parcels" ON parcels
  FOR ALL USING (false);

-- 5. ORDERS TABLE
-- Users see only their own orders
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;

-- UNIQUE constraint on payment_id to prevent double-spend at DB level
-- NOTE: First add the column if it doesn't exist
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_id text;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS notes text;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS square_order_id text;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS customer_name text;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS customer_email text;

-- Add unique constraint (ignore error if already exists)
DO $$ 
BEGIN
  ALTER TABLE orders ADD CONSTRAINT orders_payment_id_unique UNIQUE (payment_id);
EXCEPTION
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_object THEN NULL;
END $$;

-- Prevent modification of critical financial fields after creation
-- This trigger rejects any attempt to change total_amount_cents
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
  FOR EACH ROW
  EXECUTE FUNCTION prevent_order_amount_tampering();

DROP POLICY IF EXISTS "Users see own orders" ON orders;
CREATE POLICY "Users see own orders" ON orders
  FOR SELECT TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Deny all other access to orders" ON orders;
CREATE POLICY "Deny all other access to orders" ON orders
  FOR ALL USING (false);

-- 5B. REVOKED_USERS TABLE
-- Used to immediately revoke staff access by user_id
CREATE TABLE IF NOT EXISTS revoked_users (
  user_id uuid PRIMARY KEY,
  revoked_at timestamptz NOT NULL DEFAULT now(),
  reason text
);

ALTER TABLE revoked_users ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Deny all public access to revoked_users" ON revoked_users;
CREATE POLICY "Deny all public access to revoked_users" ON revoked_users
  FOR ALL USING (false);

-- 5C. WEBHOOK_EVENTS TABLE
-- Deduplication table for webhook retries (stores Supabase event IDs)
CREATE TABLE IF NOT EXISTS webhook_events (
  event_id text PRIMARY KEY,
  source text DEFAULT 'supabase',
  received_at timestamptz NOT NULL DEFAULT now(),
  payload jsonb
);

ALTER TABLE webhook_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Deny all public access to webhook_events" ON webhook_events;
CREATE POLICY "Deny all public access to webhook_events" ON webhook_events
  FOR ALL USING (false);

-- 6. INVENTORY TABLE
-- Staff only via service_role. No public/anon access.
ALTER TABLE inventory ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Deny all public access to inventory" ON inventory;
CREATE POLICY "Deny all public access to inventory" ON inventory
  FOR ALL USING (false);

-- 7. RESIDENTS TABLE
-- Staff only via service_role. Contains PII.
ALTER TABLE residents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Deny all public access to residents" ON residents;
CREATE POLICY "Deny all public access to residents" ON residents
  FOR ALL USING (false);

-- 8. PROFILES TABLE
-- Users see only their own profile
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users see own profile" ON profiles;
CREATE POLICY "Users see own profile" ON profiles
  FOR SELECT TO authenticated USING (id = auth.uid());

DROP POLICY IF EXISTS "Users update own profile" ON profiles;
CREATE POLICY "Users update own profile" ON profiles
  FOR UPDATE TO authenticated USING (id = auth.uid());

-- 9. SITE_SETTINGS TABLE
-- Read-only for public (shop_enabled toggle), no writes
ALTER TABLE site_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public can read site_settings" ON site_settings;
CREATE POLICY "Public can read site_settings" ON site_settings
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "Deny public writes to site_settings" ON site_settings;
CREATE POLICY "Deny public writes to site_settings" ON site_settings
  FOR INSERT WITH CHECK (false);

DROP POLICY IF EXISTS "Deny public updates to site_settings" ON site_settings;
CREATE POLICY "Deny public updates to site_settings" ON site_settings
  FOR UPDATE USING (false);

-- 10. MERCH_PRODUCTS TABLE
-- Read-only for public (product catalog)
ALTER TABLE merch_products ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public can read products" ON merch_products;
CREATE POLICY "Public can read products" ON merch_products
  FOR SELECT USING (is_active = true);

DROP POLICY IF EXISTS "Deny public writes to products" ON merch_products;
CREATE POLICY "Deny public writes to products" ON merch_products
  FOR INSERT WITH CHECK (false);

DROP POLICY IF EXISTS "Deny public updates to products" ON merch_products;
CREATE POLICY "Deny public updates to products" ON merch_products
  FOR UPDATE USING (false);

-- 11. WAITLIST TABLE
-- Public can INSERT (sign up), but cannot read others' emails
ALTER TABLE waitlist ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public can insert to waitlist" ON waitlist;
CREATE POLICY "Public can insert to waitlist" ON waitlist
  FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "Deny public reads from waitlist" ON waitlist;
CREATE POLICY "Deny public reads from waitlist" ON waitlist
  FOR SELECT USING (false);

-- ============================================================
-- API_USAGE TABLE & CIRCUIT BREAKER RPC
-- ============================================================
-- This table tracks daily API usage to prevent denial-of-wallet attacks.

CREATE TABLE IF NOT EXISTS api_usage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_name text NOT NULL,
  usage_date date NOT NULL DEFAULT CURRENT_DATE,
  call_count int NOT NULL DEFAULT 0,
  daily_limit int NOT NULL DEFAULT 100,
  created_at timestamptz DEFAULT now(),
  UNIQUE(service_name, usage_date)
);

-- Insert default quotas for known services
INSERT INTO api_usage (service_name, usage_date, call_count, daily_limit)
VALUES 
  ('elevenlabs_public', CURRENT_DATE, 0, 50),
  ('elevenlabs_convai', CURRENT_DATE, 0, 25),
  ('gemini_marketing', CURRENT_DATE, 0, 20),
  ('square_checkout', CURRENT_DATE, 0, 500)
ON CONFLICT (service_name, usage_date) DO NOTHING;

-- Atomic increment function that returns true if under limit
CREATE OR REPLACE FUNCTION increment_api_usage(p_service text)
RETURNS boolean AS $$
DECLARE
  v_under_limit boolean;
BEGIN
  -- Upsert the row for today
  INSERT INTO api_usage (service_name, usage_date, call_count, daily_limit)
  VALUES (p_service, CURRENT_DATE, 1, 100)
  ON CONFLICT (service_name, usage_date) 
  DO UPDATE SET call_count = api_usage.call_count + 1;
  
  -- Check if we're still under the limit
  SELECT call_count <= daily_limit INTO v_under_limit
  FROM api_usage
  WHERE service_name = p_service AND usage_date = CURRENT_DATE;
  
  RETURN COALESCE(v_under_limit, false);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- INVENTORY ATOMIC ADJUSTMENT RPC
-- ============================================================
-- Prevents race conditions when multiple baristas scan simultaneously

CREATE OR REPLACE FUNCTION adjust_inventory_quantity(p_id uuid, p_delta int)
RETURNS void AS $$
  UPDATE inventory 
  SET current_stock = GREATEST(0, current_stock + p_delta),
      updated_at = now()
  WHERE id = p_id;
$$ LANGUAGE sql SECURITY DEFINER;

-- 12. API_USAGE TABLE (Circuit Breaker)
-- No public access. Service role only.
ALTER TABLE api_usage ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Deny all public access to api_usage" ON api_usage;
CREATE POLICY "Deny all public access to api_usage" ON api_usage
  FOR ALL USING (false);

-- ============================================================
-- 13. STAFF_DIRECTORY TABLE (SSoT for Identity)
-- ============================================================
-- Replaces STAFF_ALLOWLIST env var. This table is the Source of Truth
-- for who is allowed to access the admin functionality.
--
-- TOKEN VERSIONING: The `token_version` column is incremented whenever
-- the user's role changes or their access is modified. On each API request,
-- we compare the JWT's issued-at time against `version_updated_at`.
-- If the token was issued BEFORE the version bump, we force re-auth.

CREATE TABLE IF NOT EXISTS staff_directory (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  role text NOT NULL CHECK (role IN ('staff', 'manager', 'admin')),
  full_name text,
  token_version int NOT NULL DEFAULT 1,
  version_updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz DEFAULT now()
);

-- Add token versioning columns if table already exists (migration)
ALTER TABLE staff_directory ADD COLUMN IF NOT EXISTS token_version int NOT NULL DEFAULT 1;
ALTER TABLE staff_directory ADD COLUMN IF NOT EXISTS version_updated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE staff_directory ENABLE ROW LEVEL SECURITY;

-- No public access (Service Role only for lookup, Admins for edits if we add RLS for them later)
DROP POLICY IF EXISTS "Deny all public access to staff_directory" ON staff_directory;
CREATE POLICY "Deny all public access to staff_directory" ON staff_directory
  FOR ALL USING (false);

-- ============================================================
-- 13B. AUTOMATIC TOKEN INVALIDATION ON ROLE CHANGE
-- ============================================================
-- This trigger automatically increments token_version when:
--   1. The role changes (demotion or promotion)
--   2. The email changes (in case of account transfer)
-- 
-- Effect: All existing sessions for this user become invalid.

CREATE OR REPLACE FUNCTION staff_role_change_invalidator()
RETURNS TRIGGER AS $$
BEGIN
  -- Only bump version if role or email actually changed
  IF OLD.role IS DISTINCT FROM NEW.role OR OLD.email IS DISTINCT FROM NEW.email THEN
    NEW.token_version := OLD.token_version + 1;
    NEW.version_updated_at := now();
    
    -- Log for audit trail
    RAISE NOTICE '[TOKEN INVALIDATION] User % role changed: % → %. New version: %', 
      OLD.email, OLD.role, NEW.role, NEW.token_version;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS staff_role_change_trigger ON staff_directory;
CREATE TRIGGER staff_role_change_trigger
  BEFORE UPDATE ON staff_directory
  FOR EACH ROW
  EXECUTE FUNCTION staff_role_change_invalidator();

-- ============================================================
-- 13C. MANUAL SESSION INVALIDATION RPC
-- ============================================================
-- Call this to immediately invalidate all sessions for a user.
-- Use cases:
--   - Security incident response
--   - User requests "log me out everywhere"
--   - Admin forces re-authentication after policy change

CREATE OR REPLACE FUNCTION invalidate_staff_sessions(p_email text)
RETURNS void AS $$
  UPDATE staff_directory
  SET 
    token_version = token_version + 1,
    version_updated_at = now()
  WHERE lower(email) = lower(p_email);
$$ LANGUAGE sql SECURITY DEFINER;

-- ============================================================
-- 13D. BULK SESSION INVALIDATION (Emergency)
-- ============================================================
-- Forces ALL staff to re-authenticate. Use after:
--   - Security breach detection
--   - Major permission policy changes
--   - Credential rotation

CREATE OR REPLACE FUNCTION invalidate_all_staff_sessions()
RETURNS int AS $$
DECLARE
  v_count int;
BEGIN
  UPDATE staff_directory
  SET 
    token_version = token_version + 1,
    version_updated_at = now();
  
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- 14. REFUND_LOCKS TABLE (TOCTOU Prevention)
-- ============================================================
-- Inserted when a refund is initiated. Prevents voucher redemption
-- while the refund is being processed.

CREATE TABLE IF NOT EXISTS refund_locks (
  payment_id text PRIMARY KEY,
  locked_at timestamptz NOT NULL DEFAULT now(),
  user_id uuid
);

ALTER TABLE refund_locks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Deny all public access to refund_locks" ON refund_locks;
CREATE POLICY "Deny all public access to refund_locks" ON refund_locks
  FOR ALL USING (false);

-- ============================================================
-- 15. PROCESSED_WEBHOOKS TABLE (Atomic Idempotency Ledger)
-- ============================================================
-- This table enforces "first writer wins" for webhook processing.
-- The UNIQUE constraint on event_key guarantees atomicity.

CREATE TABLE IF NOT EXISTS processed_webhooks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_key text NOT NULL UNIQUE,  -- e.g., 'square:payment.updated:pay_abc123'
  event_type text NOT NULL,
  source text NOT NULL DEFAULT 'square',
  processed_at timestamptz NOT NULL DEFAULT now(),
  payload jsonb
);

ALTER TABLE processed_webhooks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Deny all public access to processed_webhooks" ON processed_webhooks;
CREATE POLICY "Deny all public access to processed_webhooks" ON processed_webhooks
  FOR ALL USING (false);

-- ============================================================
-- 15B. ATOMIC VOUCHER REDEMPTION RPC (Race-to-Redeem Fix)
-- ============================================================
-- Uses pg_advisory_xact_lock to prevent concurrent voucher redemption
-- during refund processing. This closes the 10ms race window between
-- refund.created and voucher_redeem requests.
--
-- How it works:
-- 1. Acquire a transaction-level advisory lock on the user's ID
-- 2. Check for active refund locks (fails if refund in progress)
-- 3. Atomically burn the voucher within the same transaction
-- 4. Lock auto-releases on COMMIT or ROLLBACK

CREATE OR REPLACE FUNCTION atomic_redeem_voucher(
  p_voucher_code text,
  p_order_id uuid,
  p_user_id uuid DEFAULT NULL
)
RETURNS TABLE(
  success boolean,
  voucher_id uuid,
  error_code text,
  error_message text
) AS $$
DECLARE
  v_voucher RECORD;
  v_order RECORD;
  v_lock_key bigint;
BEGIN
  -- 1. Look up the voucher first (before locking)
  SELECT id, user_id, is_redeemed INTO v_voucher
  FROM vouchers
  WHERE code = upper(p_voucher_code)
  FOR UPDATE SKIP LOCKED;  -- Skip if another transaction has it
  
  IF v_voucher IS NULL THEN
    RETURN QUERY SELECT false, NULL::uuid, 'VOUCHER_NOT_FOUND'::text, 
      'Voucher not found or already being processed'::text;
    RETURN;
  END IF;
  
  IF v_voucher.is_redeemed THEN
    RETURN QUERY SELECT false, NULL::uuid, 'ALREADY_REDEEMED'::text,
      'This voucher has already been used'::text;
    RETURN;
  END IF;
  
  -- 2. Acquire TRANSACTION-LEVEL advisory lock on user ID
  -- This serializes all voucher operations for this user
  v_lock_key := hashtext('voucher_lock:' || COALESCE(v_voucher.user_id::text, 'guest'));
  PERFORM pg_advisory_xact_lock(v_lock_key);
  
  -- 3. Check for active refund lock (CRITICAL: race-to-redeem prevention)
  IF EXISTS (
    SELECT 1 FROM refund_locks 
    WHERE user_id = v_voucher.user_id
      AND locked_at > now() - interval '5 minutes'  -- Ignore stale locks
  ) THEN
    RETURN QUERY SELECT false, NULL::uuid, 'REFUND_IN_PROGRESS'::text,
      'Account locked due to pending refund. Please wait.'::text;
    RETURN;
  END IF;
  
  -- 4. Validate the order (if provided)
  IF p_order_id IS NOT NULL THEN
    SELECT id, user_id, status, total_amount_cents INTO v_order
    FROM orders WHERE id = p_order_id;
    
    IF v_order IS NULL THEN
      RETURN QUERY SELECT false, NULL::uuid, 'ORDER_NOT_FOUND'::text,
        'Order not found'::text;
      RETURN;
    END IF;
    
    IF v_order.status IN ('paid', 'refunded') THEN
      RETURN QUERY SELECT false, NULL::uuid, 'ORDER_COMPLETE'::text,
        'Cannot apply voucher to completed or refunded order'::text;
      RETURN;
    END IF;
    
    -- Ownership check: voucher must belong to order's user (if assigned)
    IF v_voucher.user_id IS NOT NULL AND v_voucher.user_id != v_order.user_id THEN
      RETURN QUERY SELECT false, NULL::uuid, 'OWNERSHIP_MISMATCH'::text,
        'This voucher belongs to a different customer'::text;
      RETURN;
    END IF;
  END IF;
  
  -- 5. ATOMIC BURN: Update voucher and order in same transaction
  UPDATE vouchers
  SET 
    is_redeemed = true,
    redeemed_at = now(),
    applied_to_order_id = p_order_id
  WHERE id = v_voucher.id AND is_redeemed = false;
  
  IF NOT FOUND THEN
    -- Race condition: another transaction beat us
    RETURN QUERY SELECT false, NULL::uuid, 'RACE_CONDITION'::text,
      'Voucher was redeemed by another request'::text;
    RETURN;
  END IF;
  
  -- 6. Apply discount to order if provided
  IF p_order_id IS NOT NULL THEN
    UPDATE orders
    SET 
      total_amount_cents = 0,
      status = 'paid',
      notes = COALESCE(notes || ' | ', '') || 'Voucher: ' || p_voucher_code
    WHERE id = p_order_id;
  END IF;
  
  -- Success!
  RETURN QUERY SELECT true, v_voucher.id, NULL::text, NULL::text;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- 16. ATOMIC INCREMENT_LOYALTY RPC
-- ============================================================
-- Uses UPDATE ... RETURNING to atomically increment and return new value.
-- This prevents read-modify-write races.
--
-- FINANCIAL CONSISTENCY FIX: Points are calculated based on the net
-- payment amount (after refunds/chargebacks). We track paid_amount_cents
-- on the order to compute deltas correctly for partial refunds.

-- Drop existing function first (required when changing return type)
DROP FUNCTION IF EXISTS increment_loyalty(uuid);
DROP FUNCTION IF EXISTS increment_loyalty(uuid, int);
DROP FUNCTION IF EXISTS increment_loyalty(uuid, int, uuid);

CREATE OR REPLACE FUNCTION increment_loyalty(
  target_user_id uuid, 
  amount_cents int,
  p_order_id uuid DEFAULT NULL
)
RETURNS TABLE(loyalty_points int, voucher_earned boolean, points_awarded int) AS $$
DECLARE
  v_new_points int;
  v_voucher_earned boolean := false;
  v_points_delta int;
  v_previous_amount int := 0;
BEGIN
  -- FINANCIAL CONSISTENCY: Calculate points based on NET payment
  -- 1 point per 100 cents (i.e., per dollar spent)
  -- For partial refunds, we compute delta from previous paid amount
  
  IF p_order_id IS NOT NULL THEN
    -- Check if this order already awarded points (for partial refund handling)
    SELECT COALESCE(paid_amount_cents, 0) INTO v_previous_amount
    FROM orders WHERE id = p_order_id;
  END IF;
  
  -- Points = floor(amount / 100) - prevents rounding inflation
  -- Example: $4.99 = 4 points (not 5)
  v_points_delta := GREATEST(0, floor(amount_cents / 100)::int - floor(v_previous_amount / 100)::int);
  
  -- Skip if no points to award (prevents zero-point transactions)
  IF v_points_delta <= 0 THEN
    RETURN QUERY SELECT COALESCE(
      (SELECT profiles.loyalty_points FROM profiles WHERE id = target_user_id), 0
    ), false, 0;
    RETURN;
  END IF;

  -- Atomic increment using UPDATE ... RETURNING
  UPDATE profiles
  SET loyalty_points = COALESCE(loyalty_points, 0) + v_points_delta
  WHERE id = target_user_id
  RETURNING profiles.loyalty_points INTO v_new_points;

  -- Check if voucher threshold crossed (every 500 points)
  -- Only trigger if we CROSSED the threshold with this transaction
  IF v_new_points IS NOT NULL AND 
     v_new_points >= 500 AND 
     (v_new_points - v_points_delta) % 500 > (v_new_points % 500) THEN
    v_voucher_earned := true;
  END IF;

  RETURN QUERY SELECT v_new_points, v_voucher_earned, v_points_delta;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Legacy wrapper for backward compatibility (50 points fixed)
CREATE OR REPLACE FUNCTION increment_loyalty_legacy(target_user_id uuid, points_delta int DEFAULT 50)
RETURNS TABLE(loyalty_points int, voucher_earned boolean) AS $$
DECLARE
  v_new_points int;
  v_voucher_earned boolean := false;
BEGIN
  UPDATE profiles
  SET loyalty_points = COALESCE(loyalty_points, 0) + points_delta
  WHERE id = target_user_id
  RETURNING profiles.loyalty_points INTO v_new_points;

  IF v_new_points IS NOT NULL AND v_new_points % 500 = 0 AND v_new_points > 0 THEN
    v_voucher_earned := true;
  END IF;

  RETURN QUERY SELECT v_new_points, v_voucher_earned;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- 17. DELETION_TOMBSTONES TABLE (GDPR "Right to be Forgotten")
-- ============================================================
-- Permanent record of deleted PII. This table is the authoritative
-- source for "this data must NEVER be re-imported from external systems."
-- 
-- The tombstone survives forever to prevent zombie resurrection.

CREATE TABLE IF NOT EXISTS deletion_tombstones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  table_name text NOT NULL,
  record_key text NOT NULL,           -- e.g., email or user_id
  key_type text NOT NULL DEFAULT 'email',
  deleted_at timestamptz NOT NULL DEFAULT now(),
  deleted_by text,                    -- Admin who performed deletion
  reason text DEFAULT 'GDPR Article 17 - Right to Erasure',
  UNIQUE(table_name, record_key)
);

ALTER TABLE deletion_tombstones ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Deny all public access to deletion_tombstones" ON deletion_tombstones;
CREATE POLICY "Deny all public access to deletion_tombstones" ON deletion_tombstones
  FOR ALL USING (false);

-- ============================================================
-- 17B. GDPR SALT TABLE (Secret for Hashing Secondary Identifiers)
-- ============================================================
-- Stores a cryptographically random salt used to hash PII-adjacent IDs.
-- This salt MUST be backed up securely — if lost, hashed IDs become orphans.
-- Generate once per installation; never expose or log this value.

CREATE TABLE IF NOT EXISTS gdpr_secrets (
  key text PRIMARY KEY,
  value text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Initialize with a random salt if not exists
INSERT INTO gdpr_secrets (key, value)
VALUES ('pii_hash_salt', encode(gen_random_bytes(32), 'hex'))
ON CONFLICT (key) DO NOTHING;

ALTER TABLE gdpr_secrets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Deny all public access to gdpr_secrets" ON gdpr_secrets;
CREATE POLICY "Deny all public access to gdpr_secrets" ON gdpr_secrets
  FOR ALL USING (false);

-- ============================================================
-- 17C. PII HASH FUNCTION (One-Way Anonymization)
-- ============================================================
-- Hashes an identifier with a secret salt using SHA-256.
-- Result is prefixed with 'GDPR_' to indicate anonymized data.
-- The hash is deterministic within an installation but un-reversible.
--
-- Example: 'pay_abc123' → 'GDPR_7f83b1657ff1fc...'

CREATE OR REPLACE FUNCTION hash_pii_identifier(p_identifier text)
RETURNS text AS $$
DECLARE
  v_salt text;
BEGIN
  -- Return NULL unchanged (preserves NULLability for reporting)
  IF p_identifier IS NULL THEN
    RETURN NULL;
  END IF;

  -- Fetch the installation-specific salt
  SELECT value INTO v_salt FROM gdpr_secrets WHERE key = 'pii_hash_salt';
  
  IF v_salt IS NULL THEN
    RAISE EXCEPTION 'GDPR salt not initialized. Run installation setup.';
  END IF;

  -- Return salted SHA-256 hash with GDPR prefix
  RETURN 'GDPR_' || encode(digest(v_salt || p_identifier, 'sha256'), 'hex');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- ============================================================
-- 18. GDPR-SAFE DELETION RPC
-- ============================================================
-- Use this function instead of raw DELETE to ensure tombstone creation.
-- This guarantees the Google Sheet sync can never resurrect the data.

CREATE OR REPLACE FUNCTION gdpr_delete_customer(
  p_email text,
  p_deleted_by text DEFAULT 'system'
)
RETURNS boolean AS $$
DECLARE
  v_deleted boolean := false;
  v_profile_ids uuid[];
BEGIN
  -- Capture profile IDs upfront (they'll be deleted at the end)
  SELECT array_agg(id) INTO v_profile_ids
  FROM profiles WHERE lower(email) = lower(p_email);

  -- ═══════════════════════════════════════════════════════════
  -- STEP 1: TOMBSTONES (prevents resurrection via sync)
  -- ═══════════════════════════════════════════════════════════
  INSERT INTO deletion_tombstones (table_name, record_key, key_type, deleted_by, reason)
  VALUES ('customers', lower(p_email), 'email', p_deleted_by, 'GDPR Article 17 - Right to Erasure')
  ON CONFLICT (table_name, record_key) DO NOTHING;

  INSERT INTO deletion_tombstones (table_name, record_key, key_type, deleted_by, reason)
  VALUES ('waitlist', lower(p_email), 'email', p_deleted_by, 'GDPR Article 17 - Cascaded')
  ON CONFLICT (table_name, record_key) DO NOTHING;

  INSERT INTO deletion_tombstones (table_name, record_key, key_type, deleted_by, reason)
  VALUES ('marketing_leads', lower(p_email), 'email', p_deleted_by, 'GDPR Article 17 - Cascaded')
  ON CONFLICT (table_name, record_key) DO NOTHING;

  -- ═══════════════════════════════════════════════════════════
  -- STEP 2: BREAK FK CONSTRAINTS (children before parents)
  -- ═══════════════════════════════════════════════════════════
  
  -- 2a. Sever voucher links to profile AND orders
  UPDATE vouchers SET user_id = NULL, applied_to_order_id = NULL
  WHERE user_id = ANY(v_profile_ids);

  -- 2b. Sever coffee_orders links to profile
  UPDATE coffee_orders SET customer_id = NULL, guest_name = 'GDPR Deleted'
  WHERE customer_id = ANY(v_profile_ids);

  -- ═══════════════════════════════════════════════════════════
  -- STEP 3: ANONYMIZE ORDERS (preserve financial data, strip PII)
  -- ═══════════════════════════════════════════════════════════
  -- Primary PII: name, email → cleared
  -- Secondary Identifiers: payment_id, square_order_id → salted hash
  -- This preserves uniqueness for reporting while preventing re-identification
  -- via cross-referencing with Square/Stripe logs.
  UPDATE orders SET 
    user_id = NULL,
    customer_name = 'GDPR Deleted',
    customer_email = NULL,
    -- Hash secondary identifiers to prevent cross-referencing attacks
    payment_id = hash_pii_identifier(payment_id),
    square_order_id = hash_pii_identifier(square_order_id),
    notes = 'GDPR Anonymized on ' || now()::date
  WHERE user_id = ANY(v_profile_ids)
     OR lower(customer_email) = lower(p_email);

  -- ═══════════════════════════════════════════════════════════
  -- STEP 4: HARD DELETE LEAF TABLES (no children reference these)
  -- ═══════════════════════════════════════════════════════════
  DELETE FROM customers WHERE lower(email) = lower(p_email);
  DELETE FROM waitlist WHERE lower(email) = lower(p_email);
  DELETE FROM marketing_leads WHERE lower(email) = lower(p_email);
  DELETE FROM expected_parcels WHERE lower(customer_email) = lower(p_email);

  -- ═══════════════════════════════════════════════════════════
  -- STEP 5: DELETE PROFILE (parent - must be last)
  -- ═══════════════════════════════════════════════════════════
  DELETE FROM profiles WHERE id = ANY(v_profile_ids);

  v_deleted := (v_profile_ids IS NOT NULL AND array_length(v_profile_ids, 1) > 0);
  RETURN v_deleted;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- 19. TOMBSTONE CHECK RPC
-- ============================================================
-- Called by sync functions before upserting any data.
-- Returns TRUE if the record is tombstoned (must NOT be imported).

CREATE OR REPLACE FUNCTION is_tombstoned(p_table text, p_key text)
RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1 FROM deletion_tombstones
    WHERE table_name = p_table AND record_key = lower(p_key)
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- ============================================================
-- 20. NOTIFICATION_QUEUE TABLE (Transactional Outbox Pattern)
-- ============================================================
-- Ensures notifications are NEVER lost even if the primary function crashes.
-- The parcel-check-in flow inserts into parcels AND this queue atomically.
-- A background worker processes pending tasks with retry logic.
--
-- States: pending → processing → completed | failed | dead_letter

CREATE TABLE IF NOT EXISTS notification_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_type text NOT NULL,                    -- 'parcel_arrived', 'voucher_issued', etc.
  payload jsonb NOT NULL,                     -- All data needed to send notification
  status text NOT NULL DEFAULT 'pending'      -- pending, processing, completed, failed, dead_letter
    CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'dead_letter')),
  attempt_count int NOT NULL DEFAULT 0,
  max_attempts int NOT NULL DEFAULT 3,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  locked_until timestamptz,                   -- Prevents concurrent processing
  locked_by text,                             -- Worker ID for debugging
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  last_error text,
  source_table text,                          -- 'parcels', 'vouchers', etc.
  source_id uuid                              -- FK to source record for debugging
);

-- Index for efficient worker queries
CREATE INDEX IF NOT EXISTS idx_notification_queue_pending 
  ON notification_queue (status, next_attempt_at) 
  WHERE status IN ('pending', 'failed');

ALTER TABLE notification_queue ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Deny all public access to notification_queue" ON notification_queue;
CREATE POLICY "Deny all public access to notification_queue" ON notification_queue
  FOR ALL USING (false);

-- ============================================================
-- 21. QUEUE ENQUEUE RPC (Atomic Insert)
-- ============================================================
-- Called by parcel-check-in.js to atomically queue a notification.
-- Returns the queue task ID for tracking.

CREATE OR REPLACE FUNCTION enqueue_notification(
  p_task_type text,
  p_payload jsonb,
  p_source_table text DEFAULT NULL,
  p_source_id uuid DEFAULT NULL
)
RETURNS uuid AS $$
DECLARE
  v_task_id uuid;
BEGIN
  INSERT INTO notification_queue (task_type, payload, source_table, source_id)
  VALUES (p_task_type, p_payload, p_source_table, p_source_id)
  RETURNING id INTO v_task_id;
  
  RETURN v_task_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- 22. QUEUE CLAIM RPC (Lock for Processing)
-- ============================================================
-- Workers call this to atomically claim pending tasks.
-- Uses SELECT FOR UPDATE SKIP LOCKED to prevent race conditions.
-- Lock expires after 60 seconds if worker crashes.

CREATE OR REPLACE FUNCTION claim_notification_tasks(
  p_worker_id text,
  p_batch_size int DEFAULT 10
)
RETURNS SETOF notification_queue AS $$
BEGIN
  RETURN QUERY
  UPDATE notification_queue
  SET 
    status = 'processing',
    locked_until = now() + interval '60 seconds',
    locked_by = p_worker_id,
    attempt_count = attempt_count + 1
  WHERE id IN (
    SELECT id FROM notification_queue
    WHERE status IN ('pending', 'failed')
      AND next_attempt_at <= now()
      AND (locked_until IS NULL OR locked_until < now())
    ORDER BY next_attempt_at ASC
    FOR UPDATE SKIP LOCKED
    LIMIT p_batch_size
  )
  RETURNING *;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- 23. QUEUE COMPLETE RPC (Mark Success)
-- ============================================================

CREATE OR REPLACE FUNCTION complete_notification(p_task_id uuid)
RETURNS void AS $$
  UPDATE notification_queue
  SET 
    status = 'completed',
    completed_at = now(),
    locked_until = NULL,
    locked_by = NULL
  WHERE id = p_task_id;
$$ LANGUAGE sql SECURITY DEFINER;

-- ============================================================
-- 24. QUEUE FAIL RPC (Mark Failed with Retry)
-- ============================================================
-- Implements exponential backoff: 1 min, 5 min, 15 min
-- After max_attempts, moves to dead_letter for manual intervention.

CREATE OR REPLACE FUNCTION fail_notification(
  p_task_id uuid,
  p_error text
)
RETURNS void AS $$
DECLARE
  v_attempts int;
  v_max int;
  v_backoff_minutes int;
BEGIN
  SELECT attempt_count, max_attempts INTO v_attempts, v_max
  FROM notification_queue WHERE id = p_task_id;

  -- Calculate exponential backoff
  v_backoff_minutes := POWER(2, LEAST(v_attempts, 4));  -- 2, 4, 8, 16 min max

  IF v_attempts >= v_max THEN
    -- Move to dead letter queue
    UPDATE notification_queue
    SET 
      status = 'dead_letter',
      last_error = p_error,
      locked_until = NULL,
      locked_by = NULL
    WHERE id = p_task_id;
  ELSE
    -- Schedule retry with backoff
    UPDATE notification_queue
    SET 
      status = 'failed',
      next_attempt_at = now() + (v_backoff_minutes * interval '1 minute'),
      last_error = p_error,
      locked_until = NULL,
      locked_by = NULL
    WHERE id = p_task_id;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- 25. PARCEL CHECK-IN ATOMIC RPC (Two-Phase Commit Pattern)
-- ============================================================
-- Combines parcel insert + notification queue in a single transaction.
-- If either fails, both roll back. No limbo state possible.

CREATE OR REPLACE FUNCTION atomic_parcel_checkin(
  p_tracking_number text,
  p_carrier text,
  p_recipient_name text,
  p_recipient_phone text DEFAULT NULL,
  p_recipient_email text DEFAULT NULL,
  p_unit_number text DEFAULT NULL,
  p_match_type text DEFAULT 'manual'
)
RETURNS TABLE(parcel_id uuid, queue_task_id uuid) AS $$
DECLARE
  v_parcel_id uuid;
  v_queue_id uuid;
BEGIN
  -- Phase 1: Insert parcel with status 'pending_notification'
  INSERT INTO parcels (
    tracking_number, carrier, recipient_name, recipient_phone,
    unit_number, status, received_at, match_type
  ) VALUES (
    p_tracking_number, p_carrier, p_recipient_name, p_recipient_phone,
    p_unit_number, 'pending_notification', now(), p_match_type
  )
  RETURNING id INTO v_parcel_id;

  -- Phase 2: Queue notification (same transaction)
  INSERT INTO notification_queue (task_type, payload, source_table, source_id)
  VALUES (
    'parcel_arrived',
    jsonb_build_object(
      'recipient_name', p_recipient_name,
      'recipient_phone', p_recipient_phone,
      'recipient_email', p_recipient_email,
      'tracking_number', p_tracking_number,
      'carrier', p_carrier,
      'unit_number', p_unit_number
    ),
    'parcels',
    v_parcel_id
  )
  RETURNING id INTO v_queue_id;

  -- Return both IDs for tracking
  RETURN QUERY SELECT v_parcel_id, v_queue_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- VERIFICATION QUERY
-- Run this after applying policies to confirm RLS is enabled:
-- ============================================================
-- SELECT tablename, rowsecurity 
-- FROM pg_tables 
-- WHERE schemaname = 'public' 
-- ORDER BY tablename;

-- ============================================================
-- IMPORTANT NOTES:
-- ============================================================
-- 1. Netlify functions use SUPABASE_SERVICE_ROLE_KEY which 
--    bypasses RLS. This is intentional for backend operations.
--
-- 2. Client-side code (public HTML pages) use the ANON_KEY.
--    These policies protect against abuse from the client.
--
-- 3. If you need staff to access data from the browser, 
--    you'll need a custom role or JWT claims-based policies.
--
-- 4. Some policies may need adjustment if table schemas differ.
--    Check for errors in the Supabase Dashboard logs.
-- ============================================================
