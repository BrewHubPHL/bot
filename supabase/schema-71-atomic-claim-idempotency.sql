-- ============================================================
-- SCHEMA 71: Atomic KDS Claim + Idempotency-to-Order Binding
-- Date: 2026-02-27
-- Codex-Max 5.1 Audit Hardening
-- ============================================================
-- 1. claim_order_atomic: Replaces soft claim_order with a true
--    atomic claim that uses FOR UPDATE row locking and RAISES
--    an exception if already claimed. Also transitions status
--    to 'preparing' in a single statement.
-- 2. last_idempotency_key: Binds a payment idempotency key to
--    its order so the same key cannot be replayed against a
--    different order (Key Replay attack prevention).
-- ============================================================

BEGIN;

-- ── 1. Atomic KDS claim RPC ──────────────────────────────────────
-- Supersedes the non-atomic claim_order() from schema-58.
-- Uses SELECT ... FOR UPDATE to serialise concurrent claims.
-- On conflict, raises an exception so the client gets a clear error.

CREATE OR REPLACE FUNCTION public.claim_order_atomic(
  p_order_id  uuid,
  p_staff_id  uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_claimed_by uuid;
  v_result     jsonb;
BEGIN
  SET LOCAL statement_timeout = '3s';
  SET LOCAL lock_timeout      = '2s';

  -- Lock the row to serialise concurrent claims
  SELECT claimed_by INTO v_claimed_by
    FROM public.orders
   WHERE id = p_order_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order % not found', p_order_id;
  END IF;

  -- Idempotent: if same staff already claimed, just return
  IF v_claimed_by = p_staff_id THEN
    SELECT to_jsonb(o.*) INTO v_result
      FROM public.orders o
     WHERE o.id = p_order_id;
    RETURN v_result;
  END IF;

  -- Reject if already claimed by a different barista
  IF v_claimed_by IS NOT NULL THEN
    RAISE EXCEPTION 'Order already claimed by another barista.';
  END IF;

  -- Claim + transition to 'preparing' atomically
  UPDATE public.orders
     SET claimed_by = p_staff_id,
         claimed_at = now(),
         status     = 'preparing'
   WHERE id = p_order_id;

  SELECT to_jsonb(o.*) INTO v_result
    FROM public.orders o
   WHERE o.id = p_order_id;

  RETURN v_result;
END;
$$;


-- ── 2. Idempotency-to-Order binding column ───────────────────────
-- Stores the idempotency key used for the terminal checkout so we
-- can detect Key Replay attacks (same key reused for a different order).

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS last_idempotency_key text;

-- Unique index: each idempotency key can only belong to one order.
-- Partial index excludes NULLs (orders that haven't been charged yet).
CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_idempotency_key_unique
  ON orders (last_idempotency_key)
  WHERE last_idempotency_key IS NOT NULL;

COMMIT;
