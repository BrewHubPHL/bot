-- ============================================================
-- SCHEMA 59: Inventory Shrinkage Log (Retail Write-Offs)
--   IRS-compliant audit trail for retail inventory losses.
--   Tracks Breakage, Spoilage, Theft, and Other shrinkage
--   events against merch_products with full attribution.
--
-- Doomsday Scenario 4: THE BROKEN MUG
--   A customer breaks a $25 glass mug → manager must record
--   the loss as retail shrinkage, not silently edit stock_quantity.
-- ============================================================

-- ═══════════════════════════════════════════════════════════════
-- TABLE: inventory_shrinkage_log
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS inventory_shrinkage_log (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id      uuid        NOT NULL REFERENCES merch_products(id),
  product_name    text        NOT NULL,           -- denormalized snapshot at time of event
  category        text        NOT NULL CHECK (category IN ('breakage', 'spoilage', 'theft', 'other')),
  quantity        int         NOT NULL CHECK (quantity > 0),
  unit_cost_cents int         NOT NULL CHECK (unit_cost_cents >= 0),  -- price_cents at time of loss
  total_loss_cents int        NOT NULL CHECK (total_loss_cents >= 0), -- quantity × unit_cost_cents
  reason          text        NOT NULL CHECK (char_length(reason) >= 2),
  staff_id        uuid        NOT NULL,           -- FK to auth.users / staff_directory
  staff_email     text        NOT NULL,           -- denormalized for quick reads
  old_stock       int,                            -- stock_quantity BEFORE decrement (NULL if unlimited)
  new_stock       int,                            -- stock_quantity AFTER decrement (NULL if unlimited)
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- Indexes for dashboard queries and IRS reporting
CREATE INDEX IF NOT EXISTS idx_shrinkage_product   ON inventory_shrinkage_log (product_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_shrinkage_category  ON inventory_shrinkage_log (category, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_shrinkage_staff     ON inventory_shrinkage_log (staff_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_shrinkage_created   ON inventory_shrinkage_log (created_at DESC);

-- ═══════════════════════════════════════════════════════════════
-- RLS: deny-all by default, service_role bypasses for writes
-- Staff can read for dashboard visibility.
-- ═══════════════════════════════════════════════════════════════
ALTER TABLE inventory_shrinkage_log ENABLE ROW LEVEL SECURITY;

-- Deny all writes from authenticated users (service_role inserts from Netlify functions)
DROP POLICY IF EXISTS "Shrinkage deny writes" ON inventory_shrinkage_log;
CREATE POLICY "Shrinkage deny writes"
  ON inventory_shrinkage_log FOR INSERT TO authenticated
  WITH CHECK (false);

-- Staff can read shrinkage logs
DROP POLICY IF EXISTS "Staff can read shrinkage log" ON inventory_shrinkage_log;
CREATE POLICY "Staff can read shrinkage log"
  ON inventory_shrinkage_log FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM staff_directory
    WHERE lower(email) = lower(auth.email())
  ));

COMMENT ON TABLE inventory_shrinkage_log IS
  'IRS-compliant audit trail for retail inventory shrinkage (breakage, spoilage, theft). '
  'Written atomically with stock_quantity decrement by log-shrinkage.js. '
  'Doomsday Scenario 4: THE BROKEN MUG.';

-- ═══════════════════════════════════════════════════════════════
-- RPC: atomic_record_shrinkage
--   Decrements merch_products.stock_quantity and inserts audit row
--   in a single transaction. Returns the new log entry.
-- ═══════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION atomic_record_shrinkage(
  p_product_id   uuid,
  p_category     text,
  p_quantity     int,
  p_reason       text,
  p_staff_id     uuid,
  p_staff_email  text
) RETURNS jsonb AS $$
DECLARE
  v_product      record;
  v_old_stock    int;
  v_new_stock    int;
  v_loss_cents   int;
  v_log_id       uuid;
BEGIN
  -- Validate category
  IF p_category NOT IN ('breakage', 'spoilage', 'theft', 'other') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Invalid category');
  END IF;
  IF p_quantity < 1 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Quantity must be at least 1');
  END IF;
  IF char_length(COALESCE(p_reason, '')) < 2 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Reason is required (min 2 chars)');
  END IF;

  -- Lock the product row to prevent concurrent stock edits
  SELECT id, name, price_cents, stock_quantity
  INTO v_product
  FROM merch_products
  WHERE id = p_product_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Product not found');
  END IF;

  v_old_stock := v_product.stock_quantity;  -- may be NULL (unlimited)
  v_loss_cents := v_product.price_cents * p_quantity;

  -- Decrement stock if tracked (non-NULL)
  IF v_old_stock IS NOT NULL THEN
    v_new_stock := GREATEST(0, v_old_stock - p_quantity);
    UPDATE merch_products
    SET stock_quantity = v_new_stock,
        updated_at = now()
    WHERE id = p_product_id;
  ELSE
    v_new_stock := NULL;  -- still unlimited
  END IF;

  -- Insert audit row
  INSERT INTO inventory_shrinkage_log (
    product_id, product_name, category, quantity,
    unit_cost_cents, total_loss_cents, reason,
    staff_id, staff_email, old_stock, new_stock
  ) VALUES (
    p_product_id, v_product.name, p_category, p_quantity,
    v_product.price_cents, v_loss_cents, p_reason,
    p_staff_id, p_staff_email, v_old_stock, v_new_stock
  )
  RETURNING id INTO v_log_id;

  RETURN jsonb_build_object(
    'ok', true,
    'log_id', v_log_id,
    'product_name', v_product.name,
    'old_stock', v_old_stock,
    'new_stock', v_new_stock,
    'total_loss_cents', v_loss_cents
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
