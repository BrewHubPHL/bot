// get-payroll.js — Server-side proxy for PayrollSection.
// Returns staff directory + time logs for a given date range.
// All payroll calculation (shifts, OT, gross pay) stays on the client.

const { createClient } = require('@supabase/supabase-js');
const { authorize, json, sanitizedError } = require('./_auth');
const { staffBucket } = require('./_token-bucket');
const { sanitizeInput } = require('./_sanitize');

const MISSING_ENV = !process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY;

const ALLOWED_ORIGINS = new Set([
  process.env.SITE_URL,
  'https://brewhubphl.com',
  'https://www.brewhubphl.com',
].filter(Boolean));

function validateOrigin(headers) {
  const origin = headers['origin'] || headers['Origin'] || '';
  if (ALLOWED_ORIGINS.has(origin)) return origin;
  return null;
}

const makeHeaders = (origin) => Object.assign({ 'Content-Type': 'application/json', 'Cache-Control': 'no-cache', 'Vary': 'Origin' }, origin ? { 'Access-Control-Allow-Origin': origin } : {});

const MAX_PAYROLL_DAYS = 90;

function maskEmail(email) {
  if (!email) return null;
  const s = String(email);
  try {
    if (s.indexOf('@') === -1) return '***';
    const [local, domain] = s.split('@');
    if (local.length <= 1) return `*@@${domain}`;
    const first = local[0];
    return `${first}***@${domain}`;
  } catch (_) {
    return '***';
  }
}

exports.handler = async (event) => {
  const origin = validateOrigin(event.headers || {});
  const headers = makeHeaders(origin);

  if (MISSING_ENV) return { statusCode: 500, headers, body: JSON.stringify({ error: 'Server misconfiguration' }) };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'GET') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  // Payroll is manager-only
  const auth = await authorize(event, { requireManager: true });
  if (!auth.ok) return Object.assign({}, auth.response, { headers: Object.assign({}, auth.response.headers || {}, headers) });

  // Rate limit per-manager + IP to prevent scraping
  const clientIp = event.headers['x-nf-client-connection-ip'] || event.headers['x-forwarded-for']?.split(',')[0]?.trim() || 'unknown';
  const managerEmail = (auth.user && (auth.user.email || auth.user?.user?.email)) ? String(auth.user.email || auth.user?.user?.email).toLowerCase() : 'unknown_manager';
  const rlKey = `getpayroll:${managerEmail}:${clientIp}`;
  const rl = staffBucket.consume(rlKey);
  if (!rl.allowed) {
    return { statusCode: 429, headers: Object.assign({}, headers, { 'Retry-After': String(Math.ceil(rl.retryAfterMs / 1000)) }), body: JSON.stringify({ error: 'Too many requests' }) };
  }

  try {
    const params = event.queryStringParameters || {};

    // ── view=summary: return aggregated data from v_payroll_summary ──
    if (params.view === 'summary') {
      const startDate = params.start;
      const endDate = params.end;

      // Build query — optionally filtered by pay period range
      const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

      let query = supabase
        .from('v_payroll_summary')
        .select('*')
        .order('pay_period_start', { ascending: false })
        .limit(500);

      if (startDate && /^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
        query = query.gte('pay_period_start', startDate);
      }
      if (endDate && /^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
        query = query.lte('pay_period_end', endDate);
      }

      const { data, error } = await query;
      if (error) throw error;

      // Also fetch open shifts for the "Open Shifts" card
      const { data: openShifts, error: openErr } = await supabase
        .from('time_logs')
        .select('id, employee_email, clock_in, created_at')
        .eq('action_type', 'in')
        .is('clock_out', null)
        .order('clock_in', { ascending: false })
        .limit(200);

      if (openErr) throw openErr;

      const maskedShifts = (openShifts || []).map(s => ({ id: s.id, employee_email: s.employee_email, clock_in: s.clock_in, created_at: s.created_at }));

      return { statusCode: 200, headers, body: JSON.stringify({ summary: data || [], openShifts: maskedShifts }) };
    }

    // ── Default: raw staff + logs for client-side calculation ──
    const startDate = params.start;
    const endDate = params.end;

    if (!startDate || !endDate) {
      return json(422, { error: 'start and end query parameters are required (YYYY-MM-DD)' });
    }

    // Validate date format
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
      return json(422, { error: 'Dates must be in YYYY-MM-DD format' });
    }

    // Use explicit UTC timestamps to avoid server-local timezone drift
    const startIso = new Date(startDate + 'T00:00:00Z').toISOString();
    const endIso = new Date(endDate + 'T23:59:59Z').toISOString();

    const startTs = Date.parse(startIso);
    const endTs = Date.parse(endIso);
    const days = Math.ceil((endTs - startTs) / (1000 * 60 * 60 * 24));
    if (days > MAX_PAYROLL_DAYS) {
      return { statusCode: 422, headers, body: JSON.stringify({ error: `date range too large; max ${MAX_PAYROLL_DAYS} days` }) };
    }

    if (startTs > endTs) return { statusCode: 422, headers, body: JSON.stringify({ error: 'start must be before or equal to end' }) };

    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

    const [staffRes, logsRes] = await Promise.all([
      supabase
        .from('staff_directory')
        .select('id, full_name, email, hourly_rate')
        .order('full_name')
        .limit(1000),
      supabase
        .from('time_logs')
        .select('id, employee_email, action_type, clock_in, clock_out, created_at')
        .gte('created_at', startIso)
        .lte('created_at', endIso)
        .limit(5000),
    ]);

    if (staffRes.error) throw staffRes.error;
    if (logsRes.error) throw logsRes.error;

    const staff = (staffRes.data || []).map(s => {
      const hourly = Number(s.hourly_rate);
      return {
        id: s.id,
        full_name: sanitizeInput(String(s.full_name || '')).slice(0, 200),
        email: String(s.email || '').toLowerCase(),
        hourly_rate: Number.isFinite(hourly) ? hourly : null,
      };
    });

    const logs = (logsRes.data || []).map(l => ({
      id: l.id,
      employee_email: String(l.employee_email || '').toLowerCase(),
      action_type: sanitizeInput(String(l.action_type || '')).slice(0, 50),
      clock_in: l.clock_in,
      clock_out: l.clock_out,
      created_at: l.created_at,
    }));

    return { statusCode: 200, headers, body: JSON.stringify({ staff, logs }) };
  } catch (err) {
    const res = sanitizedError(err, 'get-payroll');
    res.headers = Object.assign({}, res.headers || {}, headers);
    return res;
  }
};
