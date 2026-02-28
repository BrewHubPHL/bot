// get-manager-stats.js — Server-side proxy for StatsGrid.
// Returns today's revenue, order count, staff clocked in, and est. labor.
// Uses service_role to bypass RLS on orders / staff_directory / time_logs.

const { createClient } = require('@supabase/supabase-js');
const { authorize, sanitizedError } = require('./_auth');
const { sanitizeInput } = require('./_sanitize');
const { staffBucket } = require('./_token-bucket');

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

  const auth = await authorize(event, { requireManager: true, requirePin: true });
  if (!auth.ok) return Object.assign({}, auth.response, { headers: Object.assign({}, auth.response.headers || {}, headers) });

  // Rate limit per-manager + IP to prevent abusive scraping
  const clientIp = event.headers['x-nf-client-connection-ip'] || event.headers['x-forwarded-for']?.split(',')[0]?.trim() || 'unknown';
  const managerEmail = (auth.user && (auth.user.email || auth.user?.user?.email)) ? String(auth.user.email || auth.user?.user?.email).toLowerCase() : 'unknown_manager';
  const key = `manstats:${managerEmail}:${clientIp}`;
  const rl = staffBucket.consume(key);
  if (!rl.allowed) {
    return { statusCode: 429, headers: Object.assign({}, headers, { 'Retry-After': String(Math.ceil(rl.retryAfterMs / 1000)) }), body: JSON.stringify({ error: 'Too many requests' }) };
  }

  try {
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).toISOString();

    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();

    const [ordersRes, staffRes, logsRes, inventoryRes, noShowRes] = await Promise.all([
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
        .select('employee_email, clock_in, clock_out, action_type')
        // Only real clock-in shifts: open (clock_out IS NULL + action_type=in)
        // OR any shift that started today (for labor calculation).
        // Excludes adjustment rows which always have clock_out=NULL.
        .or(`and(clock_out.is.null,action_type.eq.in),clock_in.gte.${start}`),
      supabase
        .from('merch_products')
        .select('id, name, stock_quantity, min_threshold')
        .eq('is_active', true)
        .not('stock_quantity', 'is', null),
      supabase
        .from('scheduled_shifts')
        .select('id, user_id, start_time, staff_directory(name)')
        .eq('status', 'no_show')
        .gte('start_time', twentyFourHoursAgo),
    ]);

    const orderData = ordersRes.data || [];
    const staffData = staffRes.data || [];
    const logsData = logsRes.data || [];
    const lowStockItems = (inventoryRes.data || [])
      .filter(i => i.stock_quantity <= (i.min_threshold ?? 10))
      .map(i => ({ id: i.id, name: i.name, stock_quantity: i.stock_quantity, min_threshold: i.min_threshold ?? 10 }));

    // No-show shifts from the last 24 hours
    const noShowData = noShowRes.data || [];
    const noShows = noShowData.map(s => ({
      shiftId: s.id,
      userId: s.user_id,
      startTime: s.start_time,
      employeeName: s.staff_directory?.name || 'Unknown',
    }));

    const orderCount = orderData.length;
    const totalRevenue = orderData.reduce((sum, o) => sum + (o.total_amount_cents || 0), 0) / 100;

    // Build rate + name lookups
    const rateMap = {};
    const nameMap = {};
    for (const s of staffData) {
      const email = String(s.email || '').toLowerCase();
      let rate = Number(s.hourly_rate);
      if (!Number.isFinite(rate) || rate < 0) rate = 0;
      if (rate > 200) rate = 200;
      rateMap[email] = rate;
      nameMap[email] = sanitizeInput(s.full_name || '').slice(0, 60);
    }

    // Compute actual labor cost: hours_worked × hourly_rate for each shift
    // (only the today-portion counts, so cross-midnight shifts are handled)
    const nowMs = now.getTime();
    const startMs = new Date(start).getTime();
    const activeEmails = new Set();
    const activeShiftsMap = new Map(); // email → clock_in ISO (most recent open shift)
    let totalLabor = 0;

    for (const log of logsData) {
      // Skip non-clock rows (e.g. payroll adjustments) — they have
      // clock_out=NULL but are NOT active shifts.
      if (log.action_type && log.action_type !== 'in' && log.action_type !== 'out') continue;

      const email = String(log.employee_email || '').toLowerCase();
      const rate = rateMap[email] || 0;
      const clockInMs = log.clock_in ? new Date(log.clock_in).getTime() : startMs;
      const clockOutMs = log.clock_out ? new Date(log.clock_out).getTime() : nowMs;
      // Only count the portion that falls within today
      const shiftStart = Math.max(clockInMs, startMs);
      const shiftEnd = Math.min(clockOutMs, nowMs);
      if (shiftEnd > shiftStart) {
        totalLabor += ((shiftEnd - shiftStart) / 3_600_000) * rate;
      }
      if (!log.clock_out && log.action_type === 'in') {
        activeEmails.add(email);
        // Keep most recent open clock_in per person
        const prev = activeShiftsMap.get(email);
        if (!prev || clockInMs > new Date(prev).getTime()) {
          activeShiftsMap.set(email, log.clock_in || now.toISOString());
        }
      }
    }

    const activeStaff = activeEmails.size;

    // Active shifts list — used by the "On the Clock" card on the manager dashboard
    const activeShifts = Array.from(activeShiftsMap.entries()).map(([email, clock_in]) => ({
      name: nameMap[email] || email,
      email,
      clock_in,
    }));

    // Sanitise staff names for any downstream display (shorten to 60 chars)
    const sanitizedStaff = staffData.map(s => ({
      email: String(s.email || '').toLowerCase(),
      name: nameMap[String(s.email || '').toLowerCase()] || '',
      role: String(s.role || '').slice(0, 30),
    }));

    return { statusCode: 200, headers, body: JSON.stringify({ revenue: totalRevenue, orders: orderCount, staffCount: activeStaff, labor: totalLabor, staff: sanitizedStaff, activeShifts, lowStockItems, noShows }) };
  } catch (err) {
    const res = sanitizedError(err, 'get-manager-stats');
    res.headers = Object.assign({}, res.headers || {}, headers);
    return res;
  }
};
