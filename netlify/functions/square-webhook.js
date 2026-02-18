const { createClient } = require('@supabase/supabase-js');
const { SquareClient, SquareEnvironment } = require('square');
const QRCode = require('qrcode');
const crypto = require('crypto');

// 1. Initialize Clients
const supabaseUrl = process.env.SUPABASE_URL;
const supabase = createClient(supabaseUrl, process.env.SUPABASE_SERVICE_ROLE_KEY);

const client = new SquareClient({
  token: process.env.SQUARE_PRODUCTION_TOKEN,
  environment: SquareEnvironment.Production,
});

// Helper: Generate unique voucher codes like BRW-K8L9P2
const generateVoucherCode = () => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // No 'I' or '1' to avoid confusion
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return `BRW-${code}`;
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
  const rawBody = event.body || '';

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
  const REPLAY_WINDOW_MS = 5 * 60 * 1000;
  const squareTimestamp = event.headers['x-square-hmacsha256-signature-timestamp'] || 
                          event.headers['x-square-timestamp'];
  
  if (squareTimestamp) {
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
  }

  // ---------------------------------------------------------------------------
  // PHASE 2: EVENT ROUTING
  // ---------------------------------------------------------------------------
  let body;
  try {
    body = JSON.parse(rawBody);
  } catch (e) {
    console.error('[ERROR] Failed to parse webhook JSON:', e.message);
    return { statusCode: 400, body: 'Invalid JSON' };
  }

  console.log(`[WEBHOOK] Received event type: ${body.type}`);

  // ROUTE A: REFUNDS (The "Loyalty Loophole" Fix)
  if (body.type === 'refund.created') {
    return handleRefund(body, supabase);
  }

  // ROUTE B: PAYMENTS (The "Happy Path")
  if (body.type === 'payment.updated') {
    return handlePaymentUpdate(body, supabase);
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

  if (!paymentId) {
    return { statusCode: 200, body: "No payment ID in refund event" };
  }

  try {
    // 1. Find the original order
    const { data: order, error: findError } = await supabase
      .from('orders')
      .select('id, user_id, status')
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

    // 4. Revoke Loyalty Points via RPC
    if (order.user_id) {
       // We use a dedicated RPC function to safely decrement without going below zero
       const { error: rpcError } = await supabase.rpc('decrement_loyalty_on_refund', { 
         target_user_id: order.user_id 
       });
       
       if (rpcError) {
         console.error('[REFUND] Failed to revoke points:', rpcError);
       } else {
         console.log(`[REFUND] Points revoked for user ${order.user_id}`);
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

    // 6. Release Lock
    await supabase.from('refund_locks').delete().eq('payment_id', paymentId);
    
    return { statusCode: 200, body: "Refund processed: Points & Voucher revoked." };

  } catch (err) {
    console.error('[REFUND ERROR]', err);
    return { statusCode: 500, body: "Refund processing failed" };
  }
}

// ---------------------------------------------------------------------------
// PHASE 4: PAYMENT HANDLER (Deep Logic)
// ---------------------------------------------------------------------------
async function handlePaymentUpdate(body, supabase) {
  const payment = body.data?.object?.payment;
  
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

  // 2. ATOMIC IDEMPOTENCY: The "First Writer Wins" Lock
  // We try to insert into 'processed_webhooks'. If it fails (duplicate), we stop.
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
    if (idempotencyError.code === '23505') { // Postgres unique_violation
      console.warn(`[IDEMPOTENCY] Payment ${payment.id} already processed. Skipping.`);
      return { statusCode: 200, body: "Duplicate webhook ignored" };
    }
    console.error('[IDEMPOTENCY] Database error:', idempotencyError);
    return { statusCode: 500, body: 'Idempotency check failed' };
  }

  // 3. Look up the order in Supabase
  const { data: order, error: orderError } = await supabase
    .from('orders')
    .select('user_id, total_amount_cents, status, payment_id, customer_email')
    .eq('id', orderId)
    .single();

  if (orderError || !order) {
    console.error("[DB ERROR] Order lookup failed:", orderError);
    return { statusCode: 500, body: "Could not link Square payment to Supabase user" };
  }

  // 4. FRAUD DETECTION BLOCK
  
  // Check A: Is order already paid?
  if (order.status === 'paid' || order.payment_id) {
    console.warn(`[FRAUD] Order ${orderId} is already marked paid.`);
    return { statusCode: 200, body: "Order already processed" };
  }

  // Check B: Was this payment ID already used on ANOTHER order?
  const { data: existingPayment } = await supabase
    .from('orders')
    .select('id')
    .eq('payment_id', payment.id)
    .single();
  
  if (existingPayment) {
    console.error(`[FRAUD] Payment ${payment.id} is being reused!`);
    return { statusCode: 200, body: "Payment reuse detected" };
  }

  // Check C: Amount Validation (Allow 1% tolerance for tax rounding)
  const paidAmount = Number(payment.amount_money?.amount || 0);
  const expectedAmount = order.total_amount_cents || 0;
  const tolerance = Math.max(1, Math.floor(expectedAmount * 0.01));
  
  if (Math.abs(paidAmount - expectedAmount) > tolerance) {
     console.error(`[FRAUD] Amount mismatch: Expected ${expectedAmount}, Got ${paidAmount}`);
     // Flag it but don't fail the webhook, as money moved.
     await supabase.from('orders').update({ 
       status: 'amount_mismatch',
       notes: `Paid: ${paidAmount}, Expected: ${expectedAmount}`
     }).eq('id', orderId);
     return { statusCode: 200, body: "Flagged for review" };
  }

  // Check D: Currency Check
  if (payment.amount_money?.currency !== 'USD') {
    console.error(`[FRAUD] Invalid currency: ${payment.amount_money?.currency}`);
    return { statusCode: 200, body: "Invalid currency" };
  }

  // 5. Update Order Status
  const { error: updateError } = await supabase
    .from('orders')
    .update({ 
      status: 'paid',
      payment_id: payment.id,
      paid_at: new Date().toISOString()
    })
    .eq('id', orderId);

  if (updateError) {
    console.error("[DB ERROR] Failed to update order:", updateError);
    return { statusCode: 500, body: "DB Update Failed" };
  }

  // 6. LOYALTY & VOUCHER ENGINE
  const userId = order.user_id;
  if (!userId) {
     console.log(`[INFO] Guest checkout for order ${orderId}. No loyalty points awarded.`);
     return { statusCode: 200, body: "Guest checkout processed" };
  }

  // Call the "Atomic Increment" RPC function
  const { data: loyaltyResult, error: loyaltyError } = await supabase.rpc('increment_loyalty', { 
    target_user_id: userId,
    amount_cents: paidAmount,
    p_order_id: orderId
  });

  if (loyaltyError) {
    console.error("[LOYALTY ERROR]", loyaltyError);
  } else if (loyaltyResult && loyaltyResult.length > 0) {
    const { loyalty_points, voucher_earned } = loyaltyResult[0];
    
    console.log(`[LOYALTY] User ${userId} now has ${loyalty_points} points.`);

    if (voucher_earned) {
      console.log(`[LOYALTY] Threshold reached! Generating voucher...`);
      
      try {
        const newVoucherCode = generateVoucherCode();
        
        // Generate QR Code
        const qrDataUrl = await QRCode.toDataURL(newVoucherCode, {
          color: { dark: '#000000', light: '#FFFFFF' },
          width: 300,
          margin: 2
        });
        
        // Save Voucher to DB
        await supabase.from('vouchers').insert([{ 
          user_id: userId, 
          code: newVoucherCode,
          qr_code_base64: qrDataUrl,
          status: 'active',
          created_at: new Date().toISOString()
        }]);

        console.log(`[VOUCHER] Generated ${newVoucherCode} for user ${userId}`);
      } catch (qrError) {
        console.error("[QR ERROR] Failed to generate voucher:", qrError);
      }
    }
  }

  return { statusCode: 200, body: JSON.stringify({ success: true, orderId }) };
}