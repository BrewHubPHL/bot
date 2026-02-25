// get-fulfillment-orders.js — Returns merch orders with fulfillment_type = 'shipping'.
// Staff use this from the Outbound Fulfillment dashboard to pack & ship orders.
// Uses service_role to bypass RLS on the orders table.

const { createClient } = require('@supabase/supabase-js');
const { authorize, sanitizedError } = require('./_auth');
const { sanitizeInput } = require('./_sanitize');
const { orderBucket } = require('./_token-bucket');

// ── Fail-closed env guard ─────────────────────────────────────────────────────
const MISSING_ENV = !process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY;

// ── CORS allowlist ────────────────────────────────────────────────────────────
const ALLOWED_ORIGINS = new Set([
  process.env.SITE_URL,
  'https://brewhubphl.com',
  'https://www.brewhubphl.com',
].filter(Boolean));

function validateOrigin(headers) {
  const origin = headers['origin'] || headers['Origin'] || '';
  return ALLOWED_ORIGINS.has(origin) ? origin : null;
}

function makeHeaders(origin) {
  const h = {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-cache',
    'Vary': 'Origin',
  };
  if (origin) h['Access-Control-Allow-Origin'] = origin;
  return h;
}

function jsonResp(status, body, origin) {
  return { statusCode: status, headers: makeHeaders(origin), body: JSON.stringify(body) };
}

exports.handler = async (event) => {
  const origin = validateOrigin(event.headers || {});

  // CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: Object.assign({}, makeHeaders(origin), {
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
      }),
      body: '',
    };
  }

  if (MISSING_ENV) return jsonResp(500, { error: 'Server misconfiguration' }, origin);
  if (event.httpMethod !== 'GET') return jsonResp(405, { error: 'Method not allowed' }, origin);

  // Staff authentication required — managers/admins/owners only
  const auth = await authorize(event, { requirePin: true });
  if (!auth.ok) {
    return Object.assign({}, auth.response, {
      headers: Object.assign({}, makeHeaders(origin), auth.response.headers || {}),
    });
  }

  // Light rate-limit
  try {
    const rlKey = `fulfillment:${auth.user?.id || 'anon'}`;
    const rl = orderBucket.consume(rlKey);
    if (!rl.allowed) {
      return jsonResp(429, { error: 'Too many requests' }, origin);
    }
  } catch (e) {
    console.warn('[FULFILLMENT RATE] rate limiter failed:', e?.message || e);
  }

  // ── Query param: ?include_shipped=true to also show shipped (History tab) ──
  const includeShipped = (event.queryStringParameters || {}).include_shipped === 'true';

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
  );

  try {
    let query = supabase
      .from('orders')
      .select('id, customer_name, customer_email, status, created_at, total_amount_cents, items, shipping_address, fulfillment_type, paid_at, updated_at')
      .eq('type', 'merch')
      .eq('fulfillment_type', 'shipping')
      .order('created_at', { ascending: true })
      .limit(200);

    if (!includeShipped) {
      // Active queue: only paid orders (not yet shipped/cancelled/completed)
      query = query.in('status', ['paid', 'pending']);
    }
    // When includeShipped is true, we return all statuses so the History tab
    // can show shipped & cancelled orders too.

    const { data, error } = await query;
    if (error) throw error;

    // Sanitize output — cap string lengths, don't leak raw DB fields
    const orders = (data || []).map((o) => {
      // Parse shipping_address — it may be stored as a JSON string or object
      let addr = null;
      if (o.shipping_address) {
        try {
          addr = typeof o.shipping_address === 'string'
            ? JSON.parse(o.shipping_address)
            : o.shipping_address;
        } catch {
          addr = null;
        }
      }

      // Sanitize address fields
      if (addr && typeof addr === 'object') {
        addr = {
          line1: String(addr.line1 || '').slice(0, 200),
          line2: String(addr.line2 || '').slice(0, 200) || undefined,
          city: String(addr.city || '').slice(0, 100),
          state: String(addr.state || '').slice(0, 50),
          zip: String(addr.zip || '').slice(0, 10),
          phone: String(addr.phone || '').slice(0, 20),
        };
      }

      // Sanitize items array
      const items = Array.isArray(o.items)
        ? o.items.slice(0, 50).map((i) => ({
            name: String(sanitizeInput(i.name || '')).slice(0, 200),
            quantity: Number(i.quantity) || 1,
            price_cents: Number(i.price_cents) || 0,
          }))
        : [];

      return {
        id: o.id,
        customer_name: String(o.customer_name || 'Guest').slice(0, 100),
        customer_email: o.customer_email ? String(o.customer_email).slice(0, 254) : null,
        status: o.status,
        created_at: o.created_at,
        paid_at: o.paid_at || null,
        updated_at: o.updated_at || null,
        total_amount_cents: o.total_amount_cents || 0,
        shipping_address: addr,
        items,
      };
    });

    return jsonResp(200, { orders }, origin);
  } catch (err) {
    const errResp = sanitizedError(err, 'get-fulfillment-orders');
    errResp.headers = Object.assign({}, makeHeaders(origin), errResp.headers || {});
    return errResp;
  }
};
