const { createClient } = require('@supabase/supabase-js');
const { SquareClient, SquareEnvironment } = require('square');
const QRCode = require('qrcode');
const crypto = require('crypto');

const supabaseUrl = process.env.SUPABASE_URL;
const supabase = createClient(supabaseUrl, process.env.SUPABASE_SERVICE_ROLE_KEY);

const squareEnvironment = process.env.NODE_ENV === 'production'
  ? SquareEnvironment.Production
  : SquareEnvironment.Sandbox;

const squareToken = process.env.NODE_ENV === 'production'
  ? process.env.SQUARE_ACCESS_TOKEN
  : process.env.SQUARE_SANDBOX_TOKEN;

const square = new SquareClient({
  token: squareToken,
  environment: squareEnvironment,
});

// Generate unique voucher codes like BRW-K8L9P2
const generateVoucherCode = () => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // No 'I' or '1' to avoid confusion
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return `BRW-${code}`;
};

exports.handler = async (event) => {
  const signatureKey = process.env.SQUARE_WEBHOOK_SIGNATURE;
  const signatureHeader = event.headers['x-square-signature'];
  const rawBody = event.body || '';

  // HMAC signature verification is MANDATORY
  if (!signatureKey) {
    console.error('SQUARE_WEBHOOK_SIGNATURE env var is not set — rejecting all webhooks');
    return { statusCode: 500, body: JSON.stringify({ error: 'Webhook signature key not configured' }) };
  }

  if (!signatureHeader) {
    console.error('Missing x-square-signature header');
    return { statusCode: 401, body: JSON.stringify({ error: 'Missing signature' }) };
  }

  // ═══════════════════════════════════════════════════════════════════════
  // SECURITY: HMAC Replay Attack Prevention (Timestamp Validation)
  // ═══════════════════════════════════════════════════════════════════════
  // Square webhooks include a timestamp. If an attacker replays a valid
  // webhook with a valid signature but from the past, we reject it.
  // Window: 5 minutes (300 seconds) to account for network latency.
  // ═══════════════════════════════════════════════════════════════════════
  const REPLAY_WINDOW_MS = 5 * 60 * 1000; // 5 minutes
  const squareTimestamp = event.headers['x-square-hmacsha256-signature-timestamp'] || 
                          event.headers['x-square-timestamp'];
  
  if (squareTimestamp) {
    const webhookTime = parseInt(squareTimestamp, 10) * 1000; // Square sends Unix seconds
    const now = Date.now();
    const drift = Math.abs(now - webhookTime);
    
    if (isNaN(webhookTime)) {
      console.error('[REPLAY ATTACK?] Invalid timestamp format:', squareTimestamp);
      return { statusCode: 401, body: JSON.stringify({ error: 'Invalid timestamp' }) };
    }
    
    if (drift > REPLAY_WINDOW_MS) {
      console.error(`[REPLAY ATTACK] Timestamp too old/future: ${drift}ms drift (max: ${REPLAY_WINDOW_MS}ms)`);
      return { statusCode: 401, body: JSON.stringify({ error: 'Timestamp outside acceptable window' }) };
    }
    
    console.log(`[HMAC] Timestamp validated: ${drift}ms drift (within ${REPLAY_WINDOW_MS}ms window)`);
  } else {
    // Square may not always send timestamp header depending on API version
    // Log for monitoring but don't reject (fail-open for now, can tighten later)
    console.warn('[HMAC] No timestamp header present - replay protection limited');
  }

  const baseUrl = process.env.SQUARE_WEBHOOK_URL || process.env.URL;
  const notificationUrl = `${baseUrl}/.netlify/functions/square-webhook`;
  const payload = notificationUrl + rawBody;
  const digest = crypto
    .createHmac('sha256', signatureKey)
    .update(payload, 'utf8')
    .digest('base64');

  if (digest !== signatureHeader) {
    console.error('Invalid Square webhook signature');
    return { statusCode: 401, body: JSON.stringify({ error: 'Invalid signature' }) };
  }

  // SECURITY: Reject oversized payloads before parsing (prevents memory exhaustion)
  const MAX_PAYLOAD_SIZE = 100 * 1024; // 100KB max
  if (rawBody.length > MAX_PAYLOAD_SIZE) {
    console.error(`[SECURITY] Payload too large: ${rawBody.length} bytes`);
    return { statusCode: 413, body: JSON.stringify({ error: 'Payload too large' }) };
  }

  const body = JSON.parse(rawBody);

  // SECURITY: Truncate any string fields that could overflow database columns
  const sanitizeString = (str, maxLen = 500) => {
    if (typeof str !== 'string') return str;
    return str.length > maxLen ? str.substring(0, maxLen) + '...[TRUNCATED]' : str;
  };

  console.log('Square webhook received:', body.type);

  // --- SECURITY: Handle Refunds (The Loyalty Loophole Fix) ---
  if (body.type === 'refund.created') {
    console.log('Processing Refund Event...');
    const refund = body.data?.object?.refund;
    const paymentId = refund?.payment_id;

    if (!paymentId) {
       return { statusCode: 200, body: JSON.stringify({ message: "No payment ID in refund event" }) };
    }

    // 1. Find the original order to prevent point farming
    const { data: order, error: findError } = await supabase
      .from('orders')
      .select('id, user_id, status')
      .eq('payment_id', paymentId)
      .single();

    if (findError || !order) {
        console.warn(`[REFUND SKIP] Original order not found for payment ${paymentId}`);
        return { statusCode: 200, body: JSON.stringify({ message: "Order not linked" }) };
    }

    const userId = order.user_id;

    // TOCTOU FIX: Insert a refund lock FIRST to prevent concurrent voucher redemption
    // This must happen BEFORE we start modifying points/vouchers
    await supabase.from('refund_locks').upsert({ 
      payment_id: paymentId, 
      user_id: userId,
      locked_at: new Date().toISOString()
    }, { onConflict: 'payment_id' });
    console.log(`[REFUND LOCK] Created lock for payment ${paymentId}`);

    // 2. Mark order as refunded so it can't be "paid" again
    await supabase.from('orders').update({ status: 'refunded' }).eq('id', order.id);
    console.log(`[ORDER UPDATED] Order ${order.id} marked as refunded.`);

    // 3. Revoke Loyalty Points (SSoT: Supabase)
    // We assume 50 points per order. Use service_role to adjust user profile.
    if (userId) {
        const { data: profile } = await supabase
            .from('profiles')
            .select('loyalty_points')
            .eq('id', userId)
            .single();

        if (profile) {
            // Prevent negative points
            const newPoints = Math.max(0, (profile.loyalty_points || 0) - 50);
            
            const { error: revError } = await supabase
                .from('profiles')
                .update({ loyalty_points: newPoints })
                .eq('id', userId);
            
            if (!revError) {
                console.log(`[LOYALTY REVOKED] User ${userId}: ${profile.loyalty_points} -> ${newPoints} pts`);
            }
        }

        // 4. Kill the Voucher (The "Infinite Coffee" prevention)
        // If they farmed a voucher with this order, delete the most recent unused one.
        const { data: vouchers } = await supabase
            .from('vouchers')
            .select('id, code')
            .eq('user_id', userId)
            .eq('is_redeemed', false)
            .order('created_at', { ascending: false })
            .limit(1);

        if (vouchers && vouchers.length > 0) {
            const voucher = vouchers[0];
            await supabase.from('vouchers').delete().eq('id', voucher.id);
            console.log(`[VOUCHER REVOKED] Deleted farmed voucher: ${voucher.code}`);
        }
    }

    // Clean up the lock after processing
    await supabase.from('refund_locks').delete().eq('payment_id', paymentId);
    console.log(`[REFUND LOCK] Released lock for payment ${paymentId}`);
    
    return { statusCode: 200, body: JSON.stringify({ message: "Refund handled: Points & Voucher revoked." }) };
  }

  if (body.type !== 'payment.updated') {
    return { statusCode: 200, body: JSON.stringify({ skipped: body.type }) };
  }

  const payment = body.data?.object?.payment;
  if (!payment || payment.status !== 'COMPLETED') {
    return { statusCode: 200, body: JSON.stringify({ status: payment?.status || 'no payment' }) };
  }

  // 1. Get our internal Order ID from Square's reference_id
  const orderId = payment.reference_id;
  
  // Safety Check for Test Events or missing IDs
  if (!orderId || orderId === 'undefined') {
    console.log('⚠️ Skipping lookup: No valid reference_id found (likely a Test Event).');
    return { 
      statusCode: 200, 
      body: JSON.stringify({ message: "Test received successfully, no DB update needed." }) 
    };
  }

  console.log(`Processing payment for Order: ${orderId}`);

  // ===== ATOMIC IDEMPOTENCY: First Writer Wins =====
  // The UNIQUE constraint on event_key guarantees only ONE thread can proceed.
  // This MUST happen BEFORE any reads or writes to prevent race conditions.
  const eventKey = `square:payment.updated:${payment.id}`;
  
  const { error: idempotencyError } = await supabase
    .from('processed_webhooks')
    .insert({ 
      event_key: eventKey, 
      event_type: 'payment.updated',
      source: 'square',
      payload: { payment_id: payment.id, order_id: orderId }
    });

  if (idempotencyError) {
    if (idempotencyError.code === '23505') {
      // Unique constraint violation = already processed
      console.warn(`[IDEMPOTENCY] Payment ${payment.id} already processed (duplicate webhook).`);
      return { statusCode: 200, body: JSON.stringify({ message: "Duplicate webhook ignored" }) };
    }
    console.error('[IDEMPOTENCY] Insert failed:', idempotencyError);
    return { statusCode: 500, body: 'Idempotency check failed' };
  }

  console.log(`[IDEMPOTENCY] Claimed processing lock for payment ${payment.id}`);

  // 2. Look up the order in Supabase - get expected amount for validation
  const { data: order, error: orderError } = await supabase
    .from('orders')
    .select('user_id, total_amount_cents, status, payment_id, customer_email')
    .eq('id', orderId)
    .single();

  if (orderError || !order) {
    console.error("Order lookup failed:", orderError);
    return { statusCode: 500, body: "Could not link Square payment to Supabase user" };
  }

  // SECURITY: Validate timestamp integrity (prevents replay with backdated events)
  const createdAt = payment.created_at ? new Date(payment.created_at) : null;
  const updatedAt = payment.updated_at ? new Date(payment.updated_at) : null;
  
  if (createdAt && updatedAt && updatedAt < createdAt) {
    console.error(`[TIMESTAMP ANOMALY] updated_at (${updatedAt.toISOString()}) < created_at (${createdAt.toISOString()}) for order ${orderId}`);
    await supabase.from('orders').update({ 
      status: 'timestamp_review',
      notes: sanitizeString(`Timestamp anomaly: updated_at < created_at`, 255)
    }).eq('id', orderId);
    return { statusCode: 200, body: JSON.stringify({ flagged: 'timestamp_anomaly' }) };
  }

  // SECURITY: Cross-validate customer identity from Square matches order owner
  // Prevents attacker from pointing their payment at another user's order
  const squareCustomerId = payment.customer_id;
  const squareBuyerEmail = payment.buyer_email_address?.toLowerCase();
  
  // SECURITY: If order has email but Square payment doesn't, flag for review
  // This prevents bypassing identity check by stripping customer_details
  if (order.customer_email && !squareBuyerEmail) {
    console.warn(`[IDENTITY GAP] Order ${orderId} has email but Square payment lacks buyer_email_address`);
    // Allow to proceed but log - Square guest checkouts are valid
    // Only flag if this becomes a pattern (analytics can detect)
  }
  
  if (squareBuyerEmail && order.customer_email) {
    const orderEmail = order.customer_email.toLowerCase();
    if (squareBuyerEmail !== orderEmail) {
      console.error(`[FRAUD ALERT] Email mismatch: Square=${squareBuyerEmail}, Order=${orderEmail}`);
      await supabase.from('orders').update({ 
        status: 'fraud_review',
        notes: sanitizeString(`Customer mismatch: Payment from ${squareBuyerEmail}`, 255)
      }).eq('id', orderId);
      return { statusCode: 200, body: JSON.stringify({ flagged: 'customer_mismatch' }) };
    }
  }

  // DEFENSE-IN-DEPTH: Secondary checks (primary gate is processed_webhooks above)
  // These catch edge cases like manual DB edits or cross-order payment reuse attempts
  if (order.status === 'paid' || order.payment_id) {
    console.warn(`[DEFENSE] Order ${orderId} already paid. Payment ID: ${order.payment_id}`);
    return { statusCode: 200, body: JSON.stringify({ message: "Order already processed" }) };
  }

  // SECURITY: Block payment updates for refunded orders (prevents double-earn exploit)
  if (order.status === 'refunded') {
    console.error(`[FRAUD ALERT] Attempted payment update on refunded order ${orderId}`);
    return { statusCode: 200, body: JSON.stringify({ rejected: 'order_refunded' }) };
  }

  // FRAUD DETECTION: Check if this payment.id was already used for another order
  const { data: existingPayment } = await supabase
    .from('orders')
    .select('id')
    .eq('payment_id', payment.id)
    .single();
  
  if (existingPayment) {
    console.error(`[FRAUD ALERT] Payment ${payment.id} already used for order ${existingPayment.id}, attempted reuse on ${orderId}`);
    return { statusCode: 200, body: JSON.stringify({ message: "Payment already applied" }) };
  }

  // SECURITY: Verify payment amount matches expected order total
  const paidAmountCents = Number(payment.amount_money?.amount || 0);
  const expectedAmountCents = order.total_amount_cents || 0;
  const paymentCurrency = payment.amount_money?.currency;
  
  // SECURITY: Reject non-USD currencies (prevents currency confusion attacks)
  if (paymentCurrency && paymentCurrency !== 'USD') {
    console.error(`[CURRENCY ALERT] Non-USD payment: ${paymentCurrency} for order ${orderId}`);
    await supabase.from('orders').update({ 
      status: 'currency_review',
      notes: sanitizeString(`Non-USD currency: ${paymentCurrency}`, 255)
    }).eq('id', orderId);
    return { statusCode: 200, body: JSON.stringify({ flagged: 'non_usd_currency' }) };
  }
  
  // SECURITY: Reject negative or zero amounts
  if (paidAmountCents <= 0) {
    console.error(`[FRAUD ALERT] Negative/zero payment amount: ${paidAmountCents}¢ for order ${orderId}`);
    return { statusCode: 200, body: JSON.stringify({ rejected: 'invalid_amount' }) };
  }
  
  // Allow small variance for tax/rounding (1% tolerance)
  const tolerance = Math.max(1, Math.floor(expectedAmountCents * 0.01));
  const amountDiff = Math.abs(paidAmountCents - expectedAmountCents);
  
  if (amountDiff > tolerance) {
    console.error(`[AMOUNT MISMATCH] Order ${orderId}: Expected ${expectedAmountCents}¢, got ${paidAmountCents}¢`);
    // Don't reject - Square already charged. Flag for review instead.
    await supabase.from('orders').update({ 
      status: 'amount_mismatch',
      notes: sanitizeString(`Expected: ${expectedAmountCents}¢, Paid: ${paidAmountCents}¢`, 255)
    }).eq('id', orderId);
    return { statusCode: 200, body: JSON.stringify({ flagged: true }) };
  }

  const userId = order.user_id;

  // 3. Update the Order status to 'paid'
  const { error: updateError } = await supabase
    .from('orders')
    .update({ 
      status: 'paid',
      payment_id: payment.id 
    })
    .eq('id', orderId);

  if (updateError) {
    console.error("Failed to update order status:", updateError);
    return { statusCode: 500 };
  }

  // 4. Increment points using ATOMIC RPC (prevents read-modify-write race)
  // The RPC calculates points based on NET payment amount (1 point per $1)
  // This prevents "rounding error inflation" with partial refunds
  const { data: loyaltyResult, error: loyaltyError } = await supabase.rpc('increment_loyalty', { 
    target_user_id: userId,
    amount_cents: paidAmountCents,
    p_order_id: orderId
  });

  if (loyaltyError) {
    console.error("Loyalty increment failed:", loyaltyError);
  } else if (loyaltyResult && loyaltyResult.length > 0) {
    const { loyalty_points: newPoints, voucher_earned, points_awarded } = loyaltyResult[0];
    console.log(`[LOYALTY] User ${userId}: +${points_awarded} pts (now ${newPoints} total)`);
    
    if (voucher_earned) {
      // Voucher threshold crossed! Generate voucher code and QR
      console.log(`[LOYALTY] User ${userId} now has ${newPoints} points - VOUCHER EARNED!`);
      
      const newVoucherCode = generateVoucherCode();
      
      // Generate the QR Code as a Data URL (image string)
      const qrDataUrl = await QRCode.toDataURL(newVoucherCode, {
        color: {
          dark: '#000000',
          light: '#FFFFFF'
        },
        width: 300
      });
      
      const { error: voucherError } = await supabase
        .from('vouchers')
        .insert([{ 
          user_id: userId, 
          code: newVoucherCode,
          qr_code_base64: qrDataUrl
        }]);

      if (voucherError) {
        console.error("Voucher creation failed:", voucherError);
      } else {
        console.log(`[VOUCHER + QR GENERATED] Code ${newVoucherCode} is ready for scanning.`);
      }
      
      console.log(`VIP Alert: User ${userId} earned a free coffee!`);
      // This is where ElevenLabs can shout it out
    }
  }

  // 5. Decrement inventory - derive quantities from Square line items
  let cupCount = 0;
  let beanCount = 0;
  let lineItems = [];

  if (payment.order_id) {
    try {
      const { result } = await square.ordersApi.retrieveOrder(payment.order_id);
      lineItems = result?.order?.lineItems || [];
    } catch (err) {
      console.error('Square order lookup failed:', err);
    }
  }

  if (lineItems.length > 0) {
    for (const item of lineItems) {
      const name = (item?.name || '').toLowerCase();
      const quantity = Number(item?.quantity || 0);

      if (name.includes('whole bean') || name.includes('beans')) {
        beanCount += quantity || 0;
      } else {
        cupCount += quantity || 0;
      }
    }
  }

  if (cupCount === 0) {
    const { count, error: cupsError } = await supabase
      .from('coffee_orders')
      .select('id', { count: 'exact', head: true })
      .eq('order_id', orderId);

    if (cupsError) {
      console.error("Cup count lookup failed:", cupsError);
    } else if (typeof count === 'number' && count > 0) {
      cupCount = count;
    }
  }

  if (cupCount > 0) {
    const { error: inventoryError } = await supabase.rpc('decrement_inventory', { 
      item: '12oz Cups', 
      amount: cupCount 
    });

    if (inventoryError) {
      console.error("Inventory decrement failed:", inventoryError);
    } else {
      console.log(`[INVENTORY] Decremented 12oz Cups by ${cupCount}`);
    }
  }

  // 6. If it's a bulk bean sale, decrement beans too
  if (beanCount > 0) {
    await supabase.rpc('decrement_inventory', { 
      item: 'Espresso Beans', 
      amount: beanCount 
    });
    console.log(`[INVENTORY] Decremented Espresso Beans by ${beanCount}`);
  }

  return { statusCode: 200, body: JSON.stringify({ received: true }) };
};