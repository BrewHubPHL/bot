const { createClient } = require('@supabase/supabase-js');
const { authorize, json } = require('./_auth');
const { requireCsrfHeader } = require('./_csrf');
const { checkQuota } = require('./_usage');

// HTML-escape user-supplied strings to prevent injection in emails
const escapeHtml = (s) => String(s || '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;')
  .replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function getClientIP(event) {
  return event.headers['x-nf-client-connection-ip']
    || event.headers['x-forwarded-for']?.split(',')[0]?.trim()
    || 'unknown';
}

// UUID v4 format check
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Maximum items per cart to prevent abuse
const MAX_CART_SIZE = 50;
const MAX_QUANTITY = 20;
const MAX_MODS_PER_ITEM = 10;

// ── Known modifiers with server-authoritative prices (cents) ──
// Client sends modifier names only; server looks up costs here.
const KNOWN_MODIFIERS = {
  'Oat Milk': 75,
  'Almond Milk': 75,
  'Extra Shot': 100,
  'Vanilla Syrup': 50,
  'Caramel Syrup': 50,
  'Make it Iced': 0,
};

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
  // CORS — include X-BrewHub-Action in allowed headers for CSRF protection
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

  // ── DUAL AUTH: Staff PIN *or* Supabase customer JWT ───────
  // 1. Try staff PIN first (POS terminal flow)
  // 2. Fall back to Supabase JWT (online customer flow)
  // 3. If neither, allow guest checkout with rate limiting
  let auth = await authorize(event, { requirePin: true });
  let authMode = 'staff';

  if (!auth.ok) {
    // Not a PIN session — try Supabase JWT (customer logged in)
    auth = await authorize(event);
    authMode = auth.ok ? 'customer' : 'guest';
  }

  // Guest orders: rate-limit to prevent KDS spam
  if (authMode === 'guest') {
    const hasQuota = await checkQuota('cafe_guest_order');
    if (!hasQuota) {
      console.warn(`[CAFE] Guest rate limit hit from IP (redacted)`);
      return json(429, { error: 'Too many orders. Please try again later or log in to skip the wait.' });
    }
  }

  try {
    const body = JSON.parse(event.body || '{}');

    // ── REJECT client-supplied totals / prices ──────────────
    if ('total' in body || 'total_cents' in body || 'total_amount_cents' in body || 'price' in body) {
      return json(400, { error: 'Client-supplied totals/prices are not accepted. Send items only.' });
    }

    const { terminal, user_id, customer_email: ce, customer_name: cn, offline_id } = body;

    // ── Require customer_name for non-terminal (site/guest) orders ───
    // POS terminal flow supplies the name via staff input; site orders must
    // include it so baristas have a callout name on the KDS.
    if (!terminal && (!cn || typeof cn !== 'string' || cn.trim().length === 0)) {
      return json(400, { error: 'customer_name is required for cafe orders.' });
    }

    // Accept both 'items' and 'cart' keys (backwards compat with legacy UIs)
    const rawItems = body.items || body.cart;

    if (!Array.isArray(rawItems) || rawItems.length === 0) {
      return json(400, { error: 'items[] cannot be empty. Send [{ product_id, quantity }] or [{ name, quantity }].' });
    }
    if (rawItems.length > MAX_CART_SIZE) {
      return json(400, { error: `Cart cannot exceed ${MAX_CART_SIZE} line items.` });
    }

    // ── Normalize items: accept product_id (UUID) or name ───
    // Both modes do server-side price lookup. Client prices are NEVER trusted.
    const normalized = [];

    for (const entry of rawItems) {
      // Reject any sneaky per-item price/total fields
      if (entry && typeof entry === 'object' && ('price' in entry || 'price_cents' in entry || 'total' in entry)) {
        return json(400, { error: 'Per-item prices are not accepted. Server calculates pricing.' });
      }

      const pid = entry?.product_id;
      const name = entry?.name;
      const qty = Number(entry?.quantity) || 1;

      if (!Number.isInteger(qty) || qty < 1 || qty > MAX_QUANTITY) {
        return json(400, { error: `Invalid quantity. Must be 1–${MAX_QUANTITY}.` });
      }

      // Validate customizations (modifier names only — server looks up prices)
      const rawMods = Array.isArray(entry?.customizations) ? entry.customizations : [];
      if (rawMods.length > MAX_MODS_PER_ITEM) {
        return json(400, { error: `Maximum ${MAX_MODS_PER_ITEM} modifiers per item.` });
      }
      const validMods = [];
      for (const mod of rawMods) {
        if (typeof mod !== 'string' || !Object.prototype.hasOwnProperty.call(KNOWN_MODIFIERS, mod)) {
          return json(400, { error: `Unknown modifier: ${String(mod).slice(0, 50)}` });
        }
        validMods.push(mod);
      }

      if (pid && typeof pid === 'string' && UUID_RE.test(pid)) {
        normalized.push({ product_id: pid, quantity: qty, customizations: validMods });
      } else if (name && typeof name === 'string' && name.length > 0 && name.length <= 200) {
        normalized.push({ name, quantity: qty, customizations: validMods });
      } else {
        return json(400, { error: 'Each item must have a valid product_id (UUID) or name (string).' });
      }
    }

    // ── Fetch authoritative prices from DB ───────────────────
    const byId = normalized.filter(i => i.product_id);
    const byName = normalized.filter(i => i.name);

    let productsById = [];
    if (byId.length > 0) {
      const uniqueIds = [...new Set(byId.map(i => i.product_id))];
      const { data, error: prodErr } = await supabase
        .from('merch_products')
        .select('id, name, price_cents')
        .in('id', uniqueIds)
        .eq('is_active', true)
        .is('archived_at', null);
      if (prodErr) {
        console.error('[CAFE] Product ID lookup error:', prodErr?.message);
        return json(500, { error: 'Failed to verify product prices.' });
      }
      productsById = data || [];
    }

    let productsByName = [];
    if (byName.length > 0) {
      const uniqueNames = [...new Set(byName.map(i => i.name))];
      const { data, error: prodErr } = await supabase
        .from('merch_products')
        .select('id, name, price_cents')
        .in('name', uniqueNames)
        .eq('is_active', true)
        .is('archived_at', null);
      if (prodErr) {
        console.error('[CAFE] Product name lookup error:', prodErr?.message);
        return json(500, { error: 'Failed to verify product prices.' });
      }
      productsByName = data || [];
    }

    // Build lookup maps
    const foundById = {};
    for (const p of productsById) foundById[p.id] = p;
    const foundByName = {};
    for (const p of productsByName) foundByName[p.name] = p;

    // ── Server-side price calculation (with modifier costs) ──
    // Use composite key (product + sorted mods) so items with
    // different customizations stay as separate line items.
    const qtyMap = {};

    for (const item of normalized) {
      const product = item.product_id ? foundById[item.product_id] : foundByName[item.name];
      if (!product) {
        return json(400, { error: `Unknown or inactive product: ${item.product_id || item.name}` });
      }
      const mods = item.customizations || [];
      const modKey = mods.slice().sort().join(',');
      const compositeKey = `${product.id}::${modKey}`;
      if (!qtyMap[compositeKey]) {
        const modCostCents = mods.reduce(
          (sum, m) => sum + (KNOWN_MODIFIERS[m] || 0), 0
        );
        qtyMap[compositeKey] = { product, totalQty: 0, customizations: mods, modCostCents };
      }
      qtyMap[compositeKey].totalQty += item.quantity;
    }

    let totalCents = 0;
    const validatedItems = [];

    for (const { product, totalQty, customizations, modCostCents } of Object.values(qtyMap)) {
      const unitCents = product.price_cents + modCostCents;
      const lineCents = unitCents * totalQty;
      totalCents += lineCents;
      validatedItems.push({
        drink_name: product.name,
        price: unitCents / 100,
        quantity: totalQty,
        customizations: customizations.length > 0 ? customizations : null,
      });
    }

    // ── Strict $0.00 floor — prevent negative totals ────────
    totalCents = Math.max(0, totalCents);
    if (totalCents <= 0) {
      return json(400, { error: 'Order total must be greater than $0.00.' });
    }

    // ── Create order with SERVER-calculated total ────────────
    // POS terminal orders start as 'pending' — the Square webhook will
    // transition them to 'preparing' once payment is confirmed. This
    // eliminates the "Limbo State" where unpaid orders pollute the KDS.
    // Online/direct orders are marked 'paid' immediately.
    const orderStatus = terminal ? 'pending' : 'paid';

    const orderRow = {
      status: orderStatus,
      type: 'cafe',
      total_amount_cents: totalCents,
    };
    // Only attach user_id / customer fields if provided (prevents null FK issues)
    // For logged-in customers, auto-attach their user_id for loyalty tracking
    const effectiveUserId = user_id || (authMode === 'customer' && auth.user?.id) || null;
    const effectiveEmail = ce || (authMode === 'customer' && auth.user?.email) || null;

    if (effectiveUserId && typeof effectiveUserId === 'string' && effectiveUserId.length > 0) orderRow.user_id = effectiveUserId;
    if (effectiveEmail && typeof effectiveEmail === 'string') orderRow.customer_email = effectiveEmail;
    if (cn && typeof cn === 'string') orderRow.customer_name = cn;

    // Attach offline_id for idempotent offline sync (dedup)
    if (offline_id && typeof offline_id === 'string' && offline_id.length > 0 && offline_id.length <= 200) {
      orderRow.offline_id = offline_id;
    }

    const { data: insertedOrder, error: orderErr } = await supabase
      .from('orders')
      .insert(orderRow)
      .select()
      .single();

    if (orderErr) {
      // Offline dedup: unique constraint violation on offline_id → return existing order
      if (orderErr.code === '23505' && orderRow.offline_id) {
        const { data: existing } = await supabase
          .from('orders')
          .select()
          .eq('offline_id', orderRow.offline_id)
          .single();
        if (existing) {
          console.log(`[CAFE] Dedup: offline_id ${orderRow.offline_id} already exists, returning existing order ${existing.id}`);
          return json(200, { success: true, order: existing, total_cents: existing.total_amount_cents, deduplicated: true });
        }
      }
      console.error('Cafe order create error:', orderErr?.message);
      return json(500, { error: 'Failed to create order' });
    }
    const order = insertedOrder;

    // Insert coffee line items (one row per unit for KDS compatibility)
    const coffeeItems = [];
    for (const item of validatedItems) {
      for (let i = 0; i < item.quantity; i++) {
        coffeeItems.push({
          order_id: order.id,
          drink_name: item.drink_name,
          price: item.price,
          customizations: item.customizations || null,
        });
      }
    }

    const { error: itemErr } = await supabase
      .from('coffee_orders')
      .insert(coffeeItems);

    if (itemErr) {
      // Coffee items failed — rollback the parent order to prevent a ghost KDS card
      await supabase.from('orders').delete().eq('id', order.id);
      return json(500, { error: 'Failed to save order items. Please try again.' });
    }

    // Send order confirmation email if customer email provided
    // Reuse ce/cn already extracted above (no double JSON.parse)
    const customer_email = typeof ce === 'string' ? ce.slice(0, 320) : null;
    const customer_name = typeof cn === 'string' ? cn.slice(0, 100) : null;
    // Validate email format before sending
    const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (customer_email && EMAIL_RE.test(customer_email) && process.env.RESEND_API_KEY) {
      const safeName = escapeHtml(customer_name);
      const itemList = validatedItems.map(i => `${escapeHtml(i.drink_name)} - $${i.price.toFixed(2)}`).join('<br>');
      try {
        await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
        },
        body: JSON.stringify({
          from: 'BrewHub PHL <info@brewhubphl.com>',
          to: [customer_email],
          subject: `BrewHub Order Confirmed ☕ #${order.id.slice(0,8)}`,
          html: `
            <div style="font-family: sans-serif; max-width: 600px; margin: auto; padding: 20px;">
              <h1 style="color: #333;">Thanks for your order!</h1>
              <p>Hi ${safeName || 'there'},</p>
              <div style="background: #f9f9f9; padding: 15px; border-radius: 8px; margin: 20px 0;">
                <p style="margin: 0;"><strong>Order #:</strong> ${order.id.slice(0,8).toUpperCase()}</p>
                <p style="margin: 10px 0 0 0;"><strong>Items:</strong></p>
                <p style="margin: 5px 0;">${itemList}</p>
                <hr style="border: 0; border-top: 1px solid #ddd; margin: 15px 0;">
                <p style="margin: 0; font-size: 1.2em;"><strong>Total: $${(totalCents/100).toFixed(2)}</strong></p>
              </div>
              <p>Your order is being prepared. See you soon!</p>
              <p>— The BrewHub PHL Team</p>
            </div>
          `
        })
      });
      } catch (emailErr) {
        console.error('[CAFE] Email send error:', emailErr.message);
      }
    }

    return json(200, { 
      success: true, 
      order: order,
      total_cents: totalCents 
    });

  } catch (err) {
    console.error('Cafe checkout error:', err?.message);
    return json(500, { error: 'Checkout failed' });
  }
};
