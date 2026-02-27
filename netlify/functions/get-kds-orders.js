// get-kds-orders.js — Server-side proxy for KdsSection.
// Returns active orders (unpaid / paid / preparing / ready) with their drink items.
// 'unpaid' orders come from the AI chatbot — customer pays on arrival, staff
// pre-prepares so the drink is ready when they walk in.
// Uses service_role to bypass RLS on orders / coffee_orders tables.

const { createClient } = require('@supabase/supabase-js');
const { authorize, sanitizedError } = require('./_auth');
const { sanitizeInput } = require('./_sanitize');
const { orderBucket } = require('./_token-bucket');

// ── Fail-closed env guard ─────────────────────────────────────────────────────
const MISSING_ENV = !process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY;

// ── CORS allowlist ────────────────────────────────────────────────────────────
// Allow additional origins via KDS_ALLOWED_ORIGINS (comma-separated)
const extraOrigins = (process.env.KDS_ALLOWED_ORIGINS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const ALLOWED_ORIGINS = new Set([
  ...extraOrigins,
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

  const auth = await authorize(event);
  if (!auth.ok) return Object.assign({}, auth.response, { headers: Object.assign({}, makeHeaders(origin), auth.response.headers || {}) });

  // Light rate-limit for KDS retrievals to mitigate UI floods
  try {
    const rlKey = `kds:${auth.user?.id || event.headers['x-nf-client-connection-ip'] || 'anon'}`;
    const rl = orderBucket.consume(rlKey);
    if (!rl.allowed) {
      return jsonResp(429, { error: 'Too many requests' }, origin);
    }
  } catch (e) {
    console.warn('[KDS RATE] rate limiter failed:', e?.message || e);
  }

  // Per-request Supabase client (service_role) — not at module scope
  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
  );

  // ── History mode: return last 10 completed/ready orders from past 30 min ──
  const qs = event.queryStringParameters || {};
  const isHistory = qs.history === 'true';

  try {
    let query;
    if (isHistory) {
      const cutoff = new Date(Date.now() - 30 * 60 * 1000).toISOString();
      query = supabase
        .from('orders')
        .select('id, customer_name, status, created_at, updated_at, is_guest_order, total_amount_cents, claimed_by, coffee_orders(id, drink_name, customizations, price, completed_at, completed_by)')
        .in('status', ['completed', 'ready'])
        .neq('type', 'merch')
        .gte('updated_at', cutoff)
        .order('updated_at', { ascending: false })
        .limit(10);
    } else {
      query = supabase
        .from('orders')
        .select('id, customer_name, status, created_at, is_guest_order, total_amount_cents, claimed_by, coffee_orders(id, drink_name, customizations, price, completed_at, completed_by)')
        .in('status', ['unpaid', 'pending', 'paid', 'preparing', 'ready'])
        .neq('type', 'merch')
        .order('created_at', { ascending: true })
        .limit(200);
    }

    const { data, error } = await query;

    if (error) throw error;

    const orders = (data || []).map((o) => {
      const full = String(o.customer_name || '').trim();
      // DOOMSDAY FIX: Sanitize customer name on read path for defense-in-depth
      const rawFirst = full ? full.split(/\s+/)[0] : null;
      const firstName = rawFirst ? String(sanitizeInput(rawFirst)).slice(0, 50) : null;
      // Avoid returning full PII; expose first name only for KDS display
      const { customer_name, ...rest } = o;

      // Sanitize and cap coffee items to avoid huge payloads and leaked PII
      const coffee = (o.coffee_orders || []).slice(0, 20).map((ci) => ({
        id: ci.id,
        drink_name: String(sanitizeInput(ci.drink_name || '')).slice(0, 200),
        customizations: String(sanitizeInput(ci.customizations || '')).slice(0, 1000),
        price: ci.price,
        completed_at: ci.completed_at || null,
        completed_by: ci.completed_by || null,
      }));

      return { ...rest, first_name: firstName, claimed_by: o.claimed_by || null, coffee_orders: coffee };
    });

    return jsonResp(200, { orders }, origin);
  } catch (err) {
    const errResp = sanitizedError(err, 'get-kds-orders');
    // Ensure CORS headers are present on error responses so browsers
    // don't block them when the origin is allowed.
    errResp.headers = Object.assign({}, makeHeaders(origin), errResp.headers || {});
    return errResp;
  }
};
