-- ═══════════════════════════════════════════════════════════════════════════
-- Schema 87 — Fix Notion Sync Secret for Supabase Hosted
-- ═══════════════════════════════════════════════════════════════════════════
-- Supabase hosted does not allow ALTER DATABASE/ROLE SET for custom
-- settings, so current_setting('app.settings.internal_sync_secret') is
-- always NULL and the pg_net triggers send an empty auth header.
--
-- Fix: store the secret in a restricted config table and update both
-- trigger functions to read from it.
--
-- Idempotent: safe to re-run.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Config table ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.internal_config (
  key   text PRIMARY KEY,
  value text NOT NULL
);

ALTER TABLE public.internal_config ENABLE ROW LEVEL SECURITY;

-- Deny all access via API (service_role bypasses RLS; anon/authenticated blocked)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'internal_config'
      AND policyname = 'Deny public access to internal_config'
  ) THEN
    CREATE POLICY "Deny public access to internal_config"
      ON public.internal_config
      FOR ALL USING (false) WITH CHECK (false);
  END IF;
END$$;

-- Upsert the sync secret
INSERT INTO public.internal_config (key, value)
VALUES ('internal_sync_secret', 'lNtF5iMep9uTP81OFHfWzfbXe65KICA8Xj9H6NeIh1o=')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

-- Also store the webhook URL (optional override)
INSERT INTO public.internal_config (key, value)
VALUES ('notion_sync_webhook_url', 'https://brewhubphl.com/.netlify/functions/notion-sync')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;


-- ── 2. Updated manager_override_log trigger function ─────────────────────
CREATE OR REPLACE FUNCTION public.enqueue_manager_override_notion_sync()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  webhook_url text;
  sync_secret text;
  request_id  bigint;
BEGIN
  -- Read config from table (not current_setting — unavailable on Supabase hosted)
  SELECT value INTO webhook_url
    FROM public.internal_config WHERE key = 'notion_sync_webhook_url';
  webhook_url := COALESCE(webhook_url, 'https://brewhubphl.com/.netlify/functions/notion-sync');

  SELECT value INTO sync_secret
    FROM public.internal_config WHERE key = 'internal_sync_secret';

  IF sync_secret IS NULL THEN
    RAISE WARNING '[notion-sync] internal_config.internal_sync_secret missing; webhook auth will fail.';
  END IF;

  SELECT net.http_post(
    url     := webhook_url,
    headers := jsonb_build_object(
      'Content-Type',     'application/json',
      'X-BrewHub-Action', 'true',
      'x-brewhub-secret', COALESCE(sync_secret, '')
    ),
    body := jsonb_build_object(
      'source_table', 'manager_override_log',
      'action',       'INSERT',
      'sync_key',     CONCAT('manager_override_log:', NEW.id::text),
      'record',       to_jsonb(NEW)
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


-- ── 3. Updated orders trigger function ───────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_trg_orders_notion_sync()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  webhook_url text;
  sync_secret text;
  request_id  bigint;
BEGIN
  IF (NEW.status = 'completed') AND (OLD.status IS DISTINCT FROM 'completed') THEN

    -- Read config from table (not current_setting — unavailable on Supabase hosted)
    SELECT value INTO webhook_url
      FROM public.internal_config WHERE key = 'notion_sync_webhook_url';
    webhook_url := COALESCE(webhook_url, 'https://brewhubphl.com/.netlify/functions/notion-sync');

    SELECT value INTO sync_secret
      FROM public.internal_config WHERE key = 'internal_sync_secret';

    IF sync_secret IS NULL THEN
      RAISE WARNING '[notion-sync] internal_config.internal_sync_secret missing; orders webhook auth will fail.';
    END IF;

    SELECT net.http_post(
      url     := webhook_url,
      headers := jsonb_build_object(
        'Content-Type',     'application/json',
        'X-BrewHub-Action', 'true',
        'x-brewhub-secret', COALESCE(sync_secret, '')
      ),
      body := jsonb_build_object(
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
    RAISE WARNING '[notion-sync] net.http_post unavailable (pg_net extension missing).';
    RETURN NEW;
  WHEN OTHERS THEN
    RAISE WARNING '[notion-sync] enqueue failed for orders id %: %', NEW.id, SQLERRM;
    RETURN NEW;
END;
$$;

-- Triggers remain the same (CREATE OR REPLACE on the functions updates them in-place)
