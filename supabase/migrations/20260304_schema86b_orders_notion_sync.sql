-- ═══════════════════════════════════════════════════════════════════════════
-- Schema 86b — Orders → Notion Sales Ledger Auto-Sync Trigger
-- ═══════════════════════════════════════════════════════════════════════════
-- Fires AFTER UPDATE on public.orders when the status transitions to
-- 'completed' (and was NOT 'completed' before).  Enqueues an async
-- HTTP POST via pg_net to /.netlify/functions/notion-sync so the
-- Netlify function can re-fetch the canonical order row and write it
-- to the Notion Sales Ledger database.
--
-- Runtime settings (same as schema-86 manager_override trigger):
--   app.settings.notion_sync_webhook_url  — optional, falls back to prod
--   app.settings.internal_sync_secret     — required for HMAC auth
--
-- Idempotent: safe to re-run.  DROP TRIGGER IF EXISTS before CREATE.
-- ═══════════════════════════════════════════════════════════════════════════

-- Ensure pg_net is available (no-op if schema-86 already ran)
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- ── 1. Trigger function ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_trg_orders_notion_sync()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  webhook_url text := COALESCE(
    NULLIF(current_setting('app.settings.notion_sync_webhook_url', true), ''),
    'https://brewhubphl.com/.netlify/functions/notion-sync'
  );
  sync_secret text := NULLIF(current_setting('app.settings.internal_sync_secret', true), '');
  request_id  bigint;
BEGIN
  -- Guard: only fire on the exact transition → 'completed'
  IF (NEW.status = 'completed') AND (OLD.status IS DISTINCT FROM 'completed') THEN

    -- Warn (but do not abort) if the secret is missing — the Netlify
    -- function will reject the request, and the order itself is unaffected.
    IF sync_secret IS NULL THEN
      RAISE WARNING '[notion-sync] app.settings.internal_sync_secret is not configured; orders webhook auth will fail.';
    END IF;

    SELECT net.http_post(
      url     := webhook_url,
      headers := jsonb_build_object(
        'Content-Type',      'application/json',
        'X-BrewHub-Action',  'true',
        'x-brewhub-secret',  COALESCE(sync_secret, '')
      ),
      body    := jsonb_build_object(
        'source_table', 'orders',
        'action',       'UPDATE',
        'sync_key',     CONCAT('orders:', NEW.id::text),
        'record_id',    NEW.id::text
      )
    ) INTO request_id;

  END IF;

  RETURN NEW;

EXCEPTION
  WHEN undefined_function THEN
    -- pg_net not installed — degrade gracefully
    RAISE WARNING '[notion-sync] net.http_post unavailable (pg_net extension missing).';
    RETURN NEW;
  WHEN OTHERS THEN
    -- Never let a sync failure abort the order status update
    RAISE WARNING '[notion-sync] enqueue failed for orders id %: %', NEW.id, SQLERRM;
    RETURN NEW;
END;
$$;

-- ── 2. Attach trigger ────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_orders_notion_sync ON public.orders;

CREATE TRIGGER trg_orders_notion_sync
  AFTER UPDATE ON public.orders
  FOR EACH ROW
  WHEN (NEW.status = 'completed' AND OLD.status IS DISTINCT FROM 'completed')
  EXECUTE FUNCTION public.fn_trg_orders_notion_sync();
