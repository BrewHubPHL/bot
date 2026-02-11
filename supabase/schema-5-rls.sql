-- ============================================================
-- BREWHUB SCHEMA PART 5: RLS Policies
-- ============================================================

-- Enable RLS on all tables
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

-- Public read access for site_settings and merch_products
DROP POLICY IF EXISTS "Public can read site_settings" ON site_settings;
CREATE POLICY "Public can read site_settings" ON site_settings FOR SELECT USING (true);

DROP POLICY IF EXISTS "Public can read active products" ON merch_products;
CREATE POLICY "Public can read active products" ON merch_products FOR SELECT USING (is_active = true);

DROP POLICY IF EXISTS "Public can insert to waitlist" ON waitlist;
CREATE POLICY "Public can insert to waitlist" ON waitlist FOR INSERT WITH CHECK (true);

-- Deny-all policies for service-role-only tables
-- Exception: staff can read their own row for client-side auth verification
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

-- Explicit deny policies for remaining tables (implicit deny exists, but explicit is clearer)
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
