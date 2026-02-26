/**
 * _process-payment.js — Shared payment confirmation logic
 *
 * Extracted from square-webhook.js so that BOTH the webhook handler AND
 * the active polling/reconciliation paths can confirm payments identically.
 *
 * This eliminates the single-point-of-failure where KDS visibility depends
 * entirely on Square's webhook delivery — the "Phantom Orders" vulnerability.
 *
 * Callers:
 *   1. square-webhook.js      (push: Square fires payment.updated)
 *   2. poll-terminal-payment.js (pull: POS UI polls after terminal tap)
 *   3. reconcile-pending-payments.js (pull: scheduled cron sweeps stragglers)
 *
 * All three paths converge here with identical idempotency, fraud checks,
 * receipt generation, and loyalty/voucher processing.
 */

const QRCode = require('qrcode');
const crypto = require('crypto');
const { generateReceiptString, queueReceipt } = require('./_receipt');
const { logSystemError } = require('./_system-errors');

// ── Voucher helpers (identical to square-webhook.js) ────────────
const generateVoucherCode = () => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(12);
  let raw = '';
  for (let i = 0; i < 12; i++) {
    raw += chars.charAt(bytes[i] % chars.length);
  }
  return `BRW-${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}`;
};

const hashVoucherCode = (code) => {
  return crypto.createHash('sha256').update(code.toUpperCase()).digest('hex');
};

/**
 * Confirm a completed payment and transition the order to 'preparing'.
 *
 * This function is fully idempotent — safe to call multiple times for the
 * same payment (webhook + poll may both fire for the same event).
 *
 * @param {object} params
 * @param {object}  params.supabase       - Supabase service-role client
 * @param {string}  params.orderId        - BrewHub order UUID
 * @param {string}  params.paymentId      - Square payment ID
 * @param {number}  params.paidAmountCents - Amount paid in cents
 * @param {string}  params.currency       - Payment currency (e.g., 'USD')
 * @param {string}  params.confirmedVia   - How this was confirmed: 'webhook' | 'poll' | 'reconciliation'
 * @returns {Promise<{ ok: boolean, reason: string, alreadyProcessed?: boolean }>}
 */
async function confirmPayment({ supabase, orderId, paymentId, paidAmountCents, currency, confirmedVia }) {
  const tag = `[PAYMENT:${confirmedVia.toUpperCase()}]`;

  // ── 1. Per-payment idempotency guard ──────────────────────
  // Uses the same processed_webhooks table as the webhook handler.
  // If the webhook already processed this payment, we bail cleanly.
  const eventKey = `square:payment.confirmed:${paymentId}`;

  const { error: idempotencyError } = await supabase
    .from('processed_webhooks')
    .insert({
      event_key: eventKey,
      event_type: `payment.confirmed.${confirmedVia}`,
      source: confirmedVia,
      payload: { payment_id: paymentId, order_id: orderId, confirmed_via: confirmedVia }
    });

  if (idempotencyError) {
    if (idempotencyError.code === '23505') {
      console.log(`${tag} Payment ${paymentId} already confirmed. Skipping.`);
      return { ok: true, reason: 'already_processed', alreadyProcessed: true };
    }
    console.error(`${tag} Idempotency gate failed:`, idempotencyError?.message);
    return { ok: false, reason: 'idempotency_error' };
  }

  // ── 2. Look up the order ──────────────────────────────────
  const { data: order, error: orderError } = await supabase
    .from('orders')
    .select('user_id, total_amount_cents, status, payment_id, customer_email')
    .eq('id', orderId)
    .single();

  if (orderError || !order) {
    console.error(`${tag} Order ${orderId} not found:`, orderError?.message);
    // ── DEAD LETTER: Square paid but we can't find the order ───
    await logSystemError(supabase, {
      error_type: 'orphan_payment',
      severity: 'critical',
      source_function: `_process-payment:${confirmedVia}`,
      order_id: orderId,
      payment_id: paymentId,
      amount_cents: paidAmountCents,
      error_message: `Payment confirmed by Square but order not found in DB. Payment: ${paymentId}, Amount: $${(paidAmountCents / 100).toFixed(2)}`,
      context: { confirmed_via: confirmedVia, currency },
    });
    return { ok: false, reason: 'order_not_found' };
  }

  // ── 3. Fraud detection ────────────────────────────────────

  // 3a. Already paid?
  if (['paid', 'preparing', 'ready', 'completed', 'refunded'].includes(order.status) || order.payment_id) {
    console.warn(`${tag} Order ${orderId} already in status '${order.status}'. Skipping.`);
    return { ok: true, reason: 'already_paid', alreadyProcessed: true };
  }

  // 3b. Payment ID reuse on another order?
  const { data: existingPayment } = await supabase
    .from('orders')
    .select('id')
    .eq('payment_id', paymentId)
    .single();

  if (existingPayment) {
    console.error(`${tag} Payment ${paymentId} already used on order ${existingPayment.id}!`);
    return { ok: false, reason: 'payment_reuse' };
  }

  // 3c. Amount validation (2-cent tolerance for rounding)
  const expectedAmount = order.total_amount_cents || 0;
  const AMOUNT_TOLERANCE_CENTS = 2;

  if (Math.abs(paidAmountCents - expectedAmount) > AMOUNT_TOLERANCE_CENTS) {
    console.error(`${tag} Amount mismatch: expected ${expectedAmount}, got ${paidAmountCents}`);
    await supabase.from('orders').update({
      status: 'amount_mismatch',
      notes: `Paid: ${paidAmountCents}, Expected: ${expectedAmount}`
    }).eq('id', orderId);
    return { ok: false, reason: 'amount_mismatch' };
  }

  // 3d. Currency check
  if (currency !== 'USD') {
    console.error(`${tag} Invalid currency: ${currency}`);
    return { ok: false, reason: 'invalid_currency' };
  }

  // ── 4. Update order → preparing (show on KDS!) ────────────
  const { data: updatedRows, error: updateError } = await supabase
    .from('orders')
    .update({
      status: 'preparing',
      payment_id: paymentId,
      paid_at: new Date().toISOString(),
      paid_amount_cents: paidAmountCents,
      payment_confirmed_via: confirmedVia
    })
    .eq('id', orderId)
    .neq('status', 'paid')
    .neq('status', 'preparing')
    .neq('status', 'ready')
    .neq('status', 'completed')
    .select('id');

  if (!updateError && (!updatedRows || updatedRows.length === 0)) {
    console.warn(`${tag} Order ${orderId} already transitioned. Self-heal.`);
    return { ok: true, reason: 'self_heal', alreadyProcessed: true };
  }

  if (updateError) {
    console.error(`${tag} Order update failed:`, updateError?.message);
    // ── DEAD LETTER: Square paid but DB update failed ──────
    await logSystemError(supabase, {
      error_type: 'orphan_payment',
      severity: 'critical',
      source_function: `_process-payment:${confirmedVia}`,
      order_id: orderId,
      payment_id: paymentId,
      amount_cents: paidAmountCents,
      error_message: `Payment confirmed by Square but failed to update order status. DB error: ${updateError?.message}`,
      context: { confirmed_via: confirmedVia, order_status: order.status },
    });
    return { ok: false, reason: 'db_error' };
  }

  console.log(`${tag} ✓ Order ${orderId} → preparing (via ${confirmedVia})`);

  // ── 5. Receipt generation (non-fatal) ─────────────────────
  try {
    const { data: lineItems } = await supabase
      .from('coffee_orders')
      .select('drink_name, price')
      .eq('order_id', orderId);

    const { data: fullOrder } = await supabase
      .from('orders')
      .select('*')
      .eq('id', orderId)
      .single();

    if (fullOrder && lineItems) {
      const receiptText = generateReceiptString(fullOrder, lineItems);
      await queueReceipt(supabase, orderId, receiptText);
    }
  } catch (receiptErr) {
    console.error(`${tag} Receipt error (non-fatal):`, receiptErr?.message);
  }

  // ── 6. Loyalty & voucher engine ───────────────────────────
  const userId = order.user_id;
  if (!userId) {
    console.log(`${tag} Guest checkout for order ${orderId}. No loyalty.`);
    return { ok: true, reason: 'confirmed_guest' };
  }

  try {
    const { data: loyaltyResult, error: loyaltyError } = await supabase.rpc('increment_loyalty', {
      target_user_id: userId,
      amount_cents: paidAmountCents,
      p_order_id: orderId
    });

    if (loyaltyError) {
      console.error(`${tag} Loyalty RPC error:`, loyaltyError?.message);
    } else if (loyaltyResult && loyaltyResult.length > 0) {
      const { loyalty_points, voucher_earned } = loyaltyResult[0];
      console.log(`${tag} User ${userId} → ${loyalty_points} pts`);

      if (voucher_earned) {
        const newVoucherCode = generateVoucherCode();
        const codeHash = hashVoucherCode(newVoucherCode);
        const qrDataUrl = await QRCode.toDataURL(newVoucherCode, {
          color: { dark: '#000000', light: '#FFFFFF' },
          width: 300, margin: 2
        });

        // Store only the cryptographic hash + a masked preview; do not persist plaintext
        const masked = '****' + newVoucherCode.slice(-4);
        await supabase.from('vouchers').insert([{
          user_id: userId,
          code_hash: codeHash,
          masked_code: masked,
          qr_code_base64: qrDataUrl,
          status: 'active',
          created_at: new Date().toISOString()
        }]);

        console.log(`${tag} Voucher issued ${masked} → user ${userId}`);
      }
    }
  } catch (loyaltyErr) {
    console.error(`${tag} Loyalty processing error (non-fatal):`, loyaltyErr?.message);
  }

  return { ok: true, reason: 'confirmed' };
}

module.exports = { confirmPayment };
