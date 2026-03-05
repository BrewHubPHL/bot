-- ═══════════════════════════════════════════════════════════════════════════
-- Schema 88 — Notion Sync Idempotency: Status-Based Retry Support
-- ═══════════════════════════════════════════════════════════════════════════
-- Fixes: idempotency row inserted BEFORE the Notion API call permanently
-- blocks retries when createNotionPage fails.
--
-- Changes:
--   1) Adds status column ('pending', 'completed', 'failed') with default 'pending'
--   2) Adds notion_page_id column to store the resulting Notion page ID
--   3) Adds updated_at column for tracking state transitions
--   4) Replaces UNIQUE constraint to use a partial unique index
--      (only 'completed' rows block duplicates)
--   5) Creates RPC claim_notion_sync() — atomically claims a sync slot
--   6) Creates RPC complete_notion_sync() — marks completed with page ID
--   7) Creates RPC fail_notion_sync() — marks failed, unlocking retries
-- ═══════════════════════════════════════════════════════════════════════════

-- 1) Add new columns
ALTER TABLE public.processed_notion_syncs
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'completed', 'failed'));

ALTER TABLE public.processed_notion_syncs
  ADD COLUMN IF NOT EXISTS notion_page_id text;

ALTER TABLE public.processed_notion_syncs
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- 2) Backfill existing rows as 'completed' (they already succeeded)
UPDATE public.processed_notion_syncs SET status = 'completed' WHERE status = 'pending';

-- 3) Drop the old UNIQUE constraint on sync_key
--    (replaced by a partial unique index on completed rows only)
ALTER TABLE public.processed_notion_syncs
  DROP CONSTRAINT IF EXISTS processed_notion_syncs_sync_key_key;

-- 4) Create partial unique index: only one COMPLETED row per sync_key
CREATE UNIQUE INDEX IF NOT EXISTS idx_notion_syncs_completed_unique
  ON public.processed_notion_syncs (sync_key) WHERE (status = 'completed');

-- 5) Index for finding stale pending/failed rows for cleanup
CREATE INDEX IF NOT EXISTS idx_notion_syncs_retryable
  ON public.processed_notion_syncs (sync_key, status) WHERE (status IN ('pending', 'failed'));


-- ═══════════════════════════════════════════════════════════════════════════
-- RPC: claim_notion_sync
-- Atomically claims a sync slot. Returns:
--   'claimed'    — new pending row inserted, caller should proceed
--   'duplicate'  — a completed row already exists, skip
--   'retry'      — a previous failed row was found and reclaimed
-- Uses advisory lock on sync_key hash to prevent race conditions.
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.claim_notion_sync(
  p_sync_key       text,
  p_source_table   text,
  p_source_record_id uuid,
  p_notion_database text,
  p_payload        jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lock_key bigint;
  v_existing record;
  v_row_id   uuid;
BEGIN
  -- Compute a stable advisory lock key from the sync_key
  v_lock_key := hashtext(p_sync_key);

  -- Acquire transaction-scoped advisory lock (blocks concurrent claims for same key)
  PERFORM pg_advisory_xact_lock(v_lock_key);

  -- Check for existing rows with this sync_key
  SELECT id, status INTO v_existing
    FROM public.processed_notion_syncs
    WHERE sync_key = p_sync_key
    ORDER BY
      CASE status WHEN 'completed' THEN 0 WHEN 'pending' THEN 1 ELSE 2 END
    LIMIT 1
    FOR UPDATE;

  -- If a completed row exists, it's a true duplicate
  IF v_existing.id IS NOT NULL AND v_existing.status = 'completed' THEN
    RETURN jsonb_build_object('result', 'duplicate', 'row_id', v_existing.id);
  END IF;

  -- If a pending row exists (from a concurrent/crashed attempt), reclaim it
  IF v_existing.id IS NOT NULL AND v_existing.status = 'pending' THEN
    UPDATE public.processed_notion_syncs
      SET updated_at = now(),
          payload = p_payload
      WHERE id = v_existing.id;
    RETURN jsonb_build_object('result', 'retry', 'row_id', v_existing.id);
  END IF;

  -- If a failed row exists, reclaim it by resetting to pending
  IF v_existing.id IS NOT NULL AND v_existing.status = 'failed' THEN
    UPDATE public.processed_notion_syncs
      SET status = 'pending',
          updated_at = now(),
          payload = p_payload,
          notion_page_id = NULL
      WHERE id = v_existing.id;
    RETURN jsonb_build_object('result', 'retry', 'row_id', v_existing.id);
  END IF;

  -- No existing row — insert a new pending row
  INSERT INTO public.processed_notion_syncs
    (sync_key, source_table, source_record_id, notion_database, payload, status)
  VALUES
    (p_sync_key, p_source_table, p_source_record_id, p_notion_database, p_payload, 'pending')
  RETURNING id INTO v_row_id;

  RETURN jsonb_build_object('result', 'claimed', 'row_id', v_row_id);
END;
$$;


-- ═══════════════════════════════════════════════════════════════════════════
-- RPC: complete_notion_sync
-- Marks a pending row as completed after a successful Notion API call.
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.complete_notion_sync(
  p_row_id        uuid,
  p_notion_page_id text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.processed_notion_syncs
    SET status = 'completed',
        notion_page_id = p_notion_page_id,
        updated_at = now()
    WHERE id = p_row_id AND status = 'pending';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No pending sync row found for id %', p_row_id;
  END IF;
END;
$$;


-- ═══════════════════════════════════════════════════════════════════════════
-- RPC: fail_notion_sync
-- Marks a pending row as failed, allowing future retries.
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.fail_notion_sync(
  p_row_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.processed_notion_syncs
    SET status = 'failed',
        updated_at = now()
    WHERE id = p_row_id AND status = 'pending';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No pending sync row found for id %', p_row_id;
  END IF;
END;
$$;
