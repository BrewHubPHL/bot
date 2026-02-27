/**
 * NO-SHOW ALERT — Dual-mode Netlify Function
 * Path: netlify/functions/no-show-alert.js
 *
 * MODE A  "Relay"  — called by the Supabase check_for_noshows() pg_cron
 *   function via HTTP POST with a JSON body:
 *     { employeeName, shiftTime, latenessMinutes, shiftId, managerPhone }
 *   Responsibility: send the SMS (audit log is handled by the DB trigger).
 *   The SQL function already marks the shift as no_show.
 *
 * MODE B  "Full Detection"  — fired by the Netlify scheduler (every 5 min)
 *   as a safety-net fallback. Queries Supabase for missed shifts, sends SMS,
 *   updates status, and writes audit -- the original behaviour.
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

function buildSmsBody({ employeeName, shiftTime, latenessMinutes }) {
  const mins = Number(latenessMinutes) || 0;
  const isCritical = mins >= 30;
  const emoji = isCritical ? '🚨🚨🚨' : '🚨';
  const header = isCritical ? 'URGENT: CRITICAL NO-SHOW' : 'BREWHUB ALERT';
  const lateClause = mins > 0 ? ` is ${mins}m late for their` : ' has not clocked in for their';
  return `${emoji} ${header}: ${employeeName}${lateClause} ${shiftTime} shift.`;
}

// ── Handler ──────────────────────────────────────────────────────────────────

exports.handler = async (event) => {
  const hdrs = {};
  for (const k of Object.keys(event.headers || {})) {
    hdrs[k.toLowerCase()] = event.headers[k];
  }

  // ── Parse body (may be empty for scheduled triggers) ──────────────────
  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch { /* no-op */ }

  // ── Security Gate ─────────────────────────────────────────────────────
  // Accept: Netlify scheduled event header  OR  x-cron-secret header/body
  const isScheduled = hdrs['x-netlify-event'] === 'schedule';
  const secret = process.env.CRON_SECRET;
  const hasCronSecret = secret
    ? (safeCompare(hdrs['x-cron-secret'], secret) || safeCompare(body.cronSecret, secret))
    : false;

  if (!isScheduled && !hasCronSecret) {
    console.error('[NO-SHOW] Access Denied: Invalid Secret or Unauthorized Request');
    return json(403, { error: 'Forbidden' });
  }

  // ── Environment ───────────────────────────────────────────────────────
  const {
    SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY,
    TWILIO_ACCOUNT_SID,
    TWILIO_AUTH_TOKEN,
    TWILIO_PHONE_NUMBER,
    MANAGER_PHONE = '+17174259285',
  } = process.env;

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return json(500, { error: 'Missing Supabase Config' });
  }
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_PHONE_NUMBER) {
    return json(500, { error: 'Missing Twilio Config' });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const twilioClient = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);

  // =====================================================================
  //  MODE A — Relay (called from SQL check_for_noshows via http_post)
  // =====================================================================
  if (body.employeeName && body.shiftTime) {
    console.log(`[NO-SHOW][RELAY] Received alert for ${body.employeeName} — ${body.shiftTime}`);

    try {
      const smsBody = buildSmsBody(body);
      const phone = body.managerPhone || MANAGER_PHONE;

      await twilioClient.messages.create({
        body: smsBody,
        from: TWILIO_PHONE_NUMBER,
        to: phone,
      });
      console.log(`[NO-SHOW][RELAY] SMS sent to ${phone}`);

      // Note: shift_audit_log is NOT inserted manually — the DB trigger
      // `log_shift_change` on scheduled_shifts handles it automatically.
      // The SQL check_for_noshows() function already marks the shift as no_show.

      return json(200, { alerted: 1, mode: 'relay', employee: body.employeeName });
    } catch (err) {
      console.error('[NO-SHOW][RELAY] CRASH:', err.message);
      return json(500, { error: err.message });
    }
  }

  // =====================================================================
  //  MODE B — Full Detection (Netlify scheduled fallback)
  // =====================================================================
  console.log('[NO-SHOW][DETECT] Heartbeat: Starting full detection check...');

  try {
    const now = new Date();
    const fifteenAgo = new Date(now.getTime() - 15 * 60 * 1000).toISOString();
    const twoHoursAgo = new Date(now.getTime() - 120 * 60 * 1000).toISOString();

    console.log(`[NO-SHOW][DETECT] Querying shifts starting between ${twoHoursAgo} and ${fifteenAgo}`);

    const { data: shifts, error: shiftErr } = await supabase
      .from('scheduled_shifts')
      .select('id, user_id, start_time')
      .eq('status', 'scheduled')
      .lt('start_time', fifteenAgo)
      .gt('start_time', twoHoursAgo);

    if (shiftErr) throw new Error(`Shift Query Failed: ${shiftErr.message}`);

    console.log(`[NO-SHOW][DETECT] Found ${shifts?.length || 0} potential no-shows.`);

    if (!shifts || shifts.length === 0) {
      return json(200, { alerted: 0, mode: 'detect', status: 'Clear' });
    }

    let alertedCount = 0;

    for (const shift of shifts) {
      const { data: staffRow, error: staffErr } = await supabase
        .from('staff_directory')
        .select('name, email')
        .eq('id', shift.user_id)
        .single();

      if (staffErr || !staffRow) {
        console.error(`[NO-SHOW][DETECT] Skipping shift ${shift.id}: Staff record not found.`);
        continue;
      }

      // Window for clock-in (30m before shift start → 15m after)
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
        console.error(`[NO-SHOW][DETECT] Log check error for ${staffRow.name}:`, logErr.message);
        continue;
      }

      if (!clockIn || clockIn.length === 0) {
        const startTime = new Date(shift.start_time);
        const latenessMinutes = Math.floor((now - startTime) / 1000 / 60);

        const shiftLocal = startTime.toLocaleTimeString('en-US', {
          hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'America/New_York',
        });

        const smsBody = buildSmsBody({
          employeeName: staffRow.name,
          shiftTime: shiftLocal,
          latenessMinutes,
        });

        console.log(`[NO-SHOW][DETECT] Sending SMS for ${staffRow.name}`);

        try {
          await twilioClient.messages.create({
            body: smsBody,
            from: TWILIO_PHONE_NUMBER,
            to: MANAGER_PHONE,
          });

          const { error: statusErr } = await supabase.from('scheduled_shifts').update({ status: 'no_show' }).eq('id', shift.id);
          if (statusErr) {
            console.error(`[NO-SHOW][DETECT] Failed to update shift ${shift.id} status: ${statusErr.message}`);
          }

          // Note: shift_audit_log is NOT inserted manually — the DB trigger
          // `log_shift_change` on scheduled_shifts handles it automatically.

          alertedCount++;
        } catch (smsErr) {
          console.error(`[NO-SHOW][DETECT] SMS Failed: ${smsErr.message}`);
        }
      } else {
        console.log(`[NO-SHOW][DETECT] ${staffRow.name} is clocked in. No alert needed.`);
      }
    }

    return json(200, { alerted: alertedCount, mode: 'detect', shifts_checked: shifts.length });

  } catch (err) {
    console.error('[NO-SHOW][DETECT] CRASH:', err.message);
    return json(500, { error: err.message });
  }
};