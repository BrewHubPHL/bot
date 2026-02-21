// fix-clock.js — Manager-only endpoint to resolve missing clock-out entries.
// Finds the open time_log for a given employee and closes it at a specified time.

const { createClient } = require('@supabase/supabase-js');
const { authorize, json, sanitizedError } = require('./_auth');
const { requireCsrfHeader } = require('./_csrf');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return json(204, {});
  }

  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Method not allowed' });
  }

  // CSRF protection
  const csrfBlock = requireCsrfHeader(event);
  if (csrfBlock) return csrfBlock;

  // Manager-only + PIN auth required
  const auth = await authorize(event, { requireManager: true, requirePin: true });
  if (!auth.ok) return auth.response;

  try {
    const body = JSON.parse(event.body || '{}');
    const { employee_email, clock_out_time } = body;

    // ── Validate inputs ─────────────────────────────────────
    if (!employee_email || typeof employee_email !== 'string') {
      return json(400, { error: 'employee_email is required' });
    }

    if (!clock_out_time || typeof clock_out_time !== 'string') {
      return json(400, { error: 'clock_out_time is required (ISO 8601 datetime string)' });
    }

    // Parse and validate the clock-out time
    const clockOutDate = new Date(clock_out_time);
    if (isNaN(clockOutDate.getTime())) {
      return json(400, { error: 'clock_out_time must be a valid ISO 8601 date' });
    }

    // Don't allow clock-out times in the future
    if (clockOutDate.getTime() > Date.now() + 60_000) {
      return json(400, { error: 'clock_out_time cannot be in the future' });
    }

    // ── Find the open (active) time_log for this employee ───
    const { data: openLogs, error: findErr } = await supabase
      .from('time_logs')
      .select('id, clock_in, employee_email')
      .eq('employee_email', employee_email.toLowerCase().trim())
      .eq('status', 'active')
      .is('clock_out', null)
      .order('clock_in', { ascending: false })
      .limit(1);

    if (findErr) {
      console.error('[FIX-CLOCK] Find error:', findErr);
      return json(500, { error: 'Failed to look up open shift' });
    }

    if (!openLogs || openLogs.length === 0) {
      return json(404, { error: 'No open clock-in found for this employee' });
    }

    const openLog = openLogs[0];

    // Clock-out must be after clock-in
    const clockInDate = new Date(openLog.clock_in);
    if (clockOutDate.getTime() <= clockInDate.getTime()) {
      return json(400, { error: 'clock_out_time must be after the clock-in time' });
    }

    // Sanity check: don't allow shifts longer than 24 hours
    const shiftMs = clockOutDate.getTime() - clockInDate.getTime();
    if (shiftMs > 24 * 60 * 60 * 1000) {
      return json(400, { error: 'Corrected shift cannot exceed 24 hours. Adjust the clock-out time.' });
    }

    // ── Apply the fix ───────────────────────────────────────
    const { error: updateErr } = await supabase
      .from('time_logs')
      .update({
        clock_out: clockOutDate.toISOString(),
        status: 'completed',
        action_type: 'out',
      })
      .eq('id', openLog.id);

    if (updateErr) {
      console.error('[FIX-CLOCK] Update error:', updateErr);
      return json(500, { error: 'Failed to fix clock-out' });
    }

    // Update staff is_working flag
    await supabase
      .from('staff_directory')
      .update({ is_working: false })
      .eq('email', employee_email.toLowerCase().trim());

    const managerEmail = auth.user?.email || 'unknown';
    console.log(`[FIX-CLOCK] Manager ${managerEmail} fixed clock-out for ${employee_email} → ${clockOutDate.toISOString()} (log ${openLog.id})`);

    return json(200, {
      success: true,
      log_id: openLog.id,
      clock_in: openLog.clock_in,
      clock_out: clockOutDate.toISOString(),
    });
  } catch (err) {
    return sanitizedError(err, 'fix-clock');
  }
};
