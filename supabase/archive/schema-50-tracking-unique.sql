-- schema-50-tracking-unique.sql
-- Audit #10: Fix RT-1 TOCTOU race condition on register-tracking.js
--
-- The existing idx_expected_tracking index is non-unique, so concurrent
-- INSERT calls can both pass a SELECT check and create duplicates.
-- Replace with a UNIQUE constraint that lets the application use
-- INSERT … ON CONFLICT (via Supabase upsert) atomically.

-- Drop the old non-unique index
DROP INDEX IF EXISTS idx_expected_tracking;

-- Add a UNIQUE constraint (creates a unique index implicitly)
ALTER TABLE expected_parcels
  ADD CONSTRAINT uq_expected_parcels_tracking_number UNIQUE (tracking_number);
