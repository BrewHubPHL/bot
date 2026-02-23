const { createClient } = require('@supabase/supabase-js');
const { SquareClient, SquareEnvironment } = require('square');
const QRCode = require('qrcode');
const crypto = require('crypto');
const { generateReceiptString, queueReceipt } = require('./_receipt');

// 1. Initialize Clients
const supabaseUrl = process.env.SUPABASE_URL;
const supabase = createClient(supabaseUrl, process.env.SUPABASE_SERVICE_ROLE_KEY);

const client = new SquareClient({
  token: process.env.SQUARE_PRODUCTION_TOKEN,
  environment: SquareEnvironment.Production,
});

// Helper: Generate high-entropy voucher codes like BRW-K8L9-P2XW-7NHT
// 12 random bytes → 12 chars from a 32-char alphabet → 60 bits of entropy.
// Old format (BRW-XXXXXX, 6 chars) had only ~30 bits — brute-forceable.
const generateVoucherCode = () => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 32 chars (no I/1/O/0)
  const bytes = crypto.randomBytes(12);
  let raw = '';
  for (let i = 0; i < 12; i++) {
    raw += chars.charAt(bytes[i] % chars.length);
  }
  return `BRW-${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}`;
};

// Helper: SHA-256 hash of a voucher code (matches Postgres digest(upper(code),'sha256'))
const hashVoucherCode = (code) => {
  return crypto.createHash('sha256').update(code.toUpperCase()).digest('hex');
};

// Helper: Sanitize strings for logging/DB to prevent injection or massive logs
const sanitizeString = (str, maxLen = 500) => {
  if (typeof str !== 'string') return str;
  return str.length > maxLen ? str.substring(0, maxLen) + '...[TRUNCATED]' : str;
};

exports.handler = async (event) => {
  // ---------------------------------------------------------------------------
  // PHASE 1: SECURITY GATEKEEPING
  // ---------------------------------------------------------------------------
  const signatureKey = process.env.SQUARE_WEBHOOK_SIGNATURE;
  const signatureHeader = event.headers['x-square-signature'];
  
  // ── RAW BODY PRESERVATION ─────────────────────────────────
  // CRITICAL: Netlify may base64-encode the body. We MUST use the original
  // raw bytes for HMAC verification — parsing then re-serializing can alter
  // whitespace/key order and invalidate the signature.
  const rawBody = event.isBase64Encoded
    ? Buffer.from(event.body || '', 'base64').toString('utf8')
    : (event.body || '');

  // Critical: Fail if signature key is missing
  if (!signatureKey) {
    console.error('CRITICAL: SQUARE_WEBHOOK_SIGNATURE is not set in Netlify.');
    return { statusCode: 500, body: JSON.stringify({ error: 'Server misconfiguration' }) };
  }

  // Critical: Fail if request is unsigned
  if (!signatureHeader) {
    console.warn('[SECURITY] Rejecting unsigned webhook request.');
    return { statusCode: 401, body: JSON.stringify({ error: 'Missing signature' }) };
  }

  // Security: Payload Size Check (Prevent Memory Exhaustion DoS)
  const MAX_PAYLOAD_SIZE = 500 * 1024; // 500KB limit
  if (rawBody.length > MAX_PAYLOAD_SIZE) {
    console.error(`[SECURITY] Payload too large: ${rawBody.length} bytes`);
    return { statusCode: 413, body: JSON.stringify({ error: 'Payload too large' }) };
  }

  // Security: HMAC Verification
  const baseUrl = process.env.SQUARE_WEBHOOK_URL || 'https://brewhubphl.com'; 
  const notificationUrl = `${baseUrl}/.netlify/functions/square-webhook`;
  const payload = notificationUrl + rawBody;
  const digest = crypto
    .createHmac('sha256', signatureKey)
    .update(payload, 'utf8')
    .digest('base64');

  const digestBuf = Buffer.from(digest, 'base64');
  const sigBuf = Buffer.from(signatureHeader || '', 'base64');
  if (digestBuf.length !== sigBuf.length || !crypto.timingSafeEqual(digestBuf, sigBuf)) {
    console.error('[SECURITY] Invalid Square webhook signature. Potential spoofing attempt.');
    return { statusCode: 401, body: JSON.stringify({ error: 'Invalid signature' }) };
  }

  // Security: Replay Attack Protection (Timestamp Check)
  // Window: 5 minutes (300 seconds) to account for network latency.
  // MANDATORY: Square always sends a timestamp header. Rejecting requests
  // without one prevents replay attacks using stripped headers.
  const REPLAY_WINDOW_MS = 5 * 60 * 1000;
  const squareTimestamp = event.headers['x-square-hmacsha256-signature-timestamp'] || 
                          event.headers['x-square-timestamp'];
  
  if (!squareTimestamp) {
    console.error('[SECURITY] Rejecting webhook with missing timestamp header.');
    return { statusCode: 401, body: JSON.stringify({ error: 'Missing timestamp' }) };
  }

  const webhookTime = parseInt(squareTimestamp, 10) * 1000; // Square sends Unix seconds
  const now = Date.now();
  const drift = Math.abs(now - webhookTime);

  if (isNaN(webhookTime)) {
    console.error('[SECURITY] Invalid timestamp format received.');
    return { statusCode: 401, body: JSON.stringify({ error: 'Invalid timestamp' }) };
  }

  if (drift > REPLAY_WINDOW_MS) {
    console.error(`[SECURITY] Replay attack detected? Drift: ${drift}ms > ${REPLAY_WINDOW_MS}ms`);
    return { statusCode: 401, body: JSON.stringify({ error: 'Timestamp outside acceptable window' }) };
  }

  // ---------------------------------------------------------------------------
  // PHASE 2: ATOMIC IDEMPOTENCY LOCK  (First DB action after HMAC)
  // ---------------------------------------------------------------------------
  // Square sends `event_id` on every webhook. By inserting it into
  // processed_webhooks BEFORE doing ANY work, we guarantee at-most-once
  // execution without Redis. A unique-constraint violation (23505) means
  // this exact event was already handled — ack Square and bail.
  // ---------------------------------------------------------------------------
  let body;
  try {
    body = JSON.parse(rawBody);
  } catch (e) {
    console.error('[ERROR] Failed to parse webhook JSON:', e.message);
    return { statusCode: 400, body: 'Invalid JSON' };
  }

  const squareEventId = body.event_id; // Square's globally-unique event identifier
  if (!squareEventId || typeof squareEventId !== 'string') {
    console.error('[SECURITY] Webhook body missing event_id. Rejecting.');
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing event_id' }) };
  }

  // ── TOP-LEVEL IDEMPOTENCY GATE ────────────────────────────
  const globalEventKey = `square:${squareEventId}`;
  const { error: idempotencyGateError } = await supabase
    .from('processed_webhooks')
    .insert({
      event_key: globalEventKey,
      event_type: body.type || 'unknown',
      source: 'square',
      payload: { event_id: squareEventId }
    });

  if (idempotencyGateError) {
    if (idempotencyGateError.code === '23505') { // Postgres unique_violation
      console.warn(`[IDEMPOTENCY] Event ${squareEventId} already processed. Acking Square.`);
      return { statusCode: 200, body: 'Duplicate event ignored' };
    }
    // Transient DB error — tell Square to retry later
    console.error('[IDEMPOTENCY] Gate insert failed:', idempotencyGateError?.message);
    return { statusCode: 500, body: 'Idempotency check failed' };
  }

  console.log(`[WEBHOOK] Locked event ${squareEventId}, type: ${body.type}`);

  // ---------------------------------------------------------------------------
  // PHASE 3: EVENT ROUTING  (only reached after idempotency lock is secured)
  // Heavy work (loyalty, KDS, receipts) happens inside these handlers —
  // guaranteed to execute at most once per event_id.
  // ---------------------------------------------------------------------------

  // ROUTE A: REFUNDS (The "Loyalty Loophole" Fix)
  if (body.type === 'refund.created') {
    return handleRefund(body, supabase);
  }

  // ROUTE B: PAYMENTS (The "Happy Path")
  if (body.type === 'payment.updated') {
    return handlePaymentUpdate(body, supabase);
  }

  // ROUTE C: TERMINAL OFFLINE DECLINE (The "Ghost Revenue" Detection)
  // Square fires payment.created / payment.updated with status FAILED when
  // an offline-mode card batch is processed and a card declines.
  if (body.type === 'payment.created') {
    const payment = body.data?.object?.payment;
    if (payment && (payment.status === 'FAILED' || payment.status === 'CANCELED')) {
      return handleOfflineDecline(body, supabase);
    }
    // Non-failed payment.created events → ignore (we handle payment.updated)
    return { statusCode: 200, body: JSON.stringify({ message: 'Event noted' }) };
  }

  // Ignore other events
  return { statusCode: 200, body: JSON.stringify({ message: "Event ignored" }) };
};

// ---------------------------------------------------------------------------
// PHASE 3: REFUND HANDLER (Deep Logic)
// ---------------------------------------------------------------------------
async function handleRefund(body, supabase) {
  console.log('[REFUND] Processing refund event...');
  
  const refund = body.data?.object?.refund;
  const paymentId = refund?.payment_id;
  const refundId = refund?.id;
  // Extract the actual refund amount from Square's payload (in cents)
  const refundAmountCents = Number(refund?.amount_money?.amount || 0);

  if (!paymentId) {
    return { statusCode: 200, body: "No payment ID in refund event" };
  }

  // Defense-in-depth: per-resource idempotency (top-level gate already blocked duplicates)
  const eventKey = `square:refund.created:${refundId || paymentId}`;
  const { error: idempotencyError } = await supabase
    .from('processed_webhooks')
    .insert({
      event_key: eventKey,
      event_type: 'refund.created',
      source: 'square',
      payload: { refund_id: refundId, payment_id: paymentId }
    });

  if (idempotencyError) {
    if (idempotencyError.code === '23505') { // Postgres unique_violation
      console.warn(`[IDEMPOTENCY] Refund ${refundId || paymentId} already processed. Skipping.`);
      return { statusCode: 200, body: "Duplicate refund webhook ignored" };
    }
    console.error('[IDEMPOTENCY] Database error:', idempotencyError?.message);
    return { statusCode: 500, body: 'Idempotency check failed' };
  }

  try {
    // 1. Find the original order (include amounts for proportional loyalty revocation)
    const { data: order, error: findError } = await supabase
      .from('orders')
      .select('id, user_id, status, inventory_decremented, paid_amount_cents, total_amount_cents')
      .eq('payment_id', paymentId)
      .single();

    if (findError || !order) {
      console.warn(`[REFUND] Original order not found for payment ${paymentId}. Skipping.`);
      return { statusCode: 200, body: "Order not linked" };
    }

    // 2. Create a "Refund Lock" to prevent concurrent race conditions
    // This prevents a user from redeeming a voucher WHILE the refund is processing.
    await supabase.from('refund_locks').upsert({ 
      payment_id: paymentId, 
      user_id: order.user_id,
      locked_at: new Date().toISOString()
    }, { onConflict: 'payment_id' });

    // 3. Mark order as refunded
    await supabase
      .from('orders')
      .update({ status: 'refunded' })
      .eq('id', order.id);
    
    console.log(`[REFUND] Order ${order.id} marked as refunded.`);

    // 4. Revoke Loyalty Points via RPC — pass the ACTUAL refund amount
    //    Priority: Square refund amount > order paid_amount > order total
    //    This closes the buy/refund loyalty-farming loop where the old
    //    default of 500 cents under-revoked points on large orders.
    if (order.user_id) {
       const revokeAmountCents = refundAmountCents
         || order.paid_amount_cents
         || order.total_amount_cents
         || 0;

       const { data: revokeResult, error: rpcError } = await supabase.rpc('decrement_loyalty_on_refund', { 
         target_user_id: order.user_id,
         amount_cents: revokeAmountCents
       });
       
       if (rpcError) {
         console.error('[REFUND] Failed to revoke points:', rpcError?.message);
       } else {
         const deducted = revokeResult?.[0]?.points_deducted ?? revokeResult?.points_deducted ?? '?';
         console.log(`[REFUND] Points revoked for user ${order.user_id}: ${deducted} pts (from ${revokeAmountCents}¢)`);
       }

       // 5. Delete the most recent unused voucher (The "Infinite Coffee" prevention)
       const { data: vouchers } = await supabase
          .from('vouchers')
          .select('id, code')
          .eq('user_id', order.user_id)
          .eq('is_redeemed', false)
          .order('created_at', { ascending: false })
          .limit(1);

       if (vouchers && vouchers.length > 0) {
          const voucher = vouchers[0];
          await supabase.from('vouchers').delete().eq('id', voucher.id);
          console.log(`[REFUND] Revoked farmed voucher: ${voucher.code}`);
       }
    }

    // 6. RESTORE INVENTORY (The "Ghost Stock" fix)
    // If the order was completed and inventory was decremented, put it back.
    if (order.inventory_decremented) {
      const { data: restoreResult, error: restoreErr } = await supabase.rpc(
        'restore_inventory_on_refund',
        { p_order_id: order.id }
      );
      if (restoreErr) {
        console.error('[REFUND] Inventory restore RPC failed:', restoreErr?.message);
      } else {
        console.log('[REFUND] Inventory restored:', JSON.stringify(restoreResult));
      }
    }

    // 7. Release Lock
    await supabase.from('refund_locks').delete().eq('payment_id', paymentId);
    
    return { statusCode: 200, body: "Refund processed: Points revoked, inventory restored." };

  } catch (err) {
    console.error('[REFUND ERROR]', err?.message);
    return { statusCode: 500, body: "Refund processing failed" };
  }
}

// ---------------------------------------------------------------------------
// PHASE 4: PAYMENT HANDLER (Deep Logic)
// ---------------------------------------------------------------------------
// Delegates to the shared _process-payment.js helper so that webhook,
// active polling (poll-terminal-payment.js), and scheduled reconciliation
// (reconcile-pending-payments.js) all use identical confirmation logic.
// This eliminates the "Phantom Orders" single-point-of-failure where
// KDS visibility depended entirely on Square's webhook delivery.
// ---------------------------------------------------------------------------
async function handlePaymentUpdate(body, supabase) {
  const { confirmPayment } = require('./_process-payment');
  const payment = body.data?.object?.payment;
  
  // Detect FAILED payments — these are offline-batch declines (Ghost Revenue)
  if (payment && (payment.status === 'FAILED' || payment.status === 'CANCELED')) {
    return handleOfflineDecline(body, supabase);
  }

  // Filter: We only care about COMPLETED payments
  if (!payment || payment.status !== 'COMPLETED') {
    return { statusCode: 200, body: JSON.stringify({ status: payment?.status || 'no payment' }) };
  }

  // 1. Extract Order ID
  const orderId = payment.reference_id;
  
  // Safety Check: Ignore test events without Reference IDs
  if (!orderId || orderId === 'undefined') {
    console.log('[PAYMENT] Skipping event with no Reference ID (likely a dashboard test).');
    return { statusCode: 200, body: "Test received" };
  }

  console.log(`[PAYMENT] Processing Order: ${orderId}`);

  // 2. DEFENSE-IN-DEPTH: Per-payment idempotency guard (webhook-specific)
  // The top-level event_id gate already prevents duplicates, but this guards
  // against edge cases (manual retries with a fresh event_id for the same payment).
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
      console.warn(`[IDEMPOTENCY] Payment ${payment.id} already processed. Skipping.`);
      return { statusCode: 200, body: "Duplicate webhook ignored" };
    }
    console.error('[IDEMPOTENCY] Database error:', idempotencyError?.message);
    return { statusCode: 500, body: 'Idempotency check failed' };
  }

  // 3. Delegate to shared payment processor
  // This is the same code path that poll-terminal-payment.js and
  // reconcile-pending-payments.js use, ensuring identical behavior.
  const paidAmount = Number(payment.amount_money?.amount || 0);
  const currency = String(payment.amount_money?.currency || 'USD');

  const result = await confirmPayment({
    supabase,
    orderId,
    paymentId: payment.id,
    paidAmountCents: paidAmount,
    currency,
    confirmedVia: 'webhook'
  });

  if (result.ok) {
    console.log(`[PAYMENT:WEBHOOK] Order ${orderId} → ${result.reason}`);
    return { statusCode: 200, body: JSON.stringify({ success: true, orderId, reason: result.reason }) };
  }

  console.error(`[PAYMENT:WEBHOOK] Confirmation failed for ${orderId}: ${result.reason}`);
  // Return 200 to Square so it doesn't retry (the issue is on our end)
  return { statusCode: 200, body: JSON.stringify({ error: result.reason }) };
}

// ---------------------------------------------------------------------------
// PHASE 5: OFFLINE DECLINE HANDLER (Ghost Revenue Detection)
// ---------------------------------------------------------------------------
// When Square processes an offline-mode batch and a card declines, we get
// a payment.updated or payment.created with status FAILED/CANCELED.
// These represent real money lost — drinks were already given away.
// We record each decline in the offline_loss_ledger for tracking.
// ---------------------------------------------------------------------------
async function handleOfflineDecline(body, supabase) {
  const payment = body.data?.object?.payment;
  if (!payment) {
    return { statusCode: 200, body: 'No payment in decline event' };
  }

  const paymentId = payment.id;
  const orderId = payment.reference_id;
  const amountCents = Number(payment.amount_money?.amount || 0);
  const cardDetails = payment.card_details || {};
  const cardLast4 = cardDetails.card?.last_4 || null;
  const cardBrand = cardDetails.card?.card_brand || null;
  const declineReason = cardDetails.errors?.[0]?.code
    || payment.failure_reason
    || payment.status
    || 'unknown';

  console.error(
    `[GHOST-REVENUE] ⚠️ OFFLINE DECLINE DETECTED: $${(amountCents / 100).toFixed(2)}`,
    `| Card: ${cardBrand || '?'} ****${cardLast4 || '????'}`,
    `| Reason: ${declineReason}`,
    `| Order: ${orderId || 'unlinked'}`,
    `| Payment: ${paymentId}`
  );

  // Record in the loss ledger
  try {
    const { data: lossId, error: lossErr } = await supabase.rpc('record_offline_decline', {
      p_square_payment_id: paymentId,
      p_square_checkout_id: null,
      p_order_id: orderId || null,
      p_amount_cents: amountCents,
      p_decline_reason: sanitizeString(declineReason, 200),
      p_card_last_four: cardLast4,
      p_card_brand: cardBrand,
    });

    if (lossErr) {
      console.error('[GHOST-REVENUE] Failed to record decline:', lossErr.message);
    } else {
      console.log(`[GHOST-REVENUE] Recorded loss ${lossId}`);
    }
  } catch (err) {
    console.error('[GHOST-REVENUE] Exception recording decline:', err.message);
  }

  // If we have a linked order, mark it as failed
  if (orderId && orderId !== 'undefined') {
    try {
      await supabase
        .from('orders')
        .update({
          status: 'cancelled',
          notes: `Offline batch decline: ${declineReason} (${cardBrand || '?'} ****${cardLast4 || '????'})`,
        })
        .eq('id', orderId)
        .eq('status', 'pending');
    } catch (orderErr) {
      console.error('[GHOST-REVENUE] Failed to cancel declined order:', orderErr.message);
    }
  }

  return {
    statusCode: 200,
    body: JSON.stringify({
      processed: true,
      type: 'offline_decline',
      amount_cents: amountCents,
      decline_reason: declineReason,
    }),
  };
}