const { SquareClient, SquareEnvironment } = require('square');
const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');
const { authorize } = require('./_auth');
const { requireCsrfHeader } = require('./_csrf');

// Minimal sanitizer for logs
const _truncate = (s, n = 200) => { try { return String(s).slice(0, n); } catch { return ''; } };


exports.handler = async (event) => {
  // Check for POST request
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  // CSRF protection
  const csrfBlock = requireCsrfHeader(event);
  if (csrfBlock) return csrfBlock;

  // Require staff authentication for terminal checkout
  const auth = await authorize(event, { requirePin: true });
  if (!auth.ok) return auth.response;

  // Fail-closed env checks and per-request clients
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const SQUARE_PRODUCTION_TOKEN = process.env.SQUARE_PRODUCTION_TOKEN;
  const SQUARE_LOCATION_ID = process.env.SQUARE_LOCATION_ID;
  const MAX_CHARGE_CENTS = parseInt(process.env.MAX_CHARGE_CENTS || '200000', 10);
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !SQUARE_PRODUCTION_TOKEN || !SQUARE_LOCATION_ID) {
    console.error('collect-payment: missing required envs');
    return { statusCode: 500, body: JSON.stringify({ error: 'Server misconfigured' }) };
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const client = new SquareClient({ token: SQUARE_PRODUCTION_TOKEN, environment: SquareEnvironment.Production });

  let orderId, deviceId, clientIdempotencyKey;
  try {
    ({ orderId, deviceId, idempotencyKey: clientIdempotencyKey } = JSON.parse(event.body || '{}'));
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON body' }) };
  }

  if (!orderId) {
    return { statusCode: 400, body: JSON.stringify({ error: 'orderId is required' }) };
  }

  try {
    // 3. Fetch the order details from Supabase
    const { data: order, error: orderError } = await supabase
      .from('orders')
      .select('total_amount_cents, status')
      .eq('id', orderId)
      .single();

    if (orderError || !order) {
      console.error('Order lookup failed:', orderError);
      return { statusCode: 404, body: JSON.stringify({ error: 'Order not found' }) };
    }

    // 4. Prevent double-charging — only pending orders can be sent to terminal
    const POST_PAYMENT_STATUSES = ['paid', 'preparing', 'ready', 'completed', 'refunded', 'cancelled'];
    if (POST_PAYMENT_STATUSES.includes(order.status)) {
      return { statusCode: 409, body: JSON.stringify({ error: `Order already ${order.status} — cannot charge again` }) };
    }

    let amount = Number(order.total_amount_cents || 0);
    if (!Number.isFinite(amount) || !Number.isInteger(amount) || amount <= 0) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Order total is invalid' }) };
    }
    // Clamp to a safe maximum to avoid accidental huge charges
    if (amount > MAX_CHARGE_CENTS) {
      console.warn('collect-payment: amount clamped from', amount, 'to', MAX_CHARGE_CENTS);
      amount = MAX_CHARGE_CENTS;
    }

    // 5. Use provided deviceId, env var, or error if none configured
    const terminalDeviceId = deviceId || process.env.SQUARE_TERMINAL_DEVICE_ID;
    if (!terminalDeviceId) {
      return { statusCode: 400, body: JSON.stringify({ error: 'No Square Terminal device configured. Set SQUARE_TERMINAL_DEVICE_ID in Netlify.' }) };
    }

    // 6. Create Terminal Checkout
    // Idempotency key: the POS frontend generates a UUID per payment attempt
    // and reuses it across automatic network retries (same tap = same key).
    // On card-decline / user-initiated retry, the client sends a fresh key
    // so Square doesn't reject the new attempt.
    // If the client provides a key, we trust it exactly (trimmed to Square's
    // 128-char max).  An empty string is rejected — the frontend must own its
    // keys.  Only when the key is completely absent do we fall back to a
    // server-generated UUID (e.g. manual API testing).
    let idempotencyKey;
    if (clientIdempotencyKey != null) {
      // Key was provided — enforce non-empty
      if (typeof clientIdempotencyKey !== 'string' || clientIdempotencyKey.trim() === '') {
        return { statusCode: 400, body: JSON.stringify({ error: 'idempotencyKey must be a non-empty string when provided' }) };
      }
      idempotencyKey = clientIdempotencyKey.slice(0, 128); // Square max is 128
    } else {
      idempotencyKey = crypto.randomUUID();
    }

    // ── KEY REPLAY GUARD ──────────────────────────────────────────
    // Reject if this idempotency key was already used for a DIFFERENT
    // order. This prevents "Key Replay" attacks where an attacker
    // reuses a captured key to charge a different order.
    const { data: existingOrder, error: replayErr } = await supabase
      .from('orders')
      .select('id')
      .eq('last_idempotency_key', idempotencyKey)
      .neq('id', orderId)
      .maybeSingle();

    if (replayErr) {
      console.error('Idempotency replay check failed:', _truncate(replayErr.message));
      return { statusCode: 500, body: JSON.stringify({ error: 'Payment validation failed' }) };
    }
    if (existingOrder) {
      console.warn('[SECURITY] Key replay blocked: key already bound to order', _truncate(existingOrder.id));
      return { statusCode: 409, body: JSON.stringify({ error: 'Idempotency key already used for a different order' }) };
    }

    // Wrap SDK call with timeout to fail fast on upstream problems
    const withTimeout = (p, ms) => new Promise((resolve, reject) => {
      let done = false;
      const t = setTimeout(() => { if (!done) { done = true; reject(new Error('timeout')); } }, ms);
      p.then(r => { if (!done) { done = true; clearTimeout(t); resolve(r); } }).catch(e => { if (!done) { done = true; clearTimeout(t); reject(e); } });
    });

    const checkoutPromise = client.terminal.checkouts.create({
      checkout: {
        amountMoney: { amount: BigInt(amount), currency: 'USD' },
        locationId: SQUARE_LOCATION_ID,
        deviceOptions: { deviceId: terminalDeviceId, skipReceiptScreen: false, collectSignature: true },
        referenceId: orderId
      },
      idempotencyKey
    });

    const response = await withTimeout(checkoutPromise, 15_000);

    // ── WEBHOOK RESILIENCE: Store checkout ID for active polling ──
    // This is the critical link that enables poll-terminal-payment.js
    // and reconcile-pending-payments.js to verify payment status
    // WITHOUT depending on Square's webhook delivery.
    const checkoutId = response.result?.checkout?.id;
    if (checkoutId) {
      const { error: updateErr } = await supabase
        .from('orders')
        .update({ square_checkout_id: checkoutId, last_idempotency_key: idempotencyKey })
        .eq('id', orderId)
        .eq('status', 'pending');

      if (updateErr) {
        console.warn('[TERMINAL] Failed to store checkout ID (non-fatal):', _truncate(updateErr.message));
      }
    } else {
      // No checkout ID, but still bind the idempotency key to prevent replays
      const { error: keyErr } = await supabase
        .from('orders')
        .update({ last_idempotency_key: idempotencyKey })
        .eq('id', orderId)
        .eq('status', 'pending');

      if (keyErr) {
        console.warn('[TERMINAL] Failed to store idempotency key (non-fatal):', _truncate(keyErr.message));
      }
    }

    // Return minimal info; mask checkout id
    const masked = checkoutId ? `••••${String(checkoutId).slice(-6)}` : null;
    return {
      statusCode: 200,
      body: JSON.stringify({ message: 'Checkout created', checkout_id: masked })
    };

  } catch (error) {
    console.error("Terminal Error:", error);
    return { 
      statusCode: 500, 
      body: JSON.stringify({ error: "Failed to create terminal checkout" }) 
    };
  }
};