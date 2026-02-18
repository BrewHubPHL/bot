const { createClient } = require('@supabase/supabase-js');
const { authorize, json } = require('./_auth');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

exports.handler = async (event) => {
  // Auth check
  const auth = await authorize(event);
  if (!auth.ok) return auth.response;

  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Method not allowed' });
  }

  const { cart } = JSON.parse(event.body || '{}');

  if (!Array.isArray(cart) || cart.length === 0) {
    return json(400, { error: 'Cart must include at least one item' });
  }

  const itemNames = cart.map(item => item?.name).filter(Boolean);
  if (itemNames.length !== cart.length) {
    return json(400, { error: 'Each cart item must include a name' });
  }

  const { data: dbProducts, error: dbErr } = await supabase
    .from('merch_products')
    .select('name, price_cents')
    .in('name', itemNames)
    .eq('is_active', true);

  if (dbErr) {
    console.error('Create order price lookup error:', dbErr);
    return json(500, { error: 'Failed to load product prices' });
  }

  const priceMap = {};
  for (const p of (dbProducts || [])) {
    priceMap[p.name] = p.price_cents;
  }

  let totalCents = 0;
  for (const item of cart) {
    const price = priceMap[item.name];
    const qty = Number(item.qty || item.quantity || 0);

    if (price === undefined) {
      return json(400, { error: `Unknown product: ${item.name}` });
    }

    if (!Number.isInteger(qty) || qty <= 0 || qty > 50) {
      return json(400, { error: `Invalid quantity for ${item.name}` });
    }

    totalCents += price * qty;
  }

  if (totalCents <= 0) {
    return json(400, { error: 'Order total must be positive' });
  }

  const { data, error } = await supabase
    .from('orders')
    .insert({
      total_amount_cents: totalCents,
      status: 'pending',
      user_id: auth.user?.id || null
    })
    .select()
    .single();

  if (error) {
    console.error('Create order error:', error);
    return json(500, { error: 'Order failed' });
  }

  return json(200, { order: data, total_amount_cents: totalCents });
};
