// fix-clock.js — Manager-only endpoint to resolve missing clock-out entries.
// Finds the open time_log for a given employee, closes it at a specified time,
// and records the correction with an IRS-compliant audit trail.

const { createClient } = require('@supabase/supabase-js');
const { authorize } = require('./_auth');
const { requireCsrfHeader } = require('./_csrf');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const ALLOWED_ORIGIN = process.env.SITE_URL || 'https://brewhubphl.com';

const cors = (code, data) => ({
  statusCode: code,
  headers: {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-BrewHub-Action',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  },
  body: JSON.stringify(data),
});

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: {
        'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-BrewHub-Action',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
      },
      body: '',
    };
  }

  if (event.httpMethod !== 'POST') {
    return cors(405, { error: 'Method not allowed' });
  }

  // CSRF protection
  const csrfBlock = requireCsrfHeader(event);
  if (csrfBlock) return csrfBlock;

  // Manager-only + PIN auth required
  const auth = await authorize(event, { requireManager: true, requirePin: true });
  if (!auth.ok) return auth.response;

  try {
    const body = JSON.parse(event.body || '{}');
    const { employee_email, clock_out_time, reason } = body;

    // ── Validate inputs ─────────────────────────────────────
    if (!employee_email || typeof employee_email !== 'string') {
      return cors(400, { error: 'employee_email is required' });
    }

    if (!clock_out_time || typeof clock_out_time !== 'string') {
      return cors(400, { error: 'clock_out_time is required (ISO 8601 datetime string)' });
    }

    // IRS compliance: require a reason for every manual correction
    if (!reason || typeof reason !== 'string' || reason.trim().length < 3) {
      return cors(400, { error: 'A reason is required for clock corrections (minimum 3 characters)' });
    }

    // Parse and validate the clock-out time
    const clockOutDate = new Date(clock_out_time);
    if (isNaN(clockOutDate.getTime())) {
      return cors(400, { error: 'clock_out_time must be a valid ISO 8601 date' });
    }

    // Don't allow clock-out times in the future
    if (clockOutDate.getTime() > Date.now() + 60_000) {
      return cors(400, { error: 'clock_out_time cannot be in the future' });
    }

    // ── Find the open (active) time_log for this employee ───
    const { data: openLogs, error: findErr } = await supabase
      .from('time_logs')
      .select('id, clock_in, employee_email, status, action_type')
      .eq('employee_email', employee_email.toLowerCase().trim())
      .is('clock_out', null)
      .in('action_type', ['in'])
      .order('clock_in', { ascending: false })
      .limit(1);

    if (findErr) {
      console.error('[FIX-CLOCK] Find error:', findErr);
      return cors(500, { error: 'Failed to look up open shift' });
    }

    if (!openLogs || openLogs.length === 0) {
      return cors(404, { error: 'No open clock-in found for this employee' });
    }

    const openLog = openLogs[0];

    // Clock-out must be after clock-in
    const clockInDate = new Date(openLog.clock_in);
    if (clockOutDate.getTime() <= clockInDate.getTime()) {
      return cors(400, { error: 'clock_out_time must be after the clock-in time' });
    }

    // Sanity check: don't allow shifts longer than 24 hours
    const shiftMs = clockOutDate.getTime() - clockInDate.getTime();
    if (shiftMs > 24 * 60 * 60 * 1000) {
      return cors(400, { error: 'Corrected shift cannot exceed 24 hours. Adjust the clock-out time.' });
    }

    const managerEmail = auth.user?.email || 'unknown';
    const managerId = auth.user?.id || null;
    const shiftMinutes = Math.round(shiftMs / 60_000);

    // ── Apply the fix + audit trail (atomic) ────────────────
    // Close the open shift
    const { error: updateErr } = await supabase
      .from('time_logs')
      .update({
        clock_out: clockOutDate.toISOString(),
        status: 'completed',
        action_type: 'out',
        // Audit metadata on the corrected row
        needs_manager_review: false,
        notes: `[MANAGER CORRECTION] By ${managerEmail} at ${new Date().toISOString()}: ${reason.trim()}`
      })
      .eq('id', openLog.id);

    if (updateErr) {
      console.error('[FIX-CLOCK] Update error:', updateErr);
      return cors(500, { error: 'Failed to fix clock-out' });
    }

    // Record the correction via atomic_payroll_adjustment for full audit trail
    // Use delta_minutes = shift duration so the adjustment log captures the full corrected shift
    const { error: auditErr } = await supabase.rpc('atomic_payroll_adjustment', {
      p_employee_email: employee_email.toLowerCase().trim(),
      p_delta_minutes: shiftMinutes,
      p_reason: `[CLOCK FIX] Manager ${managerEmail} closed open shift (log ${openLog.id}). Clock-in: ${openLog.clock_in}, Corrected clock-out: ${clockOutDate.toISOString()}. Reason: ${reason.trim()}`,
      p_manager_id: managerId,
      p_target_date: clockOutDate.toISOString(),
    });

    if (auditErr) {
      // Non-fatal: the clock fix succeeded, but audit recording failed
      console.error('[FIX-CLOCK] Audit trail warning (non-fatal):', auditErr.message);
    }

    // Update staff is_working flag
    await supabase
      .from('staff_directory')
      .update({ is_working: false })
      .eq('email', employee_email.toLowerCase().trim());

    console.log(`[FIX-CLOCK] Manager ${managerEmail} fixed clock-out for ${employee_email} → ${clockOutDate.toISOString()} (log ${openLog.id}, reason: ${reason.trim()})`);

    return cors(200, {
      success: true,
      log_id: openLog.id,
      clock_in: openLog.clock_in,
      clock_out: clockOutDate.toISOString(),
      shift_minutes: shiftMinutes,
    });
  } catch (err) {
    console.error('[FIX-CLOCK] Unhandled error:', err?.message || err);
    return cors(500, { error: 'An error occurred. Please try again.' });
  }
};
