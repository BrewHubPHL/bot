-- 1. site_settings: Public can SELECT (for shop status)
ALTER TABLE site_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public can read site_settings" ON site_settings;
CREATE POLICY "Public can read site_settings" ON site_settings
  FOR SELECT USING (true);

-- 2. time_logs: Only service role can INSERT (backend functions)
ALTER TABLE time_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Deny all public access to time_logs" ON time_logs;
CREATE POLICY "Deny all public access to time_logs" ON time_logs
  FOR ALL USING (false);

-- 3. staff_directory: Only service role can INSERT/UPDATE/DELETE (admin only)
ALTER TABLE staff_directory ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Deny all public access to staff_directory" ON staff_directory;
CREATE POLICY "Deny all public access to staff_directory" ON staff_directory
  FOR ALL USING (false);

-- 4. customers, orders, parcels, inventory, etc.: 
-- For sensitive tables, block public access unless you need otherwise
-- Example for customers:
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Deny all public access to customers" ON customers;
CREATE POLICY "Deny all public access to customers" ON customers
  FOR ALL USING (false);

-- ...repeat for other sensitive tables as needed...
