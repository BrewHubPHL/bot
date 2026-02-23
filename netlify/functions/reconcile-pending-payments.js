/**
 * RECONCILE PENDING PAYMENTS (Scheduled Cron — every 2 minutes)
 *
 * The ultimate safety net for the "Phantom Orders" vulnerability.
 * Even if:
 *   - Square's webhooks are delayed 15+ minutes
 *   - The POS UI crashed before it could poll
 *   - The staff member closed the browser tab
 *   - Netlify had a cold start during the webhook delivery
 *
 * This function will STILL catch the payment within 2 minutes.
 *
 * Algorithm:
 *   1. Find all orders in 'pending' status with a square_checkout_id
 *      that are older than 60 seconds (give the POS poll a chance first)
 *   2. For each, call Square Terminal API to check checkout status
 *   3. If COMPLETED, confirm payment via shared _process-payment helper
 *   4. If CANCELED by Square, mark order for staff attention
 *
 * This runs on Netlify Scheduled Functions (cron): every 2 minutes.
 * Configure in netlify.toml:
 *   [functions."reconcile-pending-payments"]
 *   schedule = "every-2-minutes"
 *
 * Security: scheduled invocations or CRON_SECRET header only.
 * Uses service role key (bypasses RLS). Max 30 runs per hour.
 */

const { SquareClient, SquareEnvironment } = require('square');
const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');
const { confirmPayment } = require('./_process-payment');

const client = new SquareClient({
  token: process.env.SQUARE_PRODUCTION_TOKEN,
  environment: SquareEnvironment.Production,
});

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Timing-safe secret comparison
function safeCompare(a, b) {
  if (!a || !b) return false;
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

// Maximum orders to reconcile per run (prevent runaway loops)
const MAX_RECONCILE_BATCH = 20;

// Only look at orders older than this (seconds) — give POS polling a head start
const MIN_AGE_SECONDS = 60;

// Don't bother with orders older than this (minutes) — they'll be handled
// by cancel-stale-orders or manual intervention
const MAX_AGE_MINUTES = 45;

exports.handler = async (event, context) => {
  // Only allow scheduled/cron invocations
  const isScheduled = context?.clientContext?.custom?.scheduled === true
    || event.headers?.['x-netlify-event'] === 'schedule';
  const hasCronSecret = safeCompare(
    event.headers?.['x-cron-secret'],
    process.env.CRON_SECRET
  );

  if (!isScheduled && !hasCronSecret) {
    return { statusCode: 403, body: JSON.stringify({ error: 'Forbidden' }) };
  }

  console.log('[RECONCILE] Starting pending payment reconciliation…');

  try {
    // 1. Find pending orders with a terminal checkout ID
    const cutoffRecent = new Date(Date.now() - MIN_AGE_SECONDS * 1000).toISOString();
    const cutoffOld = new Date(Date.now() - MAX_AGE_MINUTES * 60 * 1000).toISOString();

    const { data: pendingOrders, error: queryError } = await supabase
      .from('orders')
      .select('id, square_checkout_id, total_amount_cents, created_at')
      .eq('status', 'pending')
      .not('square_checkout_id', 'is', null)
      .is('payment_id', null)
      .lt('created_at', cutoffRecent)   // Older than 60s (give POS poll headroom)
      .gt('created_at', cutoffOld)      // Not ancient (those are stale)
      .order('created_at', { ascending: true })
      .limit(MAX_RECONCILE_BATCH);

    if (queryError) {
      console.error('[RECONCILE] Query error:', queryError.message);
      return { statusCode: 500, body: JSON.stringify({ error: 'Query failed' }) };
    }

    if (!pendingOrders || pendingOrders.length === 0) {
      console.log('[RECONCILE] No pending terminal orders to reconcile.');
      return {
        statusCode: 200,
        body: JSON.stringify({ reconciled: 0, checked: 0, timestamp: new Date().toISOString() })
      };
    }

    console.log(`[RECONCILE] Found ${pendingOrders.length} pending terminal orders to check.`);

    let reconciled = 0;
    let cancelled = 0;
    let stillPending = 0;
    let errors = 0;

    // 2. Check each order with Square
    for (const order of pendingOrders) {
      try {
        // Call Square Terminal API
        let checkout;
        try {
          const response = await client.terminal.checkouts.get(order.square_checkout_id);
          checkout = response.result?.checkout;
        } catch (squareErr) {
          console.warn(`[RECONCILE] Square API error for checkout ${order.square_checkout_id}:`, squareErr.message);
          errors++;
          continue; // Skip this order, try again next cycle
        }

        if (!checkout) {
          console.warn(`[RECONCILE] Checkout ${order.square_checkout_id} not found in Square.`);
          errors++;
          continue;
        }

        const checkoutStatus = checkout.status;

        if (checkoutStatus === 'COMPLETED') {
          // Payment completed! Extract payment details and confirm.
          const paymentIds = checkout.payment_ids || [];
          if (paymentIds.length === 0) {
            console.error(`[RECONCILE] Checkout COMPLETED but no payment IDs for order ${order.id}`);
            errors++;
            continue;
          }

          const paymentId = paymentIds[0];

          // Fetch payment details from Square
          let paidAmount = order.total_amount_cents; // Fallback
          let currency = 'USD';
          try {
            const paymentResponse = await client.payments.get(paymentId);
            const payment = paymentResponse.result?.payment;
            if (payment) {
              paidAmount = Number(payment.amount_money?.amount || paidAmount);
              currency = String(payment.amount_money?.currency || 'USD');
            }
          } catch (payErr) {
            console.warn(`[RECONCILE] Could not fetch payment ${paymentId}, using order amount.`);
          }

          // Confirm via shared processor
          const result = await confirmPayment({
            supabase,
            orderId: order.id,
            paymentId,
            paidAmountCents: paidAmount,
            currency,
            confirmedVia: 'reconciliation'
          });

          if (result.ok) {
            reconciled++;
            if (!result.alreadyProcessed) {
              console.log(`[RECONCILE] ✓ RESCUED order ${order.id} — payment was completed but webhook never arrived!`);
            }
          } else {
            console.error(`[RECONCILE] Confirmation failed for order ${order.id}: ${result.reason}`);
            errors++;
          }

        } else if (checkoutStatus === 'CANCELED') {
          // Square terminal checkout was cancelled (customer walked away, timeout, etc.)
          // Mark the order so cancel-stale-orders doesn't re-check it
          console.log(`[RECONCILE] Checkout cancelled for order ${order.id}. Marking as cancelled.`);
          await supabase.from('orders').update({
            status: 'cancelled',
            notes: 'Terminal checkout cancelled by Square',
            updated_at: new Date().toISOString()
          }).eq('id', order.id).eq('status', 'pending');
          cancelled++;

        } else {
          // PENDING, IN_PROGRESS, CANCEL_REQUESTED — still waiting
          stillPending++;
        }

      } catch (orderErr) {
        console.error(`[RECONCILE] Error processing order ${order.id}:`, orderErr.message);
        errors++;
      }
    }

    const summary = {
      checked: pendingOrders.length,
      reconciled,
      cancelled,
      stillPending,
      errors,
      timestamp: new Date().toISOString()
    };

    console.log(`[RECONCILE] Done: checked=${summary.checked}, reconciled=${summary.reconciled}, cancelled=${summary.cancelled}, stillPending=${summary.stillPending}, errors=${summary.errors}`);

    return {
      statusCode: 200,
      body: JSON.stringify(summary)
    };

  } catch (err) {
    console.error('[RECONCILE] Unhandled error:', err?.message);
    return { statusCode: 500, body: JSON.stringify({ error: 'Reconciliation failed' }) };
  }
};
