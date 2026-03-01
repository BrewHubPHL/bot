-- ============================================================
-- SCHEMA 21: Strict WITH CHECK on resume_url
--
-- Prevents arbitrary text injection into the resume_url column.
-- Allowed values:
--   1. NULL               (resume is optional)
--   2. https://  URLs     (public Supabase Storage URLs)
--   3. Supabase storage paths matching our bucket convention
--      e.g. "resumes/1700000000000-jane-doe.pdf"
-- ============================================================

-- 1. Replace the wide-open anon INSERT policy with a validated one
DROP POLICY IF EXISTS "Anon can submit application" ON job_applications;

CREATE POLICY "Anon can submit application"
  ON job_applications
  FOR INSERT
  TO anon
  WITH CHECK (
    resume_url IS NULL
    OR resume_url ~ '^https://'
    OR resume_url ~ '^resumes/[0-9]+-[a-z0-9-]+\.pdf$'
  );

-- 2. Tighten the staff UPDATE policy to enforce the same constraint
DROP POLICY IF EXISTS "Staff can update applications" ON job_applications;

CREATE POLICY "Staff can update applications"
  ON job_applications
  FOR UPDATE
  USING  (is_brewhub_staff())
  WITH CHECK (
    is_brewhub_staff()
    AND (
      resume_url IS NULL
      OR resume_url ~ '^https://'
      OR resume_url ~ '^resumes/[0-9]+-[a-z0-9-]+\.pdf$'
    )
  );
