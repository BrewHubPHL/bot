const { createClient } = require('@supabase/supabase-js');
const { authorize, json, sanitizedError } = require('./_auth');
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
  return null;
}

const makeHeaders = (origin) => Object.assign({ 'Content-Type': 'application/json', 'Cache-Control': 'no-cache', 'Vary': 'Origin' }, origin ? { 'Access-Control-Allow-Origin': origin } : {});

function normalizeCents(val) {
  if (val == null) return 0;
  if (typeof val === 'bigint') return Number(val) / 100;
  if (typeof val === 'string') {
    const s = val.trim();
    // if it looks like a decimal, treat as dollars
    if (s.includes('.')) {
      const f = parseFloat(s);
      return Number.isFinite(f) ? f : 0;
    }
    const n = parseInt(s, 10);
    return Number.isNaN(n) ? 0 : n / 100;
  }
  if (typeof val === 'number') {
    // if number has fractional part assume dollars (e.g., 12.34)
    if (!Number.isInteger(val)) return val;
    // integer numbers are most likely cents -> convert
    return val / 100;
  }
  return 0;
}

exports.handler = async (event, context) => {
  const origin = validateOrigin(event.headers || {});
  const headers = makeHeaders(origin);

  if (MISSING_ENV) return { statusCode: 500, headers, body: JSON.stringify({ error: 'Server misconfiguration' }) };

  // Only allow GET
  if (event.httpMethod === 'OPTIONS') {
    const optHeaders = Object.assign({}, headers, { 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization' });
    return { statusCode: 200, headers: optHeaders, body: '' };
  }
  if (event.httpMethod !== 'GET') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  // Always require manager auth — no header-based bypass
  const auth = await authorize(event, { requireManager: true });
  if (!auth.ok) return Object.assign({}, auth.response, { headers: Object.assign({}, auth.response.headers || {}, headers) });

  // Rate limit per-manager + IP
  const clientIp = event.headers['x-nf-client-connection-ip'] || event.headers['x-forwarded-for']?.split(',')[0]?.trim() || 'unknown';
  const managerEmail = (auth.user && (auth.user.email || auth.user?.user?.email)) ? String(auth.user.email || auth.user?.user?.email).toLowerCase() : 'unknown_manager';
  const key = `salesreport:${managerEmail}:${clientIp}`;
  const rl = formBucket.consume(key);
  if (!rl.allowed) {
    return { statusCode: 429, headers: Object.assign({}, headers, { 'Retry-After': String(Math.ceil(rl.retryAfterMs / 1000)) }), body: JSON.stringify({ error: 'Too many requests' }) };
  }

  try {
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

    // 2. Query the View we just built
    const { data, error } = await supabase
      .from('daily_sales_report')
      .select('*')
      .maybeSingle();

    if (error) {
      console.error('SQL View Error:', error.message);
      throw error;
    }

    // 3. Return the data exactly as manager.html expects it
    return { statusCode: 200, headers, body: JSON.stringify({
      total_orders: data?.total_orders || 0,
      gross_revenue: normalizeCents(data?.gross_revenue),
      completed_orders: data?.completed_orders || 0,
      timestamp: new Date().toISOString()
    }) };

  } catch (err) {
    const res = sanitizedError(err, 'sales-report');
    res.headers = Object.assign({}, res.headers || {}, headers);
    return res;
  }
};