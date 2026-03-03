-- Migration: 20260302_specialty_coffee_menu
-- Adds long_description and allowed_modifiers columns to merch_products,
-- archives old coffee items, and inserts the 7 new curated specialty coffees.

BEGIN;

-- ─── Step 1: Add new columns ──────────────────────────────────────────────
ALTER TABLE public.merch_products
  ADD COLUMN IF NOT EXISTS long_description TEXT,
  ADD COLUMN IF NOT EXISTS allowed_modifiers JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.merch_products.long_description
  IS 'Extended origin story, tasting notes, and ICAFE scores for specialty items';
COMMENT ON COLUMN public.merch_products.allowed_modifiers
  IS 'JSON array of modifier group keys the item supports, e.g. ["milks","sweeteners"]';

-- ─── Step 2: Archive all existing coffee/menu items ───────────────────────
-- Sets is_active = false and archived_at = NOW() for current menu items
-- so the new curated menu takes over cleanly.
UPDATE public.merch_products
  SET is_active   = false,
      archived_at = NOW(),
      updated_at  = NOW()
  WHERE category = 'menu'
    AND is_active = true
    AND archived_at IS NULL;

-- ─── Step 3: Insert the 7 new specialty coffee items ──────────────────────

INSERT INTO public.merch_products
  (name, price_cents, description, long_description, category, is_active, sort_order, allowed_modifiers)
VALUES
  (
    'Alfaro Master Roast (House Pour Over)',
    450,
    'Full-bodied dark roast pour over — stout, clean, layered.',
    'A full-bodied dark roast blend of Caturra and Catuai. Stout, clean, and layered with flavor.',
    'menu', true, 10,
    '["milks", "sweeteners"]'::jsonb
  ),
  (
    'Coffee Balam Congo Coffee (Specialty Coffee)',
    550,
    'Honey-processed Blue Zone coffee — red fruit, caramel, chocolate.',
    'Honey-processed for a smooth, balanced cup. Notes of red fruit, caramel, chocolate, and vanilla. Grown in Costa Rica''s Nicoya Peninsula, a Blue Zone. 5% of sales support the Chorotega community. (ICAFE Score: 85)',
    'menu', true, 20,
    '["milks", "sweeteners"]'::jsonb
  ),
  (
    'Coffee Balam Coyote Coffee (Cold Brew)',
    500,
    'Naturally processed cold brew — blackberry, orange, grapefruit.',
    'Naturally processed and sun-dried. Fruit-forward with notes of blackberry, orange, grapefruit, and chocolate. (ICAFE Score: 86)',
    'menu', true, 30,
    '["milks", "sweeteners"]'::jsonb
  ),
  (
    'Gran Crema Espresso (Standard Espresso Drinks)',
    475,
    'Balanced, smooth, and creamy espresso — roasted nuts, biscuit.',
    'A balanced, smooth, and creamy espresso base with notes of roasted nuts, biscuit, and whisky.',
    'menu', true, 40,
    '["milks", "sweeteners", "standard_syrups"]'::jsonb
  ),
  (
    'Mocha (Gran Crema Base)',
    550,
    'Rich chocolate meets our Gran Crema espresso.',
    'Our Gran Crema espresso balanced with rich chocolate.',
    'menu', true, 50,
    '["specialty_addins"]'::jsonb
  ),
  (
    'Gusto Classico Espresso Bean Cortado',
    600,
    'Cortado Condensada / Bombón — served strictly as is.',
    'Cortado Condensada / Bombón. A sweet layered version made by adding condensed milk at the bottom, creating a striking visual and dessert-like flavor.',
    'menu', true, 60,
    '[]'::jsonb
  ),
  (
    'Coffee Balam Cornizuelo Coffee (Cafe Latte)',
    525,
    'Rare peaberry latte — chocolate, citrus, nutty sweetness.',
    'Known as Caracolillo, this rare peaberry bean produces a concentrated cup with chocolate, citrus, and nutty sweetness. (ICAFE Score: 83).',
    'menu', true, 70,
    '["standard_syrups", "specialty_addins"]'::jsonb
  );

COMMIT;
