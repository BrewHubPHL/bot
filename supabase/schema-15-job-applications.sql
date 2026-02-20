-- ============================================================
-- SCHEMA 15: Job Applications Table + RLS
--
-- SECURITY MODEL:
--   - anon can INSERT (public-facing careers form).
--   - anon CANNOT SELECT (prevents applicants reading each other's data).
--   - Staff (is_brewhub_staff()) can SELECT and UPDATE
--     (for the hiring pipeline dashboard).
-- ============================================================

-- 1. Create table
CREATE TABLE IF NOT EXISTS job_applications (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name           text        NOT NULL,
  email          text        NOT NULL,
  phone          text,
  availability   text,
  scenario_answer text       NOT NULL,
  status         text        NOT NULL DEFAULT 'pending',
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- 2. Enable Row Level Security
ALTER TABLE job_applications ENABLE ROW LEVEL SECURITY;

-- 3. anon INSERT — allows the public form to submit
DROP POLICY IF EXISTS "Anon can submit application" ON job_applications;
CREATE POLICY "Anon can submit application"
  ON job_applications
  FOR INSERT
  TO anon
  WITH CHECK (true);

-- 4. NO anon SELECT — deny-all default blocks reads for unauthenticated users.
--    Explicitly drop any accidental read policy that may have been created.
DROP POLICY IF EXISTS "Anon can read applications" ON job_applications;

-- 5. Staff SELECT — full read access for the hiring pipeline
DROP POLICY IF EXISTS "Staff can read applications" ON job_applications;
CREATE POLICY "Staff can read applications"
  ON job_applications
  FOR SELECT
  USING (is_brewhub_staff());

-- 6. Staff UPDATE — allows status changes (pending → interviewed → hired / rejected)
DROP POLICY IF EXISTS "Staff can update applications" ON job_applications;
CREATE POLICY "Staff can update applications"
  ON job_applications
  FOR UPDATE
  USING (is_brewhub_staff())
  WITH CHECK (is_brewhub_staff());

-- 7. Prevent anon from calling authenticated-only RPCs via this table
REVOKE ALL ON job_applications FROM anon;
GRANT INSERT ON job_applications TO anon;
GRANT SELECT, INSERT, UPDATE ON job_applications TO authenticated;
