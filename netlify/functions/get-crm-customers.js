// get-crm-customers.js — Returns filtered customer rows for the CRM drill-down.
// Manager-only + rate-limited. Accepts a ?filter= query param.
const { createClient } = require('@supabase/supabase-js');
const { authorize, json, sanitizedError } = require('./_auth');
const { staffBucket } = require('./_token-bucket');
const { logSystemError } = require('./_system-errors');

const MISSING_ENV = !process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY;

const ALLOWED_ORIGINS = new Set([
  process.env.SITE_URL,
  process.env.URL,
  'https://brewhubphl.com',
  'https://www.brewhubphl.com',
].filter(Boolean));

const VALID_FILTERS = new Set([
  'all', 'app_users', 'walk_in', 'mailbox', 'vip', 'loyalty', 'active_30d', 'new_7d',
]);

const SELECT_COLS =
  'id, full_name, email, phone, unit_number, is_vip, loyalty_points, total_orders, favorite_drink, created_at';

const PAGE_LIMIT = 500;

function validateOrigin(headers) {
  const origin = headers['origin'] || headers['Origin'] || '';
  if (ALLOWED_ORIGINS.has(origin)) return origin;
  if (origin === '' && process.env.SITE_URL) return process.env.SITE_URL;
  return null;
}

const makeHeaders = (origin) => Object.assign({
  'Content-Type': 'application/json',
  'Cache-Control': 'private, max-age=15',
  'Vary': 'Origin',
}, origin ? { 'Access-Control-Allow-Origin': origin } : {});

exports.handler = async (event) => {
  if (MISSING_ENV) {
    return { statusCode: 500, headers: makeHeaders(null), body: JSON.stringify({ error: 'Server misconfiguration' }) };
  }

  const origin = validateOrigin(event.headers || {});
  const headers = makeHeaders(origin);

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  // Manager auth
  const auth = await authorize(event, { requireManager: true, requirePin: true });
  if (!auth.ok) {
    return Object.assign({}, auth.response, {
      headers: Object.assign({}, auth.response.headers || {}, headers),
    });
  }

  // Rate limit
  const clientIp = event.headers['x-nf-client-connection-ip']
    || event.headers['x-forwarded-for']?.split(',')[0]?.trim()
    || 'unknown';
  const rl = staffBucket.consume(`crm-customers:${clientIp}`);
  if (!rl.allowed) {
    return {
      statusCode: 429,
      headers: Object.assign({}, headers, { 'Retry-After': String(Math.ceil(rl.retryAfterMs / 1000)) }),
      body: JSON.stringify({ error: 'Too many requests' }),
    };
  }

  // Parse filter
  const rawFilter = (event.queryStringParameters?.filter || 'all').toLowerCase();
  const filter = VALID_FILTERS.has(rawFilter) ? rawFilter : 'all';

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

  try {

    let query = supabase
      .from('customers')
      .select(SELECT_COLS)
      .order('created_at', { ascending: false })
      .limit(PAGE_LIMIT);

    // Apply filter
    switch (filter) {
      case 'app_users':
        query = query.not('auth_id', 'is', null);
        break;
      case 'walk_in':
        query = query.is('auth_id', null);
        break;
      case 'mailbox':
        query = query.not('unit_number', 'is', null).neq('unit_number', '');
        break;
      case 'vip':
        query = query.eq('is_vip', true);
        break;
      case 'loyalty':
        query = query.gt('loyalty_points', 0);
        break;
      case 'active_30d': {
        const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
        const { data: orderRows, error: orderErr } = await supabase
          .from('orders')
          .select('user_id')
          .gte('created_at', thirtyDaysAgo)
          .in('status', ['completed', 'ready', 'preparing'])
          .eq('data_integrity_level', 'production');
        if (orderErr) throw orderErr;
        const activeIds = [...new Set(orderRows.map(r => r.user_id).filter(Boolean))];
        if (activeIds.length === 0) {
          return { statusCode: 200, headers, body: JSON.stringify({ customers: [], filter }) };
        }
        query = query.in('id', activeIds);
        break;
      }
      case 'new_7d':
        query = query
          .gte('created_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString());
        break;
      // 'all' — no extra filter
    }

    const { data, error } = await query;
    if (error) throw error;

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ customers: data || [], filter }),
    };
  } catch (err) {
    console.error('[CRM-CUSTOMERS]', err?.message);
    await logSystemError(supabase, {
      error_type: 'unhandled_exception',
      severity: 'critical',
      source_function: 'get-crm-customers',
      error_message: err?.message || 'Unknown error',
      context: { stack: err?.stack },
    });
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'An error occurred. Please try again.' }) };
  }
};
