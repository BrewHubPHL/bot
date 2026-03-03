-- ═══════════════════════════════════════════════════════════════════════════
-- Schema Migration: scheduled_shifts FK → staff_directory
-- Date: 2026-03-02
--
-- Fixes admin calendar shift scheduling by ensuring scheduled_shifts.user_id
-- references public.staff_directory(id), not auth.users(id).
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- 1. Drop the incorrect constraint pointing to auth.users
ALTER TABLE public.scheduled_shifts
  DROP CONSTRAINT IF EXISTS scheduled_shifts_user_id_fkey;

-- 2. CLEANUP: Delete orphaned shifts whose user_id is not in staff_directory
DELETE FROM public.scheduled_shifts
WHERE user_id NOT IN (SELECT id FROM public.staff_directory);

-- 3. Add the correct FK constraint
ALTER TABLE public.scheduled_shifts
  ADD CONSTRAINT scheduled_shifts_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES public.staff_directory(id)
  ON DELETE CASCADE;

COMMIT;
