/**
 * NO-SHOW ALERT (Scheduled Cron — every 5 minutes)
 * Path: netlify/functions/no-show-alert.js
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
  const hdrs = {};
  for (const k of Object.keys(event.headers || {})) {
    hdrs[k.toLowerCase()] = event.headers[k];
  }

  // Security Gate
  const isScheduled = context?.clientContext?.custom?.scheduled === true || hdrs['x-netlify-event'] === 'schedule';
  const hasCronSecret = process.env.CRON_SECRET ? safeCompare(hdrs['x-cron-secret'], process.env.CRON_SECRET) : false;

  if (!isScheduled && !hasCronSecret) {
    console.error('[NO-SHOW] Access Denied: Invalid Secret or Unauthorized Request');
    return json(403, { error: 'Forbidden' });
  }

  const {
    SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY,
    TWILIO_ACCOUNT_SID,
    TWILIO_AUTH_TOKEN,
    TWILIO_PHONE_NUMBER,
    MANAGER_PHONE = '+17174259285'
  } = process.env;

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return json(500, { error: 'Missing Supabase Config' });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const twilioClient = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);

  console.log('[NO-SHOW] Heartbeat: Starting Check...');

  try {
    // 1. Define Search Window (Started between 15m and 120m ago)
    const now = new Date();
    const fifteenAgo = new Date(now.getTime() - 15 * 60 * 1000).toISOString();
    const twoHoursAgo = new Date(now.getTime() - 120 * 60 * 1000).toISOString();

    console.log(`[NO-SHOW] Step 1: Querying shifts starting between ${twoHoursAgo} and ${fifteenAgo}`);

    const { data: shifts, error: shiftErr } = await supabase
      .from('scheduled_shifts')
      .select('id, user_id, start_time')
      .eq('status', 'scheduled')
      .lt('start_time', fifteenAgo)
      .gt('start_time', twoHoursAgo);

    if (shiftErr) throw new Error(`Shift Query Failed: ${shiftErr.message}`);

    console.log(`[NO-SHOW] Step 2: Found ${shifts?.length || 0} potential no-shows.`);

    if (!shifts || shifts.length === 0) {
      return json(200, { alerted: 0, status: 'Clear' });
    }

    let alertedCount = 0;

    for (const shift of shifts) {
      console.log(`[NO-SHOW] Step 3: Checking staff directory for user_id: ${shift.user_id}`);
      
      const { data: staffRow, error: staffErr } = await supabase
        .from('staff_directory')
        .select('name, email')
        .eq('id', shift.user_id)
        .single();

      if (staffErr || !staffRow) {
        console.error(`[NO-SHOW] Skipping shift ${shift.id}: Staff record not found.`);
        continue;
      }

      console.log(`[NO-SHOW] Step 4: Checking time_logs for ${staffRow.email}`);

      // Window for clock-in (30m before shift start to 15m after)
      const windowStart = new Date(new Date(shift.start_time).getTime() - 30 * 60 * 1000).toISOString();
      const windowEnd = new Date(new Date(shift.start_time).getTime() + 15 * 60 * 1000).toISOString();

      const { data: clockIn, error: logErr } = await supabase
        .from('time_logs')
        .select('id')
        .ilike('employee_email', staffRow.email)
        .eq('action_type', 'in')
        .gte('clock_in', windowStart)
        .lte('clock_in', windowEnd)
        .limit(1);

      if (logErr) {
        console.error(`[NO-SHOW] Log check error for ${staffRow.name}:`, logErr.message);
        continue;
      }

      // 2. If NO clock-in found, execute alert
      if (!clockIn || clockIn.length === 0) {
        const startTime = new Date(shift.start_time);
        const latenessMinutes = Math.floor((now - startTime) / 1000 / 60);
        
        const isMaldives = latenessMinutes >= 30;
        const severityEmoji = isMaldives ? '🚨🚨🚨' : '🚨';
        const severityHeader = isMaldives ? 'URGENT: CRITICAL NO-SHOW' : 'BREWHUB ALERT';

        const shiftLocal = startTime.toLocaleTimeString('en-US', {
          hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'America/New_York'
        });

        console.log(`[NO-SHOW] Step 5: Sending SMS for ${staffRow.name}`);

        try {
          await twilioClient.messages.create({
            body: `${severityEmoji} ${severityHeader}: ${staffRow.name} is ${latenessMinutes}m late for their ${shiftLocal} shift.`,
            from: TWILIO_PHONE_NUMBER,
            to: MANAGER_PHONE,
          });

          console.log(`[NO-SHOW] Step 6: Updating shift status to no_show`);
          await supabase.from('scheduled_shifts').update({ status: 'no_show' }).eq('id', shift.id);

          console.log(`[NO-SHOW] Step 7: Logging to audit trail`);
          // We wrap this in a try/catch in case the table doesn't exist yet
          try {
            await supabase.from('schedule_audit_logs').insert([{
              changed_by_name: 'SYSTEM_WATCHDOG',
              action_type: 'NO_SHOW',
              employee_name: staffRow.name,
              details: `Alert sent. Delay: ${latenessMinutes}m.`
            }]);
          } catch (auditErr) {
            console.error('[NO-SHOW] Audit table missing or error:', auditErr.message);
          }

          alertedCount++;
        } catch (smsErr) {
          console.error(`[NO-SHOW] SMS Failed: ${smsErr.message}`);
        }
      } else {
        console.log(`[NO-SHOW] Employee ${staffRow.name} is clocked in. No alert needed.`);
      }
    }

    return json(200, { alerted: alertedCount, shifts_checked: shifts.length });

  } catch (err) {
    console.error('[NO-SHOW] CRASH:', err.message);
    return json(500, { error: err.message });
  }
};