-- #############################################################################
-- ## schema-63-scheduled-shifts-rls.sql — RLS for scheduled_shifts table
-- ##
-- ## Context: The AdminCalendar.tsx component uses the Supabase ANON key
-- ## (not service_role) because it runs in the browser via the (ops) layout.
-- ## Without RLS policies, all client-side reads/writes silently return
-- ## empty results.
-- ##
-- ## Policies:
-- ##   SELECT:  Any authenticated staff member can view their own shifts.
-- ##            Managers/admins can view ALL shifts (for the drag-and-drop
-- ##            calendar).
-- ##   INSERT:  Managers/admins only.
-- ##   UPDATE:  Managers/admins only. Protected columns (id, user_id,
-- ##            created_at) are frozen via a BEFORE UPDATE trigger.
-- ##   DELETE:  Managers/admins only.
-- ##
-- ## Also fixes: staff_directory_safe → scheduled_shifts join path for
-- ## PostgREST by adding a foreign key from staff_directory.id → auth.users.id
-- ## (if not already present) so the Supabase client can resolve the
-- ## .select('..., staff_directory_safe(name)') embedded resource.
-- #############################################################################

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Enable RLS on scheduled_shifts
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.scheduled_shifts ENABLE ROW LEVEL SECURITY;

-- Force RLS even for table owners (defense in depth — only service_role bypasses)
ALTER TABLE public.scheduled_shifts FORCE ROW LEVEL SECURITY;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. SELECT policies
-- ─────────────────────────────────────────────────────────────────────────────

-- Staff can see their own shifts
DROP POLICY IF EXISTS "Staff can view own shifts" ON public.scheduled_shifts;
CREATE POLICY "Staff can view own shifts" ON public.scheduled_shifts
  FOR SELECT
  USING (user_id = auth.uid());

-- Managers/admins can see ALL shifts (required for the calendar grid)
DROP POLICY IF EXISTS "Managers can view all shifts" ON public.scheduled_shifts;
CREATE POLICY "Managers can view all shifts" ON public.scheduled_shifts
  FOR SELECT
  USING (is_brewhub_manager());

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. INSERT policy — managers only
-- ─────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Managers can create shifts" ON public.scheduled_shifts;
CREATE POLICY "Managers can create shifts" ON public.scheduled_shifts
  FOR INSERT
  WITH CHECK (is_brewhub_manager());

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. UPDATE policy — managers only
-- ─────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Managers can update shifts" ON public.scheduled_shifts;
CREATE POLICY "Managers can update shifts" ON public.scheduled_shifts
  FOR UPDATE
  USING  (is_brewhub_manager())
  WITH CHECK (is_brewhub_manager());

-- Freeze protected columns on UPDATE (prevents moving a shift to another user
-- or tampering with the primary key / audit trail via the client SDK)
CREATE OR REPLACE FUNCTION guard_shift_protected_columns()
RETURNS trigger AS $$
BEGIN
  IF current_setting('role', true) NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;

  NEW.id         := OLD.id;
  NEW.user_id    := OLD.user_id;
  NEW.created_at := OLD.created_at;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_guard_shift_protected ON public.scheduled_shifts;
CREATE TRIGGER trg_guard_shift_protected
  BEFORE UPDATE ON public.scheduled_shifts
  FOR EACH ROW
  EXECUTE FUNCTION guard_shift_protected_columns();

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. DELETE policy — managers only
-- ─────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Managers can delete shifts" ON public.scheduled_shifts;
CREATE POLICY "Managers can delete shifts" ON public.scheduled_shifts
  FOR DELETE
  USING (is_brewhub_manager());

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Grant table access to authenticated role
--    (RLS will enforce row-level restrictions)
-- ─────────────────────────────────────────────────────────────────────────────
GRANT SELECT, INSERT, UPDATE, DELETE ON public.scheduled_shifts TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. NOTE: staff_directory.id is NOT FK'd to auth.users.id
--
--    The staff_directory table contains rows seeded with UUIDs that may
--    not exist in auth.users (e.g. demo/test staff, pre-provisioned
--    employees). Adding a FK would violate referential integrity for
--    those existing rows.
--
--    Instead of relying on PostgREST implicit joins (which require an
--    unbroken FK chain), the AdminCalendar queries the explicit view
--    below, which uses a LEFT JOIN to handle the mismatch gracefully.
-- ─────────────────────────────────────────────────────────────────────────────

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. Create a lightweight view that the calendar can query directly
--    (avoids the PostgREST implicit-join fragility entirely)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.v_scheduled_shifts_with_staff AS
SELECT
  ss.id,
  ss.user_id,
  ss.start_time,
  ss.end_time,
  ss.role_id,
  ss.location_id,
  ss.status,
  ss.updated_at,
  COALESCE(sd.full_name, sd.name, sd.email, 'Unknown') AS employee_name
FROM public.scheduled_shifts ss
LEFT JOIN public.staff_directory sd ON sd.id = ss.user_id;

-- The view inherits scheduled_shifts RLS because security_invoker is the
-- default for views in modern Postgres (15+). Explicit for clarity:
ALTER VIEW public.v_scheduled_shifts_with_staff SET (security_invoker = true);

GRANT SELECT ON public.v_scheduled_shifts_with_staff TO authenticated;

COMMENT ON VIEW public.v_scheduled_shifts_with_staff IS
  'Calendar-ready view joining shifts with staff names. '
  'Inherits RLS from scheduled_shifts — staff see own, managers see all.';
