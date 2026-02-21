const { createClient } = require('@supabase/supabase-js');
const { authorize, json } = require('./_auth');
const { requireCsrfHeader } = require('./_csrf');

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

  // ── CSRF protection ───────────────────────────────────────
  const csrfBlock = requireCsrfHeader(event);
  if (csrfBlock) return csrfBlock;

  const parsed = JSON.parse(event.body || '{}');

  // ── HPP GUARD: Detect duplicate keys in JSON body ───────────────
  const duplicateKeys = Object.keys(parsed).filter((key, index, arr) => arr.indexOf(key) !== index);
  if (duplicateKeys.length > 0) {
    return json(400, { error: `Duplicate keys detected: ${duplicateKeys.join(', ')}` });
  }

  // ── JSONB BOMB & PROTOTYPE POLLUTION GUARD ────────────────
  // Never trust raw client objects. Allowlist only known keys.
  const rawCart = parsed.cart;

  if (!Array.isArray(rawCart) || rawCart.length === 0) {
    return json(400, { error: 'Cart must include at least one item' });
  }

  // Hard cap: prevent absurdly large payloads from consuming DB resources
  if (rawCart.length > 100) {
    return json(400, { error: 'Cart exceeds maximum of 100 items' });
  }

  // Strict sanitization: build a new array with ONLY allowed keys.
  // __proto__, constructor, prototype, and any nested malicious JSONB are dropped.
  const cart = rawCart.map(item => {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) {
      return null; // will be caught below
    }
    return {
      name: typeof item.name === 'string' ? item.name.slice(0, 200) : undefined,
      quantity: Number(item.qty || item.quantity || 0),
    };
  });

  // Validate every sanitized item has a name
  const itemNames = cart.map(item => item?.name).filter(Boolean);
  if (itemNames.length !== cart.length) {
    return json(400, { error: 'Each cart item must include a name' });
  }

  const { data: dbProducts, error: dbErr } = await supabase
    .from('merch_products')
    .select('name, price_cents')
    .in('name', itemNames)
    .eq('is_active', true)
    .is('archived_at', null);

  if (dbErr) {
    console.error('Create order price lookup error:', dbErr);
    return json(500, { error: 'Failed to load product prices' });
  }

  const priceMap = Object.create(null); // no prototype — immune to __proto__ injection
  for (const p of (dbProducts || [])) {
    priceMap[p.name] = p.price_cents;
  }

  let totalCents = 0;
  for (const item of cart) {
    const price = priceMap[item.name];
    const qty = item.quantity;

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

// ── HPP GUARD: Validate req.query.id against array type ─────────
if (Array.isArray(event.queryStringParameters?.id)) {
  return json(400, { error: 'Invalid parameter: id must be a single value, not an array' });
}
