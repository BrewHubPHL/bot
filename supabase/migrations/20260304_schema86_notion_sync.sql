-- ═══════════════════════════════════════════════════════════════════════════
-- Schema 86 — Notion Operations Ledger Sync
-- ═══════════════════════════════════════════════════════════════════════════
-- Adds:
--   1) processed_notion_syncs table for idempotent outbound Notion sync events
--   2) manager_override_log AFTER INSERT trigger that posts to
--      /.netlify/functions/notion-sync via pg_net (net.http_post)
--
-- Runtime settings used by trigger function:
--   app.settings.notion_sync_webhook_url (optional)
--   app.settings.internal_sync_secret   (required for auth)
--
-- If URL is not configured, defaults to production domain.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

CREATE TABLE IF NOT EXISTS public.processed_notion_syncs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sync_key text NOT NULL UNIQUE,
  source_table text NOT NULL CHECK (source_table = ANY (ARRAY['orders'::text, 'manager_override_log'::text, 'customers'::text])),
  source_record_id uuid,
  notion_database text NOT NULL CHECK (notion_database = ANY (ARRAY['sales_ledger'::text, 'audit_trail'::text, 'customers'::text])),
  processed_at timestamptz NOT NULL DEFAULT now(),
  payload jsonb
);

CREATE INDEX IF NOT EXISTS idx_processed_notion_syncs_source
  ON public.processed_notion_syncs(source_table, source_record_id, processed_at DESC);

ALTER TABLE public.processed_notion_syncs ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'processed_notion_syncs'
      AND policyname = 'Deny public access to processed_notion_syncs'
  ) THEN
    CREATE POLICY "Deny public access to processed_notion_syncs"
      ON public.processed_notion_syncs
      FOR ALL
      USING (false)
      WITH CHECK (false);
  END IF;
END$$;

CREATE OR REPLACE FUNCTION public.enqueue_manager_override_notion_sync()
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
  request_id bigint;
BEGIN
  IF sync_secret IS NULL THEN
    RAISE WARNING '[notion-sync] app.settings.internal_sync_secret is not configured; webhook auth will fail.';
  END IF;

  SELECT net.http_post(
    url := webhook_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'X-BrewHub-Action', 'true',
      'x-brewhub-secret', COALESCE(sync_secret, '')
    ),
    body := jsonb_build_object(
      'source_table', 'manager_override_log',
      'action', 'INSERT',
      'sync_key', CONCAT('manager_override_log:', NEW.id::text),
      'record', to_jsonb(NEW)
    )
  ) INTO request_id;

  RETURN NEW;
EXCEPTION
  WHEN undefined_function THEN
    RAISE WARNING '[notion-sync] net.http_post unavailable (pg_net missing).';
    RETURN NEW;
  WHEN OTHERS THEN
    RAISE WARNING '[notion-sync] enqueue failed for manager_override_log id %: %', NEW.id, SQLERRM;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_manager_override_notion_sync ON public.manager_override_log;

CREATE TRIGGER trg_manager_override_notion_sync
  AFTER INSERT ON public.manager_override_log
  FOR EACH ROW
  EXECUTE FUNCTION public.enqueue_manager_override_notion_sync();
