const { createClient } = require('@supabase/supabase-js');
const { publicBucket } = require('./_token-bucket');

/* ------------------------------------------------------------------ */
/* Constants                                                            */
/* ------------------------------------------------------------------ */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MISSING_ENV = !process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY;

/* ------------------------------------------------------------------ */
/* Helpers                                                              */
/* ------------------------------------------------------------------ */

/**
 * Format a date string to strict iCal spec: YYYYMMDDTHHmmssZ
 * Returns a safe fallback for null/undefined/invalid inputs.
 */
function formatIcsDate(dateStr) {
  if (!dateStr) return new Date().toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return new Date().toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
  return d.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
}

/**
 * Sanitise a free-text value for iCal field injection.
 * Strips newlines (\r, \n), backslashes, and semicolons that could
 * inject rogue VEVENT properties per RFC 5545.
 */
function sanitiseIcsText(value) {
  if (!value || typeof value !== 'string') return '';
  return value.replace(/[\r\n\\;]/g, ' ').trim().slice(0, 200);
}

/* ------------------------------------------------------------------ */
/* Handler                                                              */
/* ------------------------------------------------------------------ */
exports.handler = async (event) => {
  /* ── Pre-flight ─────────────────────────────────────────── */
  if (MISSING_ENV) {
    return { statusCode: 500, body: 'Server configuration error.' };
  }
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, body: '' };
  }
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: 'Method not allowed.' };
  }

  /* ── Rate limit (per IP) ────────────────────────────────── */
  const clientIp = event.headers?.['x-nf-client-connection-ip']
    || event.headers?.['x-forwarded-for']?.split(',')[0]?.trim()
    || 'unknown';
  const rl = publicBucket.consume(`cal:${clientIp}`);
  if (!rl.allowed) {
    return {
      statusCode: 429,
      headers: { 'Retry-After': String(Math.ceil(rl.retryAfterMs / 1000)) },
      body: 'Too many requests. Please try again later.',
    };
  }

  /* ── Validate user ID ───────────────────────────────────── */
  const userId = event.queryStringParameters?.user;

  if (!userId || !UUID_RE.test(userId)) {
    return { statusCode: 400, body: 'Missing or invalid user ID.' };
  }

  /* ── Verify the UUID belongs to a real user ─────────────── */
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

  const { data: userRow, error: userErr } = await supabase
    .from('staff_directory')
    .select('email')
    .eq('id', userId)
    .maybeSingle();

  if (userErr || !userRow) {
    // Return generic 404 — do not reveal whether the UUID exists
    return { statusCode: 404, body: 'Calendar not found.' };
  }

  /* ── Fetch shifts (past 7 days + future) ────────────────── */
  const lookback = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const { data: shifts, error } = await supabase
    .from('scheduled_shifts')
    .select('id, start_time, end_time, role_id, location_id, created_at')
    .eq('user_id', userId)
    .gte('start_time', lookback)
    .order('start_time', { ascending: true });

  if (error) {
    console.error('calendar.js: Supabase query failed');
    return { statusCode: 500, body: 'Unable to load schedule right now.' };
  }

  /* ── Build iCal ─────────────────────────────────────────── */
  const ics = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//BrewHubPHL//Employee Schedule//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:BrewHubPHL Shifts',
  ];

  if (shifts && shifts.length > 0) {
    for (const shift of shifts) {
      ics.push(
        'BEGIN:VEVENT',
        `UID:${shift.id}@brewhubphl.com`,
        `DTSTAMP:${formatIcsDate(shift.created_at)}`,
        `DTSTART:${formatIcsDate(shift.start_time)}`,
        `DTEND:${formatIcsDate(shift.end_time)}`,
        `SUMMARY:☕ BrewHubPHL - ${sanitiseIcsText(shift.role_id) || 'Shift'}`,
        `LOCATION:${sanitiseIcsText(shift.location_id) || 'BrewHub Main'}`,
        'END:VEVENT',
      );
    }
  }

  ics.push('END:VCALENDAR');

  /* ── Response ───────────────────────────────────────────── */
  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': 'attachment; filename="brewhub_schedule.ics"',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
    },
    body: ics.join('\r\n'),
  };
};