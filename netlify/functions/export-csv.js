// export-csv.js — One-click payroll CSV export for managers.
// Queries v_payroll_summary and streams a downloadable CSV.
// No terminal commands, no scripts — just tap the button.

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

const makeHeaders = (origin) => Object.assign({ 'Content-Type': 'text/csv; charset=utf-8', 'Cache-Control': 'no-cache', 'Vary': 'Origin' }, origin ? { 'Access-Control-Allow-Origin': origin } : {});

function neutralizeCsvCell(s) {
  if (s == null) return '';
  const str = String(s);
  if (/^[=+\-@\t]/.test(str)) return "'" + str; // prefix single-quote to avoid formula execution
  return str;
}

function normalizeNumber(val) {
  if (val == null) return 0;
  if (typeof val === 'bigint') return Number(val);
  if (typeof val === 'string') {
    const n = Number(val);
    return Number.isFinite(n) ? n : 0;
  }
  if (typeof val === 'number') return Number.isFinite(val) ? val : 0;
  return 0;
}

/** Escape a value for CSV (RFC 4180). */
function csvEscape(val) {
  if (val == null) return '';
  const s = String(val);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

exports.handler = async (event) => {
  const origin = validateOrigin(event.headers || {});
  const headers = makeHeaders(origin);

  if (MISSING_ENV) return { statusCode: 500, headers, body: JSON.stringify({ error: 'Server misconfiguration' }) };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: Object.assign({}, headers, { 'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-BrewHub-Action', 'Access-Control-Allow-Methods': 'GET, OPTIONS' }), body: '' };
  if (event.httpMethod !== 'GET') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  const auth = await authorize(event, { requireManager: true, requirePin: true });
  if (!auth.ok) return Object.assign({}, auth.response, { headers: Object.assign({}, auth.response.headers || {}, headers) });

  // Rate limit per-manager + IP
  const clientIp = event.headers['x-nf-client-connection-ip'] || event.headers['x-forwarded-for']?.split(',')[0]?.trim() || 'unknown';
  const managerEmail = (auth.user && (auth.user.email || auth.user?.user?.email)) ? String(auth.user.email || auth.user?.user?.email).toLowerCase() : 'unknown_manager';
  const rlKey = `exportcsv:${managerEmail}:${clientIp}`;
  const rl = staffBucket.consume(rlKey);
  if (!rl.allowed) {
    return { statusCode: 429, headers: Object.assign({}, headers, { 'Retry-After': String(Math.ceil(rl.retryAfterMs / 1000)) }), body: JSON.stringify({ error: 'Too many requests' }) };
  }

  try {
    const params = event.queryStringParameters || {};
    const startDate = params.start;
    const endDate = params.end;

    // Validate dates if provided
    if ((startDate && !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) || (endDate && !/^\d{4}-\d{2}-\d{2}$/.test(endDate))) {
      return { statusCode: 422, headers, body: JSON.stringify({ error: 'Dates must be in YYYY-MM-DD format' }) };
    }
    if (startDate && endDate) {
      const s = Date.parse(startDate + 'T00:00:00Z');
      const e = Date.parse(endDate + 'T23:59:59Z');
      if (s > e) return { statusCode: 422, headers, body: JSON.stringify({ error: 'start must be before or equal to end' }) };
    }

    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

    const EXPORT_ROW_LIMIT = Math.min(Math.max(Number(process.env.EXPORT_ROW_LIMIT || 5000), 1), 5000);

    let query = supabase
      .from('v_payroll_summary')
      .select('*')
      .order('pay_period_start', { ascending: false })
      .order('employee_email', { ascending: true })
      .limit(EXPORT_ROW_LIMIT);

    if (startDate) query = query.gte('pay_period_start', startDate);
    if (endDate) query = query.lte('pay_period_end', endDate);

    const { data, error } = await query;
    if (error) throw error;

    const rows = data || [];

    // Build CSV
    const header = [
      'Employee Name',
      'Email',
      'Hourly Rate',
      'Pay Period Start',
      'Pay Period End',
      'Clocked Minutes',
      'Adjustment Minutes',
      'Total Minutes',
      'Total Hours',
      'Gross Pay',
      'Active Shifts',
    ].join(',');

    const csvRows = rows.map((r) => {
      const empName = sanitizeInput(r.employee_name || 'Unknown').slice(0, 200);
      const email = sanitizeInput(r.employee_email || '').slice(0, 254);
      const hourly = normalizeNumber(r.hourly_rate);
      const clocked = normalizeNumber(r.clocked_minutes || 0);
      const adjust = normalizeNumber(r.adjustment_minutes || 0);
      const totalMin = normalizeNumber(r.total_minutes || 0);
      const totalHr = normalizeNumber(r.total_hours || 0);
      const gross = normalizeNumber(r.gross_pay || 0);
      const active = Number(r.active_shifts || 0) || 0;

      const cells = [
        csvEscape(neutralizeCsvCell(empName)),
        csvEscape(neutralizeCsvCell(email)),
        csvEscape(hourly.toFixed(2)),
        csvEscape(r.pay_period_start),
        csvEscape(r.pay_period_end),
        csvEscape(clocked.toFixed(2)),
        csvEscape(adjust.toFixed(2)),
        csvEscape(totalMin.toFixed(2)),
        csvEscape(totalHr.toFixed(2)),
        csvEscape(gross.toFixed(2)),
        csvEscape(active),
      ];

      return cells.join(',');
    });

    const csv = [header, ...csvRows].join('\r\n');

    const datePart = new Date().toISOString().slice(0, 10);
    const filenameSafe = (`brewhub-payroll-${datePart}.csv`).replace(/[^a-zA-Z0-9_.-]/g, '_');
    const filename = filenameSafe;

    return { statusCode: 200, headers: Object.assign({}, headers, { 'Content-Disposition': `attachment; filename="${filename}"` }), body: csv };
  } catch (err) {
    const res = sanitizedError(err, 'export-csv');
    res.headers = Object.assign({}, res.headers || {}, makeHeaders(validateOrigin(event.headers || {})));
    return res;
  }
};
