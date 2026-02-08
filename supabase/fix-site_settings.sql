-- Add key column if missing
ALTER TABLE site_settings ADD COLUMN IF NOT EXISTS key text;

-- Insert shop_enabled row
INSERT INTO site_settings (key, value)
VALUES ('shop_enabled', true)
ON CONFLICT (key) DO UPDATE SET value = true;

-- Ensure RLS allows public SELECT
DROP POLICY IF EXISTS "Public can read site_settings" ON site_settings;
CREATE POLICY "Public can read site_settings" ON site_settings
  FOR SELECT USING (true);
