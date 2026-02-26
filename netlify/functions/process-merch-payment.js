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
    const { cart, sourceId, customerEmail, customerName, shippingAddress, fulfillmentType } = JSON.parse(event.body || '{}');

    // Validate required fields
    if (!cart || !Array.isArray(cart) || cart.length === 0) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Cart is empty' }) };
    }

    if (!sourceId) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Payment source required' }) };
    }

    // Email validation (Fix #6)
    const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
    if (customerEmail && !EMAIL_RE.test(String(customerEmail).trim())) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid email address' }) };
    }

    // Shipping address validation (Fix #18)
    if (fulfillmentType === 'shipping') {
      if (!shippingAddress || typeof shippingAddress !== 'object') {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Shipping address is required for shipping orders' }) };
      }
      const { line1, city, state, zip } = shippingAddress;
      if (!line1 || !String(line1).trim()) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Shipping address line 1 is required' }) };
      }
      if (!city || !String(city).trim()) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Shipping city is required' }) };
      }
      if (!state || !String(state).trim()) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Shipping state is required' }) };
      }
      if (!zip || !/^\d{5}(-\d{4})?$/.test(String(zip).trim())) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'A valid ZIP code is required for shipping' }) };
      }
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

      const qty = Math.min(20, Math.max(1, parseInt(item.quantity) || 1));
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

    // ── ATOMIC pre-charge stock reservation ─────────────────────
    // Strategy: Reserve (decrement) stock BEFORE charging the card.
    // The Postgres UPDATE … WHERE stock_quantity >= qty acquires a
    // row-level lock, so concurrent requests serialise automatically.
    // If anything fails later we call rollback_merch_stock to restock.
    //
    // NULL stock_quantity = unlimited (print-on-demand / digital) — skipped.
    const reservedItems = []; // Track what we reserved so we can rollback

    for (const item of cart) {
      const product = (dbProducts || []).find(p => p.id === item.id || p.name === item.name);
      if (!product) continue;

      // Fetch current stock_quantity for this product
      const { data: stockRow } = await supabase
        .from('merch_products')
        .select('stock_quantity')
        .eq('id', product.id)
        .single();

      // NULL = unlimited — no reservation needed
      if (!stockRow || stockRow.stock_quantity === null) continue;

      const requestedQty = Math.min(20, Math.max(1, parseInt(item.quantity) || 1));

      // Atomic reserve: decrements stock only if enough is available
      const { data: reserved, error: reserveErr } = await supabase
        .rpc('reserve_merch_stock', { p_product_id: product.id, p_quantity: requestedQty });

      if (reserveErr || !reserved || reserved.length === 0) {
        // Insufficient stock — rollback any previously reserved items
        for (const r of reservedItems) {
          await supabase.rpc('rollback_merch_stock', {
            p_product_id: r.productId,
            p_quantity: r.quantity,
          }).catch(e => console.error('[MERCH-PAY] Rollback failed during stock rejection:', e.message));
        }

        const displayName = item.name || item.id;
        const available = stockRow.stock_quantity;
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({
            error: available <= 0
              ? `${displayName} is out of stock.`
              : `Only ${available} of ${displayName} available (you requested ${requestedQty}).`,
          }),
        };
      }

      reservedItems.push({ productId: product.id, quantity: requestedQty });
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
    let payment;
    try {
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

      payment = paymentResponse.result?.payment;

      if (!payment || payment.status === 'FAILED') {
        console.error('Payment failed:', paymentResponse);
        // Rollback reserved stock — card was NOT charged
        for (const r of reservedItems) {
          await supabase.rpc('rollback_merch_stock', {
            p_product_id: r.productId,
            p_quantity: r.quantity,
          }).catch(e => console.error('[MERCH-PAY] Rollback failed after payment decline:', e.message));
        }
        return { 
          statusCode: 400, 
          headers, 
          body: JSON.stringify({ error: 'Payment failed. Please try again.' }) 
        };
      }
    } catch (squareErr) {
      // Square threw — rollback reserved stock
      for (const r of reservedItems) {
        await supabase.rpc('rollback_merch_stock', {
          p_product_id: r.productId,
          p_quantity: r.quantity,
        }).catch(e => console.error('[MERCH-PAY] Rollback failed after Square error:', e.message));
      }
      throw squareErr; // re-throw so outer catch returns 400/500
    }

    // Store order in Supabase — let Postgres auto-generate the UUID primary key.
    // The MERCH-* reference string goes into square_order_id for traceability.
    const orderStatus = payment.status === 'COMPLETED' ? 'paid' : 'pending';
    const orderData = {
      type: 'merch',
      status: orderStatus,
      total_amount_cents: totalCents,
      payment_id: payment.id,
      square_order_id: referenceId,
      customer_email: customerEmail || null,
      customer_name: customerName || null,
      shipping_address: shippingAddress || null,
      fulfillment_type: (fulfillmentType === 'shipping' || fulfillmentType === 'pickup') ? fulfillmentType : 'pickup',
      items: lineItems.map(i => ({ name: i.name, quantity: parseInt(i.quantity), price_cents: Number(i.basePriceMoney.amount) })),
      created_at: new Date().toISOString(),
    };

    const { data: insertedOrder, error: insertErr } = await supabase
      .from('orders')
      .insert(orderData)
      .select('id')
      .single();

    if (insertErr || !insertedOrder) {
      // CRITICAL: Payment succeeded but DB insert failed.
      // 1. Rollback reserved stock
      for (const r of reservedItems) {
        await supabase.rpc('rollback_merch_stock', {
          p_product_id: r.productId,
          p_quantity: r.quantity,
        }).catch(e => console.error('[MERCH-PAY] Rollback failed after DB insert error:', e.message));
      }
      // 2. Refund the Square payment so the customer isn't silently charged
      try {
        await square.refunds.refundPayment({
          idempotencyKey: `refund-${payment.id}`,
          paymentId: payment.id,
          amountMoney: { amount: BigInt(totalCents), currency: 'USD' },
          reason: 'Automatic refund: order recording failed after payment',
        });
        console.error(`[CRITICAL] Payment ${payment.id} refunded after DB insert failure: ${insertErr?.message}`);
      } catch (refundErr) {
        // If the refund also fails, log everything needed for manual reconciliation
        console.error(`[CRITICAL-UNRECOVERABLE] Payment ${payment.id} charged but refund ALSO failed. Manual action required.`, refundErr.message);
      }

      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ 
          error: "Payment has been reversed. Please try again or contact info@brewhubphl.com."
        })
      };
    }

    // Stock was already reserved atomically before charging.
    // No additional decrement needed.

    const newOrderId = insertedOrder.id;

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        orderId: newOrderId,
        paymentId: payment.id,
        status: payment.status,
        orderStatus,
        confirmed: payment.status === 'COMPLETED',
        finality: payment.status === 'COMPLETED' ? 'confirmed' : 'pending_confirmation',
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
