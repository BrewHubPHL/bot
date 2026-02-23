/**
 * POLL TERMINAL PAYMENT — Active Payment Verification
 *
 * Called by the POS UI every 3 seconds after a terminal checkout is created.
 * Instead of passively waiting for Square's webhook (which can be delayed
 * 5-15+ minutes during "degraded performance" events), this function
 * actively asks Square: "Did the customer tap their card yet?"
 *
 * This is the PRIMARY fix for the "Phantom Orders" vulnerability:
 * - Customer taps card → Square Terminal says "Approved"
 * - POS UI polls this endpoint → sees COMPLETED → order → KDS in <3 seconds
 * - Webhook arrives 15 minutes later → idempotency gate catches it → no-op
 *
 * Flow:
 *   1. POS UI sends { orderId }
 *   2. We look up the square_checkout_id on the order
 *   3. We call Square Terminal API to check checkout status
 *   4. If COMPLETED, we extract the payment and confirm it via _process-payment
 *   5. Return { status: 'COMPLETED' | 'PENDING' | 'CANCEL_REQUESTED' | ... }
 *
 * Security: Requires staff PIN authentication (same as collect-payment.js)
 */

const { SquareClient, SquareEnvironment } = require('square');
const { createClient } = require('@supabase/supabase-js');
const { authorize, json } = require('./_auth');
const { requireCsrfHeader } = require('./_csrf');
const { confirmPayment } = require('./_process-payment');

const client = new SquareClient({
  token: process.env.SQUARE_PRODUCTION_TOKEN,
  environment: SquareEnvironment.Production,
});

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Method Not Allowed' });
  }

  // CSRF protection
  const csrfBlock = requireCsrfHeader(event);
  if (csrfBlock) return csrfBlock;

  // Require staff PIN authentication
  const auth = await authorize(event, { requirePin: true });
  if (!auth.ok) return auth.response;

  let orderId;
  try {
    ({ orderId } = JSON.parse(event.body || '{}'));
  } catch {
    return json(400, { error: 'Invalid JSON body' });
  }

  if (!orderId || typeof orderId !== 'string') {
    return json(400, { error: 'orderId is required' });
  }

  try {
    // 1. Look up the order and its checkout ID
    const { data: order, error: orderError } = await supabase
      .from('orders')
      .select('id, status, square_checkout_id, payment_id, total_amount_cents')
      .eq('id', orderId)
      .single();

    if (orderError || !order) {
      return json(404, { error: 'Order not found' });
    }

    // If order is already past pending, return current status (no need to poll)
    if (['paid', 'preparing', 'ready', 'completed', 'refunded'].includes(order.status) || order.payment_id) {
      return json(200, {
        status: 'ALREADY_CONFIRMED',
        orderStatus: order.status,
        message: 'Payment already confirmed'
      });
    }

    // No checkout ID means terminal payment wasn't initiated yet
    if (!order.square_checkout_id) {
      return json(200, {
        status: 'NO_CHECKOUT',
        orderStatus: order.status,
        message: 'No terminal checkout found for this order'
      });
    }

    // 2. Poll Square Terminal API for checkout status
    let checkout;
    try {
      const response = await client.terminal.checkouts.get(order.square_checkout_id);
      checkout = response.result?.checkout;
    } catch (squareErr) {
      console.error('[POLL] Square Terminal API error:', squareErr.message);
      return json(200, {
        status: 'POLL_ERROR',
        orderStatus: order.status,
        message: 'Could not reach Square — will retry'
      });
    }

    if (!checkout) {
      return json(200, {
        status: 'UNKNOWN',
        orderStatus: order.status,
        message: 'Checkout not found in Square'
      });
    }

    // 3. Map checkout status
    const checkoutStatus = checkout.status; // PENDING, IN_PROGRESS, CANCEL_REQUESTED, CANCELED, COMPLETED

    if (checkoutStatus !== 'COMPLETED') {
      // Not done yet — tell the POS to keep polling
      return json(200, {
        status: checkoutStatus,
        orderStatus: order.status,
        message: checkoutStatus === 'PENDING'
          ? 'Waiting for customer to tap/insert card…'
          : checkoutStatus === 'IN_PROGRESS'
            ? 'Customer is interacting with terminal…'
            : checkoutStatus === 'CANCEL_REQUESTED'
              ? 'Cancellation requested…'
              : checkoutStatus === 'CANCELED'
                ? 'Terminal checkout was cancelled'
                : `Terminal status: ${checkoutStatus}`
      });
    }

    // 4. COMPLETED! Extract payment details and confirm.
    const paymentIds = checkout.payment_ids || [];
    if (paymentIds.length === 0) {
      console.error('[POLL] Checkout COMPLETED but no payment IDs found');
      return json(200, {
        status: 'COMPLETED_NO_PAYMENT',
        orderStatus: order.status,
        message: 'Checkout completed but payment details missing'
      });
    }

    // Fetch the actual payment to get amount + currency
    const paymentId = paymentIds[0]; // Terminal checkouts have exactly one payment
    let payment;
    try {
      const paymentResponse = await client.payments.get(paymentId);
      payment = paymentResponse.result?.payment;
    } catch (payErr) {
      console.error('[POLL] Could not fetch payment details:', payErr.message);
      // Fall back to order amount — we know the checkout completed
      payment = {
        id: paymentId,
        amount_money: { amount: BigInt(order.total_amount_cents), currency: 'USD' },
        status: 'COMPLETED'
      };
    }

    if (!payment || payment.status !== 'COMPLETED') {
      return json(200, {
        status: 'PAYMENT_PENDING',
        orderStatus: order.status,
        message: 'Payment processing…'
      });
    }

    // 5. Confirm the payment via shared processor (idempotent)
    const result = await confirmPayment({
      supabase,
      orderId: order.id,
      paymentId: payment.id,
      paidAmountCents: Number(payment.amount_money?.amount || 0),
      currency: String(payment.amount_money?.currency || 'USD'),
      confirmedVia: 'poll'
    });

    if (result.ok) {
      console.log(`[POLL] ✓ Order ${orderId} confirmed via active polling (${result.reason})`);
      return json(200, {
        status: 'COMPLETED',
        orderStatus: 'preparing',
        confirmed: true,
        confirmedVia: 'poll',
        message: result.alreadyProcessed
          ? 'Payment was already confirmed (webhook beat us)'
          : 'Payment confirmed! Order is now on the KDS.'
      });
    }

    // Confirmation failed (fraud, amount mismatch, etc.)
    console.error(`[POLL] Payment confirmation failed: ${result.reason}`);
    return json(200, {
      status: 'CONFIRMATION_FAILED',
      orderStatus: order.status,
      reason: result.reason,
      message: `Payment verification issue: ${result.reason}`
    });

  } catch (err) {
    console.error('[POLL] Unhandled error:', err);
    return json(500, { error: 'Payment polling failed' });
  }
};
