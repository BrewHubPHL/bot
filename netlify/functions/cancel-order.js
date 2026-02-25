const { createClient } = require('@supabase/supabase-js');
const { authorize, json } = require('./_auth');
const { requireCsrfHeader } = require('./_csrf');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ── CORS strict allowlist ─────────────────────────────────
const ALLOWED_ORIGINS = [
  process.env.URL,
  'https://brewhubphl.com',
  'https://www.brewhubphl.com',
].filter(Boolean);
const getCorsOrigin = (event) => {
  const origin = event.headers?.origin || '';
  return ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
};

exports.handler = async (event) => {
  // CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': getCorsOrigin(event),
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-BrewHub-Action',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
      },
      body: '',
    };
  }

  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Method not allowed' });
  }

  // ── CSRF protection ───────────────────────────────────────
  const csrfBlock = requireCsrfHeader(event);
  if (csrfBlock) return csrfBlock;

  // ── Staff PIN auth only — only POS terminals can cancel ───
  const auth = await authorize(event, { requirePin: true });
  if (!auth.ok) {
    return json(401, { error: 'Unauthorized — staff PIN required.' });
  }

  try {
    const body = JSON.parse(event.body || '{}');
    const { orderId } = body;

    if (!orderId || typeof orderId !== 'string' || !UUID_RE.test(orderId)) {
      return json(400, { error: 'Valid orderId (UUID) is required.' });
    }

    // Fetch the order to verify it exists and is still cancellable
    const { data: order, error: fetchErr } = await supabase
      .from('orders')
      .select('id, status')
      .eq('id', orderId)
      .single();

    if (fetchErr || !order) {
      return json(404, { error: 'Order not found.' });
    }

    // Only allow cancellation of pending orders (not yet paid/preparing)
    if (order.status !== 'pending') {
      return json(409, { error: `Cannot cancel order in "${order.status}" state.` });
    }

    // Delete child coffee_orders rows first (FK constraint)
    const { error: childErr } = await supabase
      .from('coffee_orders')
      .delete()
      .eq('order_id', orderId);

    if (childErr) {
      console.error('[CANCEL] coffee_orders delete error:', childErr.message);
      return json(500, { error: 'Failed to cancel order items.' });
    }

    // Delete the parent order row
    const { error: delErr } = await supabase
      .from('orders')
      .delete()
      .eq('id', orderId);

    if (delErr) {
      console.error('[CANCEL] orders delete error:', delErr.message);
      return json(500, { error: 'Failed to cancel order.' });
    }

    console.log(`[CANCEL] Order ${orderId} cancelled by staff`);
    return json(200, { success: true, cancelled_order_id: orderId });

  } catch (err) {
    console.error('[CANCEL] Error:', err?.message);
    return json(500, { error: 'Cancel failed.' });
  }
};
