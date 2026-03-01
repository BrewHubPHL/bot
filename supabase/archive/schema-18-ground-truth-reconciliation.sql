-- ============================================================
-- Schema 18 — Ground-Truth Reconciliation Fixes
-- Generated from CSV ↔ code cross-reference audit
-- ============================================================

BEGIN;

-- ---- 1. orders: add merch-specific columns (ghost → real) ------
-- process-merch-payment.js inserts type, shipping_address, items
-- but these columns never existed — data was silently discarded.
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS type             text          DEFAULT 'cafe',
  ADD COLUMN IF NOT EXISTS shipping_address text,
  ADD COLUMN IF NOT EXISTS items            jsonb;

COMMENT ON COLUMN orders.type IS 'cafe | merch — distinguishes order channel';
COMMENT ON COLUMN orders.shipping_address IS 'Merch shipping address (null for cafe orders)';
COMMENT ON COLUMN orders.items IS 'Line-item detail [{name, quantity, price_cents}]';

-- ---- 2. parcels: add recipient_email (ghost → real) ------
-- parcels/page.tsx .or() filter references recipient_email
-- notification-worker extracts it from payload; storing it directly is cleaner.
ALTER TABLE parcels
  ADD COLUMN IF NOT EXISTS recipient_email text;

COMMENT ON COLUMN parcels.recipient_email IS 'Email for pickup notifications';

-- ---- 3. inventory: add category column (ghost → real) ------
-- cafe/page.tsx and InventoryTable.tsx both select 'category' but it didn't exist.
ALTER TABLE inventory
  ADD COLUMN IF NOT EXISTS category text DEFAULT 'general';

COMMENT ON COLUMN inventory.category IS 'Inventory grouping — general, dairy, produce, etc.';

-- ---- 4. job_applications: add resume_url for PDF uploads ------
ALTER TABLE job_applications
  ADD COLUMN IF NOT EXISTS resume_url text;

COMMENT ON COLUMN job_applications.resume_url IS 'Public URL of uploaded resume PDF in resumes storage bucket';

COMMIT;
