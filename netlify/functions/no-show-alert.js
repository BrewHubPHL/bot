/**
 * NO-SHOW ALERT (Scheduled Cron — every 5 minutes)
 * * Logic:
 * 1. Scans scheduled_shifts for 'scheduled' status past 15 min grace.
 * 2. Calculates lateness severity (Standard vs. Maldives Event).
 * 3. Checks time_logs for missing clock-in via employee_email bridge.
 * 4. Sends Tiered SMS via Twilio.
 * 5. Updates shift status to 'no_show' and logs to 'schedule_audit_logs'.
 */

const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');
const twilio = require('twilio');

// ── Helpers ──────────────────────────────────────────────────────────────────

function safeCompare(a, b) {
  if (!a || !b) return false;
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

const json = (code, data) => ({
  statusCode: code,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  body: JSON.stringify(data),
});

// ── Handler ──────────────────────────────────────────────────────────────────

exports.handler = async (event, context) => {
  // 1. Normalize headers
  const hdrs = {};
  for (const k of Object.keys(event.headers || {})) {
    hdrs[k.toLowerCase()] = event.headers[k];
  }

  // 2. Security: Only allow Netlify scheduled invocations or requests with CRON_SECRET
  const isScheduled =
    context?.clientContext?.custom?.scheduled === true ||
    hdrs['x-netlify-event'] === 'schedule';

  const hasCronSecret = process.env.CRON_SECRET
    ? safeCompare(hdrs['x-cron-secret'], process.env.CRON_SECRET)
    : false;

  if (!isScheduled && !hasCronSecret) {
    return json(403, { error: 'Forbidden' });
  }

  // 3. Configuration Check
  const {
    SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY,
    TWILIO_ACCOUNT_SID,
    TWILIO_AUTH_TOKEN,
    TWILIO_PHONE_NUMBER,
    MANAGER_PHONE = '+17174259285'
  } = process.env;

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) {
    console.error('[NO-SHOW] Missing critical configuration environment variables');
    return json(500, { error: 'Server misconfiguration' });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const twilioClient = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);

  console.log('[NO-SHOW] Heartbeat: Scanning for missed shifts…');

  try {
    // 4. Find candidates (Shifts starting 15m to 2h ago)
    const now = new Date();
    const fifteenAgo = new Date(now.getTime() - 15 * 60 * 1000).toISOString();
    const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString();

    const { data: shifts, error: shiftErr } = await supabase
      .from('scheduled_shifts')
      .select('id, user_id, start_time')
      .eq('status', 'scheduled')
      .lt('start_time', fifteenAgo)
      .gt('start_time', twoHoursAgo);

    if (shiftErr) throw shiftErr;
    if (!shifts || shifts.length === 0) return json(200, { alerted: 0 });

    let alertedCount = 0;

    for (const shift of shifts) {
      // 5. Bridge to staff_directory for email/name
      const { data: staffRow } = await supabase
        .from('staff_directory')
        .select('name, email')
        .eq('id', shift.user_id)
        .single();

      if (!staffRow) continue;

      // 6. Check time_logs for matching clock-in
      const windowStart = new Date(new Date(shift.start_time).getTime() - 30 * 60 * 1000).toISOString();
      const windowEnd = new Date(new Date(shift.start_time).getTime() + 15 * 60 * 1000).toISOString();

      const { data: clockIn } = await supabase
        .from('time_logs')
        .select('id')
        .ilike('employee_email', staffRow.email)
        .eq('action_type', 'in')
        .gte('clock_in', windowStart)
        .lte('clock_in', windowEnd)
        .limit(1);

      // 7. If no clock-in found, we have a No-Show
      if (!clockIn || clockIn.length === 0) {
        const startTime = new Date(shift.start_time);
        const latenessMinutes = Math.floor((now - startTime) / 1000 / 60);
        
        // Variance Logic
        const isMaldives = latenessMinutes >= 30;
        const severityEmoji = isMaldives ? '🚨🚨🚨' : '🚨';
        const severityHeader = isMaldives ? 'URGENT: CRITICAL NO-SHOW' : 'BREWHUB ALERT';

        const shiftLocal = startTime.toLocaleTimeString('en-US', {
          hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'America/New_York'
        });

        try {
          // 8. Fire the Tiered SMS
          await twilioClient.messages.create({
            body: `${severityEmoji} ${severityHeader}: ${staffRow.name} is ${latenessMinutes}m late for their ${shiftLocal} shift. No clock-in detected.`,
            from: TWILIO_PHONE_NUMBER,
            to: MANAGER_PHONE,
          });

          // 9. Update Database: Mark as no_show and Log to Audit Trail
          await supabase
            .from('scheduled_shifts')
            .update({ status: 'no_show' })
            .eq('id', shift.id);

          await supabase.from('schedule_audit_logs').insert([{
            changed_by_name: 'SYSTEM_WATCHDOG',
            action_type: 'NO_SHOW',
            employee_name: staffRow.name,
            details: `Auto-alert sent. Delay: ${latenessMinutes}m. Severity: ${isMaldives ? 'High' : 'Normal'}`
          }]);

          alertedCount++;
          console.log(`[NO-SHOW] Alert sent for ${staffRow.name} (${latenessMinutes}m late)`);
        } catch (smsErr) {
          console.error(`[NO-SHOW] SMS failed for ${staffRow.name}:`, smsErr.message);
        }
      }
    }

    return json(200, { alerted: alertedCount, total_processed: shifts.length });

  } catch (err) {
    console.error('[NO-SHOW] Unexpected Internal Error:', err.message);
    return json(500, { error: err.message });
  }
};