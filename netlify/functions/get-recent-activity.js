// get-recent-activity.js — Server-side proxy for RecentActivity.
// Returns latest orders + inventory changes for the manager dashboard.

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

function maskCustomerName(name) {
  if (!name) return '';
  const s = sanitizeInput(String(name)).trim();
  // return first name only to reduce PII surface
  const first = s.split(/\s+/)[0] || s;
  return first.slice(0, 60);
}

const RECENT_LIMIT = 5;

exports.handler = async (event) => {
  const origin = validateOrigin(event.headers || {});
  const headers = makeHeaders(origin);

  if (MISSING_ENV) return { statusCode: 500, headers, body: JSON.stringify({ error: 'Server misconfiguration' }) };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: Object.assign({}, headers, { 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization' }), body: '' };
  if (event.httpMethod !== 'GET') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  const auth = await authorize(event, { requireManager: true });
  if (!auth.ok) return Object.assign({}, auth.response, { headers: Object.assign({}, auth.response.headers || {}, headers) });

  // Rate limit per-manager + IP
  const clientIp = event.headers['x-nf-client-connection-ip'] || event.headers['x-forwarded-for']?.split(',')[0]?.trim() || 'unknown';
  const managerEmail = (auth.user && (auth.user.email || auth.user?.user?.email)) ? String(auth.user.email || auth.user?.user?.email).toLowerCase() : 'unknown_manager';
  const key = `recentact:${managerEmail}:${clientIp}`;
  const rl = staffBucket.consume(key);
  if (!rl.allowed) {
    return { statusCode: 429, headers: Object.assign({}, headers, { 'Retry-After': String(Math.ceil(rl.retryAfterMs / 1000)) }), body: JSON.stringify({ error: 'Too many requests' }) };
  }

  try {
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

    const [ordersRes, inventoryRes] = await Promise.all([
      supabase
        .from('orders')
        .select('id, customer_name, status, created_at')
        .order('created_at', { ascending: false })
        .limit(RECENT_LIMIT),
      supabase
        .from('inventory')
        .select('id, item_name, current_stock, updated_at')
        .order('updated_at', { ascending: false })
        .limit(RECENT_LIMIT),
    ]);

    if (ordersRes.error) throw ordersRes.error;
    if (inventoryRes.error) throw inventoryRes.error;

    const orders = (ordersRes.data || []).map(o => ({
      id: o.id,
      customer_name: maskCustomerName(o.customer_name || ''),
      status: sanitizeInput(String(o.status || '')).slice(0, 30),
      created_at: o.created_at,
    }));

    const inventory = (inventoryRes.data || []).map(i => ({
      id: i.id,
      item_name: sanitizeInput(String(i.item_name || '')).slice(0, 200),
      current_stock: Number.isFinite(Number(i.current_stock)) ? Number(i.current_stock) : null,
      updated_at: i.updated_at,
    }));

    return { statusCode: 200, headers, body: JSON.stringify({ orders, inventory }) };
  } catch (err) {
    const res = sanitizedError(err, 'get-recent-activity');
    res.headers = Object.assign({}, res.headers || {}, headers);
    return res;
  }
};
