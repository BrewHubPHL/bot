-- Create or Replace the Tardiness Paper Trail View
CREATE OR REPLACE VIEW public.v_attendance_report AS
SELECT DISTINCT ON (ss.id)
    ss.id AS shift_id,
    ss.user_id,
    sd.email AS employee_email, 
    ss.start_time AS scheduled_start,
    ss.end_time AS scheduled_end,
    tl.clock_in AS actual_clock_in,
    
    -- Calculate delay in minutes
    EXTRACT(EPOCH FROM (tl.clock_in - ss.start_time)) / 60 AS minutes_late,
    
    -- Status Logic
    CASE 
        WHEN tl.clock_in IS NULL AND NOW() > (ss.start_time + INTERVAL '30 minutes') THEN 'No-Show'
        WHEN tl.clock_in IS NULL THEN 'Pending'
        WHEN (tl.clock_in - ss.start_time) > INTERVAL '10 minutes' THEN 'Tardy'
        WHEN (tl.clock_in - ss.start_time) < INTERVAL '-15 minutes' THEN 'Early Clock-in'
        ELSE 'On-Time'
    END AS attendance_status

FROM public.scheduled_shifts ss
-- 1. Bridge the Auth UUID to the Employee Email
LEFT JOIN public.staff_directory_safe sd ON ss.user_id = sd.id 
-- 2. Join the Time Logs using the email and a 3-hour buffer
LEFT JOIN public.time_logs tl ON LOWER(sd.email) = LOWER(tl.employee_email)
    AND tl.clock_in BETWEEN (ss.start_time - INTERVAL '3 hours') AND (ss.start_time + INTERVAL '3 hours')

-- 3. Claude's Audit Fix: Prevent double-shift errors by grabbing the absolute closest clock-in
ORDER BY ss.id, ABS(EXTRACT(EPOCH FROM (tl.clock_in - ss.start_time))) ASC;