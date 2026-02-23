const { SquareClient, SquareEnvironment } = require('square');
const { createClient } = require('@supabase/supabase-js');
const { randomUUID, createHmac } = require('crypto');
const { checkQuota } = require('./_usage');
const { requireCsrfHeader } = require('./_csrf');
const { merchPayBucket } = require('./_token-bucket');

const square = new SquareClient({
  token: process.env.SQUARE_PRODUCTION_TOKEN,
  environment: SquareEnvironment.Production,
});

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Allowed origins for payment requests
const ALLOWED_ORIGINS = [
  process.env.SITE_URL || 'https://brewhubphl.com',
  'https://brewhubphl.com',
  'https://www.brewhubphl.com',
].filter(Boolean);

exports.handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': process.env.SITE_URL || 'https://brewhubphl.com',
    'Access-Control-Allow-Headers': 'Content-Type, X-BrewHub-Action, Authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };

  // CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  // CSRF protection
  const csrfBlock = requireCsrfHeader(event);
  if (csrfBlock) return csrfBlock;

  // Origin validation — reject requests not originating from our site
  const origin = (event.headers['origin'] || '').replace(/\/$/, '');
  const referer = (event.headers['referer'] || '');
  const isValidOrigin = ALLOWED_ORIGINS.some(allowed =>
    origin === allowed || referer.startsWith(allowed)
  );
  // Allow localhost ONLY in non-production environments
  const isLocalDev = process.env.NODE_ENV !== 'production' && (origin.includes('://localhost') || referer.includes('://localhost'));
  if (!isValidOrigin && !isLocalDev) {
    console.warn(`[MERCH-PAY] Rejected: origin=${origin} referer=${referer}`);
    return { statusCode: 403, headers, body: JSON.stringify({ error: 'Invalid request origin' }) };
  }

  // Per-IP rate limiting — prevent payment abuse from a single source
  const clientIp = event.headers['x-nf-client-connection-ip']
    || event.headers['x-forwarded-for']?.split(',')[0]?.trim()
    || 'unknown';
  const ipLimit = merchPayBucket.consume(clientIp);
  if (!ipLimit.allowed) {
    console.warn(`[MERCH-PAY] IP rate limited: ${clientIp}`);
    return {
      statusCode: 429,
      headers: { ...headers, 'Retry-After': String(Math.ceil(ipLimit.retryAfterMs / 1000)) },
      body: JSON.stringify({ error: 'Too many payment attempts. Please wait a moment.' }),
    };
  }

  // Daily quota rate limiting
  const isUnderLimit = await checkQuota('square_checkout');
  if (!isUnderLimit) {
    return { 
      statusCode: 429, 
      headers, 
      body: JSON.stringify({ error: 'Too many requests. Please try again in a few minutes.' }) 
    };
  }

  try {
    const { cart, sourceId, customerEmail, customerName, shippingAddress } = JSON.parse(event.body || '{}');

    // Validate required fields
    if (!cart || !Array.isArray(cart) || cart.length === 0) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Cart is empty' }) };
    }

    if (!sourceId) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Payment source required' }) };
    }

    // Server-side price lookup — NEVER trust client prices
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const productIds = cart.map(item => item.id).filter(Boolean).filter(id => UUID_RE.test(String(id)));
    const productNames = cart.map(item => item.name).filter(Boolean);
    
    // Sanitize product names to prevent PostgREST filter injection
    const safeName = (n) => String(n).replace(/["\\(),]/g, '');
    const sanitizedNames = productNames.map(safeName).filter(n => n.length > 0);

    // Build safe filter — use separate queries if only IDs or only names
    let filterParts = [];
    if (productIds.length > 0) filterParts.push(`id.in.(${productIds.join(',')})`);
    if (sanitizedNames.length > 0) filterParts.push(`name.in.(${sanitizedNames.map(n => `"${n}"`).join(',')})`);
    
    if (filterParts.length === 0) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'No valid products in cart' }) };
    }

    const { data: dbProducts, error: dbErr } = await supabase
      .from('merch_products')
      .select('id, name, price_cents')
      .eq('is_active', true)
      .is('archived_at', null)
      .or(filterParts.join(','));
    if (dbErr) {
      console.error('DB lookup error:', dbErr);
      return { statusCode: 500, headers, body: JSON.stringify({ error: 'Failed to validate products' }) };
    }

    // Build price lookup maps
    const priceById = {};
    const priceByName = {};
    for (const p of (dbProducts || [])) {
      if (p.id) priceById[p.id] = p.price_cents;
      if (p.name) priceByName[p.name] = p.price_cents;
    }

    // Calculate total with server prices
    let totalCents = 0;
    const lineItems = [];

    for (const item of cart) {
      const serverPrice = priceById[item.id] || priceByName[item.name];
      
      if (serverPrice === undefined) {
        return { 
          statusCode: 400, 
          headers, 
          body: JSON.stringify({ error: `Product not found: ${item.name || item.id}` }) 
        };
      }

      const qty = Math.min(50, Math.max(1, parseInt(item.quantity) || 1));
      totalCents += serverPrice * qty;

      lineItems.push({
        name: item.name,
        quantity: qty.toString(),
        basePriceMoney: { amount: BigInt(serverPrice), currency: 'USD' },
      });
    }

    if (totalCents <= 0) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid order total' }) };
    }

    // Deterministic idempotency key: same cart + same customer = same key
    // Prevents double-charges on retry/double-click while allowing
    // intentional re-orders (different timestamp window)
    const cartFingerprint = lineItems.map(i => `${i.name}:${i.quantity}`).sort().join('|');
    const idempotencyInput = `${cartFingerprint}:${customerEmail || clientIp}:${totalCents}:${Math.floor(Date.now() / 60000)}`;
    const internalSyncSecret = process.env.INTERNAL_SYNC_SECRET;
    const internalSyncSalt = process.env.INTERNAL_SYNC_SALT;
    if (!internalSyncSecret || !internalSyncSalt) {
      console.error('[MERCH-PAY] Missing INTERNAL_SYNC_SECRET or INTERNAL_SYNC_SALT env');
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: 'Server misconfiguration' }),
      };
    }

    // Derive a fixed-length key from the secret using PBKDF2 to satisfy SAST rules
    const derivedKey = require('crypto').pbkdf2Sync(
      internalSyncSecret,
      internalSyncSalt,
      100000,
      32,
      'sha256'
    );

    const idempotencyKey = createHmac('sha256', derivedKey)
      .update(idempotencyInput)
      .digest('hex')
      .slice(0, 32);
    const referenceId = `MERCH-${Date.now()}-${idempotencyKey.slice(0, 8)}`;

    // Create Square Payment
    const paymentResponse = await square.payments.create({
      idempotencyKey,
      sourceId,
      amountMoney: {
        amount: BigInt(totalCents),
        currency: 'USD',
      },
      locationId: process.env.SQUARE_LOCATION_ID,
      referenceId,
      note: `BrewHub Merch Order: ${lineItems.map(i => `${i.quantity}x ${i.name}`).join(', ')}`,
      buyerEmailAddress: customerEmail || undefined,
    });

    const payment = paymentResponse.result?.payment;

    if (!payment || payment.status === 'FAILED') {
      console.error('Payment failed:', paymentResponse);
      return { 
        statusCode: 400, 
        headers, 
        body: JSON.stringify({ error: 'Payment failed. Please try again.' }) 
      };
    }

    // Store order in Supabase
    const orderData = {
      id: referenceId,
      type: 'merch',
      status: payment.status === 'COMPLETED' ? 'paid' : 'pending',
      total_amount_cents: totalCents,
      payment_id: payment.id,
      customer_email: customerEmail || null,
      customer_name: customerName || null,
      shipping_address: shippingAddress || null,
      items: lineItems.map(i => ({ name: i.name, quantity: parseInt(i.quantity), price_cents: Number(i.basePriceMoney.amount) })),
      created_at: new Date().toISOString(),
    };

    const { error: insertErr } = await supabase
      .from('orders')
      .insert(orderData);

    if (insertErr) {
      // CRITICAL: Log the Square Payment ID with the error so we can find it later
      console.error(`[CRITICAL] Payment ${payment.id} succeeded but DB failed:`, insertErr.message);
      
      // Do NOT return 200. Return 500 so the frontend doesn't show a success message.
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ 
          error: "Payment processed but order recording failed. Please contact info@brewhubphl.com with your receipt.",
          paymentId: payment.id 
        })
      };
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        orderId: referenceId,
        paymentId: payment.id,
        status: payment.status,
        receiptUrl: payment.receiptUrl,
      }),
    };

  } catch (err) {
    console.error('Payment processing error:', err);
    
    // Handle Square-specific errors
    if (err.result?.errors) {
      const squareError = err.result.errors[0];
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ 
          error: squareError.detail || 'Payment declined',
          code: squareError.code 
        }),
      };
    }

    return { 
      statusCode: 500, 
      headers, 
      body: JSON.stringify({ error: 'Payment processing failed' }) 
    };
  }
};
