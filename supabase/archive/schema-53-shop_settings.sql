-- 53. SHOP_SETTINGS
-- Stores OAuth tokens and shop metadata used by Netlify OAuth flow
CREATE TABLE IF NOT EXISTS shop_settings (
  id text PRIMARY KEY,
  access_token text,
  refresh_token text,
  merchant_id text,
  updated_at timestamp with time zone DEFAULT now()
);

ALTER TABLE IF EXISTS shop_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Deny public access to shop_settings" ON shop_settings;
CREATE POLICY "Deny public access to shop_settings" ON shop_settings FOR ALL USING (false);
