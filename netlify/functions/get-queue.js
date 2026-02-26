/**
 * get-queue.js — Public order queue for customer-facing display board.
 *
 * Returns active orders with sanitized fields (first name only, items, status).
 * Uses service role to bypass RLS — returns only what customers should see.
 * No auth required — intended for a lobby/counter display screen.
 */
const { createClient } = require('@supabase/supabase-js');
const { publicBucket } = require('./_token-bucket');
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

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  // Per-IP rate limiting
  const clientIp = event.headers['x-nf-client-connection-ip']
    || event.headers['x-forwarded-for']?.split(',')[0]?.trim()
    || 'unknown';
  const ipLimit = publicBucket.consume('queue:' + clientIp);
  if (!ipLimit.allowed) {
    return {
      statusCode: 429,
      headers: Object.assign({}, headers, { 'Retry-After': String(Math.ceil(ipLimit.retryAfterMs / 1000)) }),
      body: JSON.stringify({ error: 'Too many requests. Please try again shortly.' }),
    };
  }

  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    // Fetch active orders (including recently completed) from today
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const { data: orders, error } = await supabase
      .from('orders')
      .select('id, customer_name, status, created_at, completed_at, coffee_orders(drink_name, customizations)')
      .in('status', ['pending', 'unpaid', 'paid', 'preparing', 'ready', 'completed'])
      .neq('type', 'merch')
      .gte('created_at', today.toISOString())
      .order('created_at', { ascending: true })
      .limit(200);

    if (error) throw error;

    // Auto-expire completed orders after 15 minutes so board stays tidy
    const COMPLETED_TTL_MS = 15 * 60 * 1000;
    const now = Date.now();
    const filtered = (orders || []).filter(o => {
      if (o.status !== 'completed') return true;
      const doneAt = o.completed_at ? new Date(o.completed_at).getTime() : new Date(o.created_at).getTime();
      return (now - doneAt) < COMPLETED_TTL_MS;
    });

    // Sanitize for public display: first name only, no IDs, no payment details
    const queue = filtered.map((order, index) => {
      // Extract first name only (privacy)
      const rawFull = sanitizeInput(order.customer_name || 'Guest');
      const firstName = (rawFull.split(/\s+/)[0] || 'Guest').slice(0, 30);

      // Build item list
      const items = (order.coffee_orders || []).slice(0, 20).map(item => ({
        name: String(sanitizeInput(item.drink_name || '')).slice(0, 200),
        mods: item.customizations ? formatMods(item.customizations) : null,
      }));

      const idStr = String(order.id || '----');
      const minutesAgo = order.created_at ? Math.round((Date.now() - new Date(order.created_at).getTime()) / 60000) : null;

      // An order is paid once it reaches 'paid', 'preparing', 'ready', or 'completed'.
      // 'pending' and 'unpaid' are the only pre-payment states.
      const isPaid = ['paid', 'preparing', 'ready', 'completed'].includes(order.status);

      return {
        id: order.id,
        position: index + 1,
        name: firstName,
        tag: `BRW-${idStr.slice(-4).toUpperCase()}`,
        items,
        status: order.status,
        created_at: order.created_at,
        minutesAgo,
        isPaid,
      };
    });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ queue, count: queue.length, timestamp: new Date().toISOString() }),
    };

  } catch (err) {
    console.error('[GET-QUEUE] Error:', err?.message);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Failed to load queue' }),
    };
  }
};

// Format customizations object into readable string, sanitising values
function formatMods(customizations) {
  if (!customizations || typeof customizations !== 'object') return null;
  const parts = [];
  if (customizations.milk && customizations.milk !== 'whole') parts.push(sanitizeInput(String(customizations.milk)).slice(0, 50));
  if (customizations.size && customizations.size !== 'regular') parts.push(sanitizeInput(String(customizations.size)).slice(0, 50));
  if (customizations.extras) {
    const extras = Array.isArray(customizations.extras) ? customizations.extras : [customizations.extras];
    parts.push(...extras.map(e => sanitizeInput(String(e)).slice(0, 50)));
  }
  if (customizations.temperature) parts.push(sanitizeInput(String(customizations.temperature)).slice(0, 50));
  if (customizations.notes) parts.push(sanitizeInput(String(customizations.notes)).slice(0, 200));
  return parts.length > 0 ? parts.join(', ') : null;
}
