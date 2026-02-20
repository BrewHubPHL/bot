-- =============================================================================
-- schema-25-order-timeout-cleanup.sql
-- Fixes the "Limbo State" timeout problem and adds webhook housekeeping.
--
-- 1. abandon_stale_orders()  — moves orders stuck in 'pending' for >15 min
--    to 'abandoned', freeing inventory and cleaning the KDS.
-- 2. cleanup_old_webhooks()  — prunes processed_webhooks rows older than 7 days
--    to prevent unbounded table growth.
-- 3. pg_cron schedules       — run both every minute / daily respectively.
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. RPC: Abandon stale pending orders (15-minute timeout)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.abandon_stale_orders()
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  affected int;
BEGIN
  WITH abandoned AS (
    UPDATE orders
       SET status      = 'abandoned',
           updated_at  = now()
     WHERE status      = 'pending'
       AND created_at  < now() - interval '15 minutes'
    RETURNING id
  )
  SELECT count(*) INTO affected FROM abandoned;

  IF affected > 0 THEN
    RAISE LOG '[CRON] Abandoned % stale pending orders.', affected;
  END IF;

  RETURN affected;
END;
$$;

-- Grant execute to service_role only (cron runs as superuser → service_role)
REVOKE ALL ON FUNCTION public.abandon_stale_orders() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.abandon_stale_orders() TO service_role;

COMMENT ON FUNCTION public.abandon_stale_orders() IS
  'Transitions orders stuck in pending for >15 min to abandoned. '
  'Called by pg_cron every minute.';


-- ─────────────────────────────────────────────────────────────────────────────
-- 2. RPC: Prune old processed_webhooks (7-day TTL)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.cleanup_old_webhooks()
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  removed int;
BEGIN
  WITH deleted AS (
    DELETE FROM processed_webhooks
     WHERE processed_at < now() - interval '7 days'
    RETURNING id
  )
  SELECT count(*) INTO removed FROM deleted;

  IF removed > 0 THEN
    RAISE LOG '[CRON] Cleaned up % old webhook records.', removed;
  END IF;

  RETURN removed;
END;
$$;

REVOKE ALL ON FUNCTION public.cleanup_old_webhooks() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleanup_old_webhooks() TO service_role;

COMMENT ON FUNCTION public.cleanup_old_webhooks() IS
  'Deletes processed_webhooks rows older than 7 days to prevent table bloat. '
  'Called by pg_cron daily.';


-- ─────────────────────────────────────────────────────────────────────────────
-- 3. pg_cron schedules (requires pg_cron extension enabled in Supabase Dashboard)
-- ─────────────────────────────────────────────────────────────────────────────
-- Enable pg_cron if not already active (Supabase projects have it pre-installed)
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Run stale-order cleanup every minute
SELECT cron.unschedule('abandon-stale-orders')
 WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'abandon-stale-orders');

SELECT cron.schedule(
  'abandon-stale-orders',           -- job name
  '* * * * *',                      -- every minute
  $$SELECT public.abandon_stale_orders()$$
);

-- Run webhook housekeeping daily at 03:00 UTC
SELECT cron.unschedule('cleanup-old-webhooks')
 WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'cleanup-old-webhooks');

SELECT cron.schedule(
  'cleanup-old-webhooks',           -- job name
  '0 3 * * *',                      -- daily at 03:00 UTC
  $$SELECT public.cleanup_old_webhooks()$$
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Index to accelerate the stale-order scan (partial index on pending only)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_orders_pending_created
  ON orders (created_at)
  WHERE status = 'pending';

-- Index for webhook TTL cleanup
CREATE INDEX IF NOT EXISTS idx_processed_webhooks_processed_at
  ON processed_webhooks (processed_at);
