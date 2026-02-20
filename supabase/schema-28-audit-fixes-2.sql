-- =============================================================================
-- schema-28-audit-fixes-2.sql
-- Second batch of audit fixes (2026-02-20).
--
-- 1. Restore price_cents > 0 WITH CHECK on merch_products INSERT/UPDATE
-- 2. Fix handle_order_completion(): ILIKE '%Cup%' → exact '12oz Cups' match
-- 3. Fix storage policies: case-insensitive email matching
-- 4. Fix is_tombstoned(): case-insensitive table_name comparison
-- 5. Harden brewhub_nnn_summary: ENABLE RLS + deny-all policy (belt-and-suspenders)
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Restore price_cents > 0 in merch_products INSERT/UPDATE WITH CHECK
--    Schema-24 replaced these policies but dropped the price guard that
--    schema-23 had. The CHECK constraint still blocks it, but RLS is belt-
--    and-suspenders defense-in-depth.
-- ─────────────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "Manager can insert products" ON merch_products;
CREATE POLICY "Manager can insert products" ON merch_products
  FOR INSERT
  WITH CHECK (is_brewhub_manager() AND price_cents > 0);

DROP POLICY IF EXISTS "Manager can update products" ON merch_products;
CREATE POLICY "Manager can update products" ON merch_products
  FOR UPDATE
  USING (is_brewhub_manager())
  WITH CHECK (is_brewhub_manager() AND price_cents > 0);


-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Fix handle_order_completion() — overly broad ILIKE '%Cup%'
--    Matches "Cupcake", "Cupboard", etc. Use exact item name match.
--    Schema-26 already uses '12oz Cups' for the refund path; align trigger.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION handle_order_completion()
RETURNS TRIGGER AS $$
DECLARE
  v_item_count int;
BEGIN
  IF (NEW.status = 'completed') AND (OLD.status IS DISTINCT FROM 'completed')
     AND (COALESCE(NEW.inventory_decremented, false) = false) THEN

    SELECT COUNT(*)::int INTO v_item_count
    FROM public.coffee_orders
    WHERE order_id = NEW.id;

    IF v_item_count > 0 THEN
      UPDATE public.inventory
      SET current_stock = GREATEST(0, current_stock - v_item_count),
          updated_at = now()
      WHERE item_name ILIKE '12oz Cups';
    END IF;

    NEW.inventory_decremented := true;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Fix storage policies — case-insensitive email match
--    staff_directory may store mixed-case emails; auth.email() returns
--    whatever the user signed up with. Use lower() on both sides.
-- ─────────────────────────────────────────────────────────────────────────────

-- INSERT policy
DROP POLICY IF EXISTS "Staff can upload menu images" ON storage.objects;
CREATE POLICY "Staff can upload menu images"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'menu-images'
    AND (
      (auth.role() = 'service_role')
      OR
      (
        auth.role() = 'authenticated'
        AND EXISTS (
          SELECT 1 FROM public.staff_directory
          WHERE lower(email) = lower(auth.email())
        )
      )
    )
  );

-- UPDATE policy
DROP POLICY IF EXISTS "Staff can update menu images" ON storage.objects;
CREATE POLICY "Staff can update menu images"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'menu-images'
    AND (
      (auth.role() = 'service_role')
      OR
      (
        auth.role() = 'authenticated'
        AND EXISTS (
          SELECT 1 FROM public.staff_directory
          WHERE lower(email) = lower(auth.email())
        )
      )
    )
  );

-- DELETE policy
DROP POLICY IF EXISTS "Staff can delete menu images" ON storage.objects;
CREATE POLICY "Staff can delete menu images"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'menu-images'
    AND (
      (auth.role() = 'service_role')
      OR
      (
        auth.role() = 'authenticated'
        AND EXISTS (
          SELECT 1 FROM public.staff_directory
          WHERE lower(email) = lower(auth.email())
        )
      )
    )
  );


-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Fix is_tombstoned() — case-insensitive table_name comparison
--    Callers might pass 'Profiles' or 'profiles'; the lookup should work
--    regardless. Also ensure both record_key sides match.
-- ─────────────────────────────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS is_tombstoned(text, text);
CREATE OR REPLACE FUNCTION is_tombstoned(p_table text, p_key text)
RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1 FROM deletion_tombstones
    WHERE lower(table_name) = lower(p_table)
      AND lower(record_key) = lower(p_key)
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Re-apply grant to service_role only (schema-27 already revoked from anon/authenticated)
GRANT EXECUTE ON FUNCTION is_tombstoned(text, text) TO service_role;


-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Harden brewhub_nnn_summary
--    This is a VIEW in production — RLS cannot be applied to views.
--    Security is enforced by revoking SELECT from anon/authenticated
--    (originally in schema-5). Re-apply idempotently as belt-and-suspenders.
-- ─────────────────────────────────────────────────────────────────────────────

REVOKE SELECT ON brewhub_nnn_summary FROM anon, authenticated;
