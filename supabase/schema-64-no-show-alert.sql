-- Enable the HTTP extension so Supabase can talk to your Netlify function
CREATE EXTENSION IF NOT EXISTS http WITH SCHEMA extensions;

-- ─────────────────────────────────────────────────────────────────────────────
-- Add 'no_show' is already in the enum (schema-61). We do NOT need a new
-- value — 'no-show-alerted' was invalid. We reuse 'no_show' which already
-- exists in shift_status: ('scheduled','completed','no_show','cancelled').
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION check_for_noshows()
RETURNS void AS $$
DECLARE
  late_shift RECORD;
  v_response extensions.http_response;
BEGIN
  -- Find shifts that started > 15 mins ago with no matching clock-in.
  --
  -- IMPORTANT: time_logs joins on employee_email (not user_id),
  -- so we bridge through staff_directory to get the email.
  FOR late_shift IN
    SELECT
      s.id,
      sd.name  AS employee_name,
      sd.email AS employee_email,
      s.start_time
    FROM public.scheduled_shifts s
    JOIN public.staff_directory sd ON s.user_id = sd.id
    WHERE s.start_time < (now() - interval '15 minutes')
      AND s.start_time > (now() - interval '2 hours')   -- only recent shifts
      AND s.status = 'scheduled'                         -- not yet resolved
      -- Check time_logs (the actual clock system) for a clock-in
      AND NOT EXISTS (
        SELECT 1 FROM public.time_logs tl
        WHERE LOWER(tl.employee_email) = LOWER(sd.email)
          AND tl.action_type = 'in'
          AND tl.clock_in BETWEEN (s.start_time - interval '30 minutes')
                                AND (s.start_time + interval '15 minutes')
      )
  LOOP
    -- Fire the SMS via the Netlify scheduled function endpoint
    SELECT * INTO v_response FROM extensions.http_post(
      'https://brewhubphl.com/.netlify/functions/no-show-alert',
      json_build_object(
        'employeeName', late_shift.employee_name,
        'shiftTime',    to_char(
                          late_shift.start_time AT TIME ZONE 'UTC'
                                                AT TIME ZONE 'America/New_York',
                          'HH12:MI AM'
                        ),
        'managerPhone', '+17174259285'
      )::text,
      'application/json'
    );

    -- Mark as no_show so we only alert ONCE per missed shift
    UPDATE public.scheduled_shifts
       SET status = 'no_show'
     WHERE id = late_shift.id;
  END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION check_for_noshows IS
  'Scans scheduled_shifts for employees who missed the 15-min grace period '
  'with no matching clock-in in time_logs. Sends SMS via Twilio/Netlify and '
  'marks the shift as no_show. Called by pg_cron every 5 minutes.';