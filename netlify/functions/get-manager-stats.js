// get-manager-stats.js — Server-side proxy for StatsGrid.
// Returns today's revenue, order count, staff clocked in, and est. labor.
// Uses service_role to bypass RLS on orders / staff_directory / time_logs.

const { createClient } = require('@supabase/supabase-js');
const { authorize, sanitizedError } = require('./_auth');
const { sanitizeInput } = require('./_sanitize');
const { formBucket } = require('./_token-bucket');

const MISSING_ENV = !process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY;

const ALLOWED_ORIGINS = new Set([
  process.env.SITE_URL,
  'https://brewhubphl.com',
  'https://www.brewhubphl.com',
].filter(Boolean));

function validateOrigin(headers) {
  const origin = headers['origin'] || headers['Origin'] || '';
  if (ALLOWED_ORIGINS.has(origin)) return origin;
  if (origin === '' && process.env.SITE_URL) return process.env.SITE_URL;
  return null;
}

const makeHeaders = (origin) => Object.assign({
  'Content-Type': 'application/json',
  'Cache-Control': 'no-cache',
  'Vary': 'Origin',
}, origin ? { 'Access-Control-Allow-Origin': origin } : {});

exports.handler = async (event) => {
  if (MISSING_ENV) return { statusCode: 500, headers: makeHeaders(null), body: JSON.stringify({ error: 'Server misconfiguration' }) };

  const origin = validateOrigin(event.headers || {});
  const headers = makeHeaders(origin);

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'GET') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  const auth = await authorize(event, { requireManager: true });
  if (!auth.ok) return Object.assign({}, auth.response, { headers: Object.assign({}, auth.response.headers || {}, headers) });

  // Rate limit per-manager + IP to prevent abusive scraping
  const clientIp = event.headers['x-nf-client-connection-ip'] || event.headers['x-forwarded-for']?.split(',')[0]?.trim() || 'unknown';
  const managerEmail = (auth.user && (auth.user.email || auth.user?.user?.email)) ? String(auth.user.email || auth.user?.user?.email).toLowerCase() : 'unknown_manager';
  const key = `manstats:${managerEmail}:${clientIp}`;
  const rl = formBucket.consume(key);
  if (!rl.allowed) {
    return { statusCode: 429, headers: Object.assign({}, headers, { 'Retry-After': String(Math.ceil(rl.retryAfterMs / 1000)) }), body: JSON.stringify({ error: 'Too many requests' }) };
  }

  try {
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).toISOString();

    const [ordersRes, staffRes, logsRes] = await Promise.all([
      supabase
        .from('orders')
        .select('total_amount_cents, created_at')
        .gte('created_at', start)
        .lt('created_at', end),
      supabase
        .from('staff_directory')
        .select('email, full_name, hourly_rate, role'),
      supabase
        .from('time_logs')
        .select('employee_email, action_type, clock_in, clock_out, created_at')
        .gte('created_at', start)
        .lt('created_at', end),
    ]);

    const orderData = ordersRes.data || [];
    const staffData = staffRes.data || [];
    const logsData = logsRes.data || [];

    const orderCount = orderData.length;
    const totalRevenue = orderData.reduce((sum, o) => sum + (o.total_amount_cents || 0), 0) / 100;

    // Staff currently clocked in: last log today is 'in' with no clock_out
    let activeStaff = 0;
    let totalLabor = 0;
    for (const staff of staffData) {
      const staffEmail = String(staff.email || '').toLowerCase();
      const logs = logsData.filter(l => String(l.employee_email || '').toLowerCase() === staffEmail);
      const lastLog = logs[logs.length - 1];
      if (lastLog && (lastLog.action_type || '').toLowerCase() === 'in' && !lastLog.clock_out) {
        activeStaff++;
        // Validate hourly_rate: coerce, bound and ignore absurd values
        let rate = Number(staff.hourly_rate);
        if (!Number.isFinite(rate) || rate < 0) rate = 0;
        if (rate > 200) rate = 200; // cap unrealistic values
        totalLabor += rate;
      }
    }

    // Sanitise staff names for any downstream display (shorten to 60 chars)
    const sanitizedStaff = staffData.map(s => ({
      email: String(s.email || '').toLowerCase(),
      name: sanitizeInput(s.full_name || '').slice(0, 60),
      role: String(s.role || '').slice(0, 30),
    }));

    return { statusCode: 200, headers, body: JSON.stringify({ revenue: totalRevenue, orders: orderCount, staffCount: activeStaff, labor: totalLabor, staff: sanitizedStaff }) };
  } catch (err) {
    const res = sanitizedError(err, 'get-manager-stats');
    res.headers = Object.assign({}, res.headers || {}, headers);
    return res;
  }
};
