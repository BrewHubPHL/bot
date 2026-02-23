// get-kds-orders.js — Server-side proxy for KdsSection.
// Returns active orders (unpaid / paid / preparing / ready) with their drink items.
// 'unpaid' orders come from the AI chatbot — customer pays on arrival, staff
// pre-prepares so the drink is ready when they walk in.
// Uses service_role to bypass RLS on orders / coffee_orders tables.

const { createClient } = require('@supabase/supabase-js');
const { authorize, json, sanitizedError } = require('./_auth');
const { sanitizeInput } = require('./_sanitize');
const { orderBucket } = require('./_token-bucket');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return json(204, {});
  if (event.httpMethod !== 'GET') return json(405, { error: 'Method not allowed' });

  const auth = await authorize(event);
  if (!auth.ok) return auth.response;

  // Light rate-limit for KDS retrievals to mitigate UI floods
  try {
    const rlKey = `kds:${auth.user?.id || event.headers['x-nf-client-connection-ip'] || 'anon'}`;
    const rl = orderBucket.consume(rlKey);
    if (!rl.allowed) {
      const resp = json(429, { error: 'Too many requests' });
      resp.headers = Object.assign({}, resp.headers, { 'Retry-After': String(Math.ceil((rl.retryAfterMs || 1000) / 1000)) });
      return resp;
    }
  } catch (e) {
    console.warn('[KDS RATE] rate limiter failed:', e?.message || e);
  }

  try {
    const { data, error } = await supabase
      .from('orders')
      .select('id, customer_name, status, created_at, coffee_orders(id, drink_name, customizations, price)')
      .in('status', ['unpaid', 'pending', 'paid', 'preparing', 'ready'])
      .order('created_at', { ascending: true })
      .limit(200);

    if (error) throw error;

    const orders = (data || []).map((o) => {
      const full = String(o.customer_name || '').trim();
      const firstName = full ? full.split(/\s+/)[0] : null;
      // Avoid returning full PII; expose first name only for KDS display
      const { customer_name, ...rest } = o;

      // Sanitize and cap coffee items to avoid huge payloads and leaked PII
      const coffee = (o.coffee_orders || []).slice(0, 20).map((ci) => ({
        id: ci.id,
        drink_name: String(sanitizeInput(ci.drink_name || '')).slice(0, 200),
        customizations: String(sanitizeInput(ci.customizations || '')).slice(0, 1000),
        price: ci.price,
      }));

      return { ...rest, first_name: firstName, coffee_orders: coffee };
    });

    return json(200, { orders });
  } catch (err) {
    return sanitizedError(err, 'get-kds-orders');
  }
};
