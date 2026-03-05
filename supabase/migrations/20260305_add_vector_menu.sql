-- ============================================================
-- SCHEMA: pgvector Semantic Search for Menu Items (Elise AI)
--
-- Purpose:
--   Enable semantic / natural-language menu search so Elise can
--   match customer intent ("something chocolatey and icy") to
--   the closest catalog items via cosine similarity on embeddings.
--
-- Prerequisites:
--   Supabase project must have the pgvector extension available
--   (enabled on all Supabase plans).
--
-- Embedding model: 1536-dimensional (OpenAI text-embedding-3-small
--   or Voyage AI compatible).
--
-- RLS: The function runs as SECURITY INVOKER (default), so the
--   caller's existing RLS policies on merch_products apply.
--   Public users only see is_active=true rows; staff see all.
-- ============================================================

-- 1. Enable pgvector extension (idempotent)
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;

-- 2. Add embedding column to merch_products
ALTER TABLE public.merch_products
  ADD COLUMN IF NOT EXISTS embedding vector(1536);

-- 3. Index for fast approximate nearest-neighbor search (IVFFlat)
--    Lists tuned for small catalog (<1 000 items); re-tune if catalog grows.
CREATE INDEX IF NOT EXISTS idx_merch_products_embedding
  ON public.merch_products
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 10);

-- 4. Semantic search RPC — callable via supabase.rpc('match_menu_items', {...})
--
--    Returns active menu items closest to the query embedding,
--    filtered by cosine distance threshold.
--
--    Security: SECURITY INVOKER — inherits the caller's RLS context.
--    Public callers only see rows where is_active = true (existing policy).
--    Staff callers see all products (existing staff SELECT policy).
CREATE OR REPLACE FUNCTION public.match_menu_items(
  query_embedding vector(1536),
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
    AND 1 - (mp.embedding <=> query_embedding) > match_threshold
  ORDER BY mp.embedding <=> query_embedding
  LIMIT match_count;
$$;

-- 5. Grant EXECUTE to authenticated and anon roles so the RPC is
--    callable from the Supabase client. RLS on merch_products still
--    governs which rows each role can see.
GRANT EXECUTE ON FUNCTION public.match_menu_items(vector(1536), float, int)
  TO authenticated, anon;
