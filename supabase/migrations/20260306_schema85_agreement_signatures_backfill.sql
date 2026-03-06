-- ═══════════════════════════════════════════════════════════════════════════
-- Schema 85 — Backfill missing created_at on agreement_signatures
-- ═══════════════════════════════════════════════════════════════════════════
-- The table was created before schema 84 added created_at. This migration
-- adds the column if it does not already exist to resolve the schema-health
-- drift alert on the manager dashboard.
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'agreement_signatures' AND column_name = 'created_at'
  ) THEN
    ALTER TABLE agreement_signatures
      ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();

    -- Backfill existing rows: set created_at = signed_at
    UPDATE agreement_signatures SET created_at = signed_at WHERE created_at = now();
  END IF;
END
$$;
