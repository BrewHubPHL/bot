-- ============================================================
-- SCHEMA 33: Enable Realtime on receipt_queue
-- ============================================================
-- Problem: The receipt_queue table has RLS that denies all access
-- to the anon role. Supabase Realtime (postgres_changes) respects
-- RLS and requires SELECT permission for the subscribing client.
-- Since the frontend connects with the anon key (not Supabase Auth),
-- the Realtime channel never delivers INSERT/UPDATE events.
--
-- Fix:
--   1. Add an anon-friendly SELECT policy for receipt_queue.
--      (Receipt text is not sensitive — it's the same info a
--       customer sees on their printed receipt.)
--   2. Add receipt_queue to the supabase_realtime publication
--      so postgres_changes events are emitted.
-- ============================================================

-- 1. Allow anon (and authenticated) SELECT so Realtime works
DROP POLICY IF EXISTS "Allow anon select for realtime" ON receipt_queue;
CREATE POLICY "Allow anon select for realtime" ON receipt_queue
  FOR SELECT
  USING (true);

-- 2. Add table to Realtime publication (idempotent: errors if already present)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'receipt_queue'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE receipt_queue;
  END IF;
END
$$;
