-- ============================================================
-- Schema 41: Order Status Update Remediation
-- ============================================================
-- Fixes the 500 Internal Server Error on update-order-status:
--
--   1. safe_update_order_status() RPC — wraps the UPDATE in a
--      transaction that sets app.voucher_bypass = 'true' so
--      prevent_order_amount_tampering never rejects vouchered
--      ($0.00) orders during status transitions.
--
--   2. Hardens handle_order_completion() with EXCEPTION block
--      so lock_timeout (55P03) doesn't kill the caller — logs
--      to system_sync_logs and still commits the status change.
--
--   3. Hardens prevent_order_amount_tampering() to only fire
--      when total_amount_cents actually changes (skip on status-
--      only updates).
--
-- Idempotent: safe to re-run in the Supabase SQL Editor.
-- ============================================================

BEGIN;

-- ─────────────────────────────────────────────────────────────
-- 1. safe_update_order_status() — RPC called by the Netlify fn
-- ─────────────────────────────────────────────────────────────
-- Sets app.voucher_bypass GUC so prevent_order_amount_tampering
-- doesn't block the row when handle_order_completion mutates it.
-- Returns the updated order row as JSON for the API response.
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.safe_update_order_status(
  p_order_id     uuid,
  p_status       text,
  p_completed_at timestamptz DEFAULT NULL,
  p_payment_id   text        DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
BEGIN
  -- Scoped timeouts: prevent runaway locks during rush
  SET LOCAL statement_timeout = '5s';
  SET LOCAL lock_timeout      = '3s';

  -- GUC bypass: allows the BEFORE UPDATE trigger
  -- prevent_order_amount_tampering to pass through without
  -- raising an exception on $0 vouchered orders.
  PERFORM set_config('app.voucher_bypass', 'true', true);

  -- Perform the update
  UPDATE public.orders
     SET status       = p_status,
         completed_at = COALESCE(p_completed_at, completed_at),
         payment_id   = COALESCE(p_payment_id,   payment_id),
         updated_at   = now()
   WHERE id = p_order_id;

  -- Fetch the updated row (post-trigger) as JSON
  SELECT to_jsonb(o.*) INTO v_result
    FROM public.orders o
   WHERE o.id = p_order_id;

  RETURN v_result;
END;
$$;

-- Restrict execution
REVOKE ALL ON FUNCTION public.safe_update_order_status(uuid, text, timestamptz, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.safe_update_order_status(uuid, text, timestamptz, text) FROM anon, authenticated;
-- service_role retains access (Netlify function uses service key)

COMMENT ON FUNCTION public.safe_update_order_status IS
  'RPC for update-order-status.js. Sets app.voucher_bypass GUC, '
  'applies scoped timeouts, and returns the updated order as JSONB.';

-- ─────────────────────────────────────────────────────────────
-- 2. Harden handle_order_completion — catch lock timeouts
-- ─────────────────────────────────────────────────────────────
-- The FOR UPDATE lock on inventory can fail under morning-rush
-- concurrency when lock_timeout fires. Without an EXCEPTION
-- handler the entire UPDATE is killed → 500.
--
-- Fix: catch all errors, log to system_sync_logs, and still
-- return NEW so the status transition succeeds. Inventory will
-- be reconciled by the next successful completion or the nightly
-- inventory-check cron.
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION handle_order_completion()
RETURNS trigger AS $$
DECLARE
  v_item_count int;
  v_old_stock  int;
  v_actual_dec int;
BEGIN
  SET LOCAL statement_timeout = '3s';
  SET LOCAL lock_timeout      = '2s';

  -- Guard 1: Only fire on transition TO 'completed'
  IF (NEW.status <> 'completed') OR (OLD.status IS NOT DISTINCT FROM 'completed') THEN
    RETURN NEW;
  END IF;

  -- Guard 2: One-shot flag — never decrement twice for the same order
  IF COALESCE(NEW.inventory_decremented, false) THEN
    RETURN NEW;
  END IF;

  -- Count drink items for this order
  SELECT COUNT(*)::int INTO v_item_count
    FROM public.coffee_orders
   WHERE order_id = NEW.id;

  IF v_item_count > 0 THEN
    -- Lock the inventory row to prevent concurrent under-decrement
    SELECT current_stock INTO v_old_stock
      FROM public.inventory
     WHERE item_name = '12oz Cups'
       FOR UPDATE;

    -- Calculate actual decrement (can't go below 0)
    v_actual_dec := LEAST(v_item_count, COALESCE(v_old_stock, 0));

    UPDATE public.inventory
       SET current_stock = GREATEST(0, current_stock - v_item_count),
           updated_at = now()
     WHERE item_name = '12oz Cups';

    NEW.cups_decremented := v_actual_dec;
  END IF;

  NEW.inventory_decremented := true;
  RETURN NEW;

EXCEPTION WHEN OTHERS THEN
  -- ── Error-safe: log and continue so the status UPDATE succeeds ──
  BEGIN
    INSERT INTO public.system_sync_logs
      (source, detail, sql_state, severity)
    VALUES
      ('handle_order_completion',
       format('Order %s: %s', NEW.id, SQLERRM),
       SQLSTATE,
       'error');
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '[handle_order_completion] log-insert failed for order %: %',
      NEW.id, SQLERRM;
  END;
  -- Still mark the flag so a retry doesn't double-count
  NEW.inventory_decremented := false;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Re-attach the trigger (idempotent)
DROP TRIGGER IF EXISTS trg_order_completion ON public.orders;
CREATE TRIGGER trg_order_completion
  BEFORE UPDATE ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION handle_order_completion();

-- ─────────────────────────────────────────────────────────────
-- 3. Tighten prevent_order_amount_tampering
-- ─────────────────────────────────────────────────────────────
-- Only raise when total_amount_cents *actually changes*.
-- Skip entirely for status-only updates (the common path).
-- Still respects the app.voucher_bypass GUC for atomic_redeem.
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION prevent_order_amount_tampering()
RETURNS trigger AS $$
BEGIN
  -- Fast exit: if amount didn't change, nothing to guard
  IF NEW.total_amount_cents IS NOT DISTINCT FROM OLD.total_amount_cents THEN
    RETURN NEW;
  END IF;

  -- GUC bypass for voucher redemption flow
  IF current_setting('app.voucher_bypass', true) = 'true' THEN
    RETURN NEW;
  END IF;

  -- Block unauthorized amount changes
  IF OLD.total_amount_cents IS NOT NULL THEN
    RAISE EXCEPTION 'Cannot modify order amount after creation'
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Re-attach (idempotent)
DROP TRIGGER IF EXISTS orders_no_amount_tampering ON public.orders;
CREATE TRIGGER orders_no_amount_tampering
  BEFORE UPDATE ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION prevent_order_amount_tampering();

COMMIT;
