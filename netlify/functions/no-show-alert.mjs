/**
 * NO-SHOW ALERT — Dual-mode Netlify Function (v2 ESM)
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

import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import twilio from 'twilio';

function withSourceComment(query, tag) {
  if (typeof query?.comment === 'function') {
    return query.comment(`source: ${tag}`);
  }
  return query;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function safeCompare(a, b) {
  if (!a || !b) return false;
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function jsonResponse(code, data) {
  return new Response(JSON.stringify(data), {
    status: code,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

function buildSmsBody({ employeeName, shiftTime, latenessMinutes }) {
  const mins = Number(latenessMinutes) || 0;
  const isCritical = mins >= 30;
  const emoji = isCritical ? '🚨🚨🚨' : '🚨';
  const header = isCritical ? 'URGENT: CRITICAL NO-SHOW' : 'BREWHUB ALERT';
  const lateClause = mins > 0 ? ` is ${mins}m late for their` : ' has not clocked in for their';
  return `${emoji} ${header}: ${employeeName}${lateClause} ${shiftTime} shift.`;
}

// ── Handler ──────────────────────────────────────────────────────────────────

export default async function handler(req, context) {
  // Normalize headers
  const hdrs = {};
  for (const [k, v] of req.headers.entries()) {
    hdrs[k.toLowerCase()] = v;
  }

  // ── Parse body (may be empty for scheduled triggers) ──────────────────
  let body = {};
  try { body = await req.json(); } catch { /* no-op */ }

  // ── Security Gate ─────────────────────────────────────────────────────
  // Accept: Netlify scheduled event (context)  OR  x-cron-secret header/body
  const secret = process.env.CRON_SECRET;
  const hasCronSecret = secret
    ? (safeCompare(hdrs['x-cron-secret'], secret) || safeCompare(body.cronSecret, secret))
    : false;

  if (!hasCronSecret) {
    console.error('[NO-SHOW] Access Denied: Invalid Secret or Unauthorized Request');
    return jsonResponse(403, { error: 'Forbidden' });
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
    return jsonResponse(500, { error: 'Missing Supabase Config' });
  }
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_PHONE_NUMBER) {
    return jsonResponse(500, { error: 'Missing Twilio Config' });
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

      return jsonResponse(200, { alerted: 1, mode: 'relay', employee: body.employeeName });
    } catch (err) {
      console.error('[NO-SHOW][RELAY] CRASH:', err.message);
      return jsonResponse(500, { error: err.message });
    }
  }

  // =====================================================================
  //  MODE B — Full Detection (Netlify scheduled fallback)
  // =====================================================================
  console.log('[NO-SHOW][DETECT] Heartbeat: Starting full detection check...');

  try {
    const nowMs = Date.now();
    const now = new Date(nowMs);
    const nowISO = now.toISOString();
    const fifteenAgoISO = new Date(nowMs - 15 * 60_000).toISOString();
    const twoHoursAgoISO = new Date(nowMs - 120 * 60_000).toISOString();

    console.log(`[NO-SHOW][DETECT] Current UTC time : ${nowISO}`);
    console.log(`[NO-SHOW][DETECT] Window           : ${twoHoursAgoISO}  →  ${fifteenAgoISO}`);

    const ALERTABLE_STATUSES = ['scheduled', 'confirmed'];

    const { data: allShifts, error: shiftErr } = await withSourceComment(
      supabase
        .from('scheduled_shifts')
        .select('id, user_id, start_time, status')
        .lt('start_time', fifteenAgoISO)
        .gt('start_time', twoHoursAgoISO),
      'cron-no-show-check'
    );

    if (shiftErr) throw new Error(`Shift Query Failed: ${shiftErr.message}`);

    console.log(`[NO-SHOW][DETECT] Total shifts in window: ${allShifts?.length || 0}`);

    if (!allShifts || allShifts.length === 0) {
      console.log('[NO-SHOW][DETECT] No shifts found in the 2h→15m window. All clear.');
      return jsonResponse(200, { alerted: 0, mode: 'detect', status: 'Clear' });
    }

    const shifts = [];
    for (const s of allShifts) {
      if (ALERTABLE_STATUSES.includes(s.status)) {
        shifts.push(s);
      } else {
        const ageMin = Math.round((nowMs - new Date(s.start_time).getTime()) / 60_000);
        console.log(
          `[NO-SHOW][DETECT] Shift ${s.id} SKIPPED: status="${s.status}" ` +
          `(not in [${ALERTABLE_STATUSES}]), start_time was ${ageMin}m ago`
        );
      }
    }

    console.log(`[NO-SHOW][DETECT] Alertable shifts after status filter: ${shifts.length}`);

    if (shifts.length === 0) {
      return jsonResponse(200, { alerted: 0, mode: 'detect', status: 'Clear — all shifts filtered out' });
    }

    // ── Batch-fetch staff info ──────────────────────────────────
    const userIds = [...new Set(shifts.map(s => s.user_id).filter(Boolean))];
    const { data: staffRows, error: staffErr } = userIds.length > 0
      ? await supabase
          .from('v_staff_status')
          .select('id, name, email')
          .in('id', userIds)
      : { data: [], error: null };

    if (staffErr) {
      console.error('[NO-SHOW][DETECT] Staff lookup error (non-fatal):', staffErr.message);
    }

    const staffById = new Map();
    for (const s of (staffRows || [])) {
      staffById.set(s.id, s);
    }

    for (const shift of shifts) {
      shift._staff = staffById.get(shift.user_id) || null;
    }

    // ── Batch-fetch ALL relevant time_logs ──────────────────────
    const shiftStarts = shifts.map(s => new Date(s.start_time).getTime());
    const broadWindowStart = new Date(Math.min(...shiftStarts) - 30 * 60_000).toISOString();
    const broadWindowEnd   = new Date(Math.max(...shiftStarts) + 15 * 60_000).toISOString();

    const staffEmails = shifts
      .map(s => s._staff?.email)
      .filter(Boolean)
      .map(e => e.toLowerCase());
    const uniqueEmails = [...new Set(staffEmails)];

    const { data: allClockIns, error: logErr } = uniqueEmails.length > 0
      ? await supabase
          .from('time_logs')
          .select('id, employee_email, clock_in')
          .in('employee_email', uniqueEmails)
          .eq('action_type', 'in')
          .gte('clock_in', broadWindowStart)
          .lte('clock_in', broadWindowEnd)
      : { data: [], error: null };

    if (logErr) {
      console.error('[NO-SHOW][DETECT] Batch time_logs query error (non-fatal):', logErr.message);
    }

    const clockInsByEmail = new Map();
    for (const log of (allClockIns || [])) {
      const key = (log.employee_email || '').toLowerCase();
      if (!clockInsByEmail.has(key)) clockInsByEmail.set(key, []);
      clockInsByEmail.get(key).push(log);
    }

    let alertedCount = 0;
    let skippedCount = 0;

    for (const shift of shifts) {
      const staff = shift._staff;
      if (!staff || !staff.name || !staff.email) {
        console.log(
          `[NO-SHOW][DETECT] Shift ${shift.id} SKIPPED: ` +
          `No staff record found for user_id="${shift.user_id}"`
        );
        skippedCount++;
        continue;
      }

      const shiftStartMs = new Date(shift.start_time).getTime();
      const latenessMin = Math.round((nowMs - shiftStartMs) / 60_000);

      const windowStartMs = shiftStartMs - 30 * 60_000;
      const windowEndMs   = shiftStartMs + 15 * 60_000;

      const staffLogs = clockInsByEmail.get(staff.email.toLowerCase()) || [];
      const matchingLog = staffLogs.find(log => {
        const t = new Date(log.clock_in).getTime();
        return t >= windowStartMs && t <= windowEndMs;
      });

      if (matchingLog) {
        console.log(
          `[NO-SHOW][DETECT] Shift ${shift.id} SKIPPED: ` +
          `${staff.name} clocked in at ${matchingLog.clock_in} ` +
          `(within window for ${shift.start_time} shift). No alert needed.`
        );
        skippedCount++;
        continue;
      }

      // ── This is a genuine no-show — send alert ────────────────
      const startTime = new Date(shift.start_time);
      const shiftLocal = startTime.toLocaleTimeString('en-US', {
        hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'America/New_York',
      });

      const smsBody = buildSmsBody({
        employeeName: staff.name,
        shiftTime: shiftLocal,
        latenessMinutes: latenessMin,
      });

      console.log(
        `[NO-SHOW][DETECT] 🚨 ALERTING: ${staff.name} | Shift ${shift.id} | ` +
        `status="${shift.status}" | start=${shift.start_time} | ${latenessMin}m late | ` +
        `0 matching clock-ins from ${staffLogs.length} total logs`
      );

      try {
        await twilioClient.messages.create({
          body: smsBody,
          from: TWILIO_PHONE_NUMBER,
          to: MANAGER_PHONE,
        });

        const { error: statusErr } = await supabase
          .from('scheduled_shifts')
          .update({ status: 'no_show' })
          .eq('id', shift.id);
        if (statusErr) {
          console.error(`[NO-SHOW][DETECT] Failed to update shift ${shift.id} status: ${statusErr.message}`);
        }

        alertedCount++;
      } catch (smsErr) {
        console.error(`[NO-SHOW][DETECT] SMS Failed for shift ${shift.id}: ${smsErr.message}`);
      }
    }

    console.log(
      `[NO-SHOW][DETECT] Summary: ${alertedCount} alerted, ${skippedCount} skipped, ` +
      `${shifts.length} checked (from ${allShifts.length} total in window)`
    );

    return jsonResponse(200, {
      alerted: alertedCount,
      skipped: skippedCount,
      mode: 'detect',
      shifts_checked: shifts.length,
      shifts_in_window: allShifts.length,
    });

  } catch (err) {
    console.error('[NO-SHOW][DETECT] CRASH:', err.message);
    return jsonResponse(500, { error: err.message });
  }
}

export const config = {
  schedule: "*/5 * * * *"
};
