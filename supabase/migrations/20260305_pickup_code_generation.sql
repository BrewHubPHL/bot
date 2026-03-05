-- Migration: Add 'code_generated' attempt type + code_hash column to parcel_pickup_log
-- Purpose: Support the secure high-value pickup code generation flow.
-- The new attempt_type tracks when a staff member generates a pickup code for a
-- high-value parcel. The code_hash column stores the HMAC hash for audit purposes.

-- 1. Expand the CHECK constraint to include 'code_generated'
ALTER TABLE public.parcel_pickup_log
  DROP CONSTRAINT IF EXISTS parcel_pickup_log_attempt_type_check;

ALTER TABLE public.parcel_pickup_log
  ADD CONSTRAINT parcel_pickup_log_attempt_type_check
  CHECK (attempt_type = ANY (ARRAY[
    'code_success'::text,
    'code_fail'::text,
    'id_verified'::text,
    'manager_override'::text,
    'denied'::text,
    'locked_out'::text,
    'code_generated'::text
  ]));

-- 2. Add code_hash column for audit trail
ALTER TABLE public.parcel_pickup_log
  ADD COLUMN IF NOT EXISTS code_hash text;
