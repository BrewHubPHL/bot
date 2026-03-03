-- Migration: Add phone column to staff_directory
-- Date: 2026-03-02
-- Reason: The Staff Directory UI expects a phone number column.
--         Nullable because existing employees won't have data yet.

BEGIN;

ALTER TABLE public.staff_directory
  ADD COLUMN IF NOT EXISTS phone text;

COMMENT ON COLUMN public.staff_directory.phone IS
  'Staff member phone number. Nullable — populated via Edit Profile.';

-- v_staff_status uses `sd.*` so the new column is automatically included.

COMMIT;
