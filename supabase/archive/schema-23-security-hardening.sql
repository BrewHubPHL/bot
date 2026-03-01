-- ============================================================
-- SCHEMA 23: Security Hardening — Storage DoW + Price Guard
-- Created: 2026-02-19  (Red Team escalation fixes)
-- ============================================================
-- 1. Lock down the "menu-images" storage bucket so only staff
--    and service_role can upload / update / delete objects.
-- 2. Add a CHECK constraint on merch_products.price_cents > 0
--    so a compromised INSERT/UPDATE can never set a free price.
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- 1. STORAGE POLICIES — menu-images bucket
-- ─────────────────────────────────────────────────────────────
-- Public can SELECT (read / view images on the website).
-- INSERT / UPDATE / DELETE restricted to staff + service_role.

-- Ensure the bucket exists (idempotent upsert)
INSERT INTO storage.buckets (id, name, public)
VALUES ('menu-images', 'menu-images', true)
ON CONFLICT (id) DO NOTHING;

-- Drop any prior permissive upload policies
DROP POLICY IF EXISTS "Allow public uploads to menu-images" ON storage.objects;
DROP POLICY IF EXISTS "Anyone can upload menu images"        ON storage.objects;
DROP POLICY IF EXISTS "Staff can upload menu images"         ON storage.objects;
DROP POLICY IF EXISTS "Staff can update menu images"         ON storage.objects;
DROP POLICY IF EXISTS "Staff can delete menu images"         ON storage.objects;
DROP POLICY IF EXISTS "Public can view menu images"          ON storage.objects;

-- Public READ (anyone can view menu images on the site)
CREATE POLICY "Public can view menu images"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'menu-images');

-- INSERT — only staff (authenticated users in staff_directory) or service_role
CREATE POLICY "Staff can upload menu images"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'menu-images'
    AND (
      -- Service role always allowed
      (auth.role() = 'service_role')
      OR
      -- Authenticated staff only
      (
        auth.role() = 'authenticated'
        AND EXISTS (
          SELECT 1 FROM public.staff_directory
          WHERE email = auth.email()
        )
      )
    )
  );

-- UPDATE — same restriction
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
          WHERE email = auth.email()
        )
      )
    )
  );

-- DELETE — same restriction
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
          WHERE email = auth.email()
        )
      )
    )
  );

-- ─────────────────────────────────────────────────────────────
-- 2. MERCH_PRODUCTS PRICE GUARD (CHECK constraint)
-- ─────────────────────────────────────────────────────────────
-- Ensure price_cents is always positive. This blocks "free
-- coffee" attacks at the database layer even if application
-- logic is somehow bypassed.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'merch_products_price_positive'
  ) THEN
    ALTER TABLE public.merch_products
      ADD CONSTRAINT merch_products_price_positive
      CHECK (price_cents > 0);
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────
-- 3. RLS: Prevent UPDATE of price_cents to <= 0 via policy
-- ─────────────────────────────────────────────────────────────
-- Even though the CHECK above blocks it at the constraint level,
-- belt-and-suspenders: add an RLS policy on UPDATE that re-checks.

-- Staff can update products only when price_cents stays positive
DROP POLICY IF EXISTS "Staff can update products" ON public.merch_products;
CREATE POLICY "Staff can update products"
  ON public.merch_products FOR UPDATE
  USING (
    auth.role() = 'service_role'
    OR (
      auth.role() = 'authenticated'
      AND EXISTS (
        SELECT 1 FROM public.staff_directory
        WHERE email = auth.email()
      )
    )
  )
  WITH CHECK (
    price_cents > 0
  );
