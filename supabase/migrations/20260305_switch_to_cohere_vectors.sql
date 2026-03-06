-- ============================================================
-- MIGRATION: Switch embeddings from OpenAI (1536-d) to Cohere (1024-d)
--
-- Context:
--   Replacing OpenAI text-embedding-3-small (1536 dimensions) with
--   Cohere embed-english-v3.0 (1024 dimensions). This requires
--   dropping the old column/index and recreating with the new size.
--
-- NOTE: All existing embeddings are invalidated by this migration.
--   A backfill job must re-embed all merch_products rows using
--   Cohere after this migration runs.
-- ============================================================

-- 1. Drop the old IVFFlat index
DROP INDEX IF EXISTS idx_merch_products_embedding;

-- 2. Drop the old 1536-dimension embedding column
ALTER TABLE public.merch_products DROP COLUMN IF EXISTS embedding;

-- 3. Add the new 1024-dimension embedding column (Cohere embed-english-v3.0)
ALTER TABLE public.merch_products ADD COLUMN embedding vector(1024);

-- 4. Recreate the IVFFlat index for the new column
CREATE INDEX idx_merch_products_embedding
  ON public.merch_products
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 10);

-- 5. Update the semantic search RPC to expect vector(1024)
CREATE OR REPLACE FUNCTION public.match_menu_items(
  query_embedding vector(1024),
  match_threshold float DEFAULT 0.78,
  match_count int DEFAULT 5
)
RETURNS TABLE (
  id uuid,
  name text,
  description text,
  price_cents int,
  category text,
  similarity float
)
LANGUAGE sql
STABLE
SET search_path = public, extensions
AS $$
  SELECT
    mp.id,
    mp.name,
    mp.description,
    mp.price_cents,
    mp.category,
    1 - (mp.embedding <=> query_embedding) AS similarity
  FROM public.merch_products mp
  WHERE
    mp.embedding IS NOT NULL
    AND mp.is_active = true
    AND mp.archived_at IS NULL
    AND 1 - (mp.embedding <=> query_embedding) > match_threshold
  ORDER BY mp.embedding <=> query_embedding
  LIMIT match_count;
$$;

-- 6. Re-grant EXECUTE to roles (signature changed, so re-grant is needed)
GRANT EXECUTE ON FUNCTION public.match_menu_items(vector(1024), float, int)
  TO authenticated, anon;

-- 7. Revoke the old 1536 signature grant (safe no-op if already gone)
DO $$
BEGIN
  EXECUTE 'REVOKE EXECUTE ON FUNCTION public.match_menu_items(vector(1536), float, int) FROM authenticated, anon';
EXCEPTION WHEN undefined_function THEN
  NULL; -- old signature already dropped by CREATE OR REPLACE
END;
$$;
