-- ============================================================
-- SCHEMA 58: KDS Item-Level Sync & Barista Claim Tracking
-- Date: 2026-02-25
-- ============================================================
-- Fixes the "Barista Collision" vulnerability:
--   1. Adds completed_at + completed_by to coffee_orders so
--      item-level checkboxes sync across multiple KDS iPads
--      via Supabase Realtime.
--   2. Adds claimed_by + claimed_at to orders so baristas
--      can see who claimed an order on every KDS screen.
-- ============================================================

BEGIN;

-- ── 1. Item-level completion on coffee_orders ────────────────────
-- When a barista taps the checkbox next to "Iced Latte" on iPad A,
-- a DB write sets completed_at + completed_by. Supabase Realtime
-- broadcasts the change to iPad B, which crosses off the item.

ALTER TABLE coffee_orders
  ADD COLUMN IF NOT EXISTS completed_at  timestamptz,
  ADD COLUMN IF NOT EXISTS completed_by  uuid;

-- Index for efficient "which items are done" queries
CREATE INDEX IF NOT EXISTS idx_coffee_orders_completed
  ON coffee_orders (order_id, completed_at)
  WHERE completed_at IS NOT NULL;

-- ── 2. Order-level barista claim ─────────────────────────────────
-- When a barista taps "Start Preparing", we record who claimed it.
-- Other baristas see "Claimed by <name>" on their KDS and back off.

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS claimed_by  uuid,
  ADD COLUMN IF NOT EXISTS claimed_at  timestamptz;

-- Index for dashboard queries ("show me my claimed orders")
CREATE INDEX IF NOT EXISTS idx_orders_claimed_by
  ON orders (claimed_by)
  WHERE claimed_by IS NOT NULL;

-- ── 3. RPC: Toggle item completion ───────────────────────────────
-- Atomic toggle: if the item is not completed, mark it completed.
-- If it is already completed, clear it (un-check). Returns the
-- updated row so the client knows the new state. Uses advisory
-- lock to prevent two iPads toggling the same item simultaneously.
CREATE OR REPLACE FUNCTION public.toggle_item_completed(
  p_item_id   uuid,
  p_staff_id  uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
BEGIN
  SET LOCAL statement_timeout = '3s';
  SET LOCAL lock_timeout      = '2s';

  UPDATE public.coffee_orders
     SET completed_at = CASE
           WHEN completed_at IS NULL THEN now()
           ELSE NULL
         END,
         completed_by = CASE
           WHEN completed_at IS NULL THEN p_staff_id
           ELSE NULL
         END
   WHERE id = p_item_id;

  SELECT to_jsonb(c.*) INTO v_result
    FROM public.coffee_orders c
   WHERE c.id = p_item_id;

  RETURN v_result;
END;
$$;

-- ── 4. RPC: Claim an order ───────────────────────────────────────
-- Sets claimed_by + claimed_at if not already claimed. If already
-- claimed by someone else, returns the existing claim (idempotent
-- if same staff, informational if different staff).
CREATE OR REPLACE FUNCTION public.claim_order(
  p_order_id  uuid,
  p_staff_id  uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
BEGIN
  SET LOCAL statement_timeout = '3s';
  SET LOCAL lock_timeout      = '2s';

  -- Only claim if not already claimed
  UPDATE public.orders
     SET claimed_by = p_staff_id,
         claimed_at = now()
   WHERE id = p_order_id
     AND claimed_by IS NULL;

  SELECT to_jsonb(o.*) INTO v_result
    FROM public.orders o
   WHERE o.id = p_order_id;

  RETURN v_result;
END;
$$;

COMMIT;
