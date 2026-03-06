/**
 * RECONCILE PENDING PAYMENTS (Scheduled Cron — v2 ESM)
 *
 * The ultimate safety net for the "Phantom Orders" vulnerability.
 * Even if Square's webhooks are delayed 15+ minutes, the POS UI crashed,
 * or the staff member closed the browser tab — this function catches it.
 *
 * Algorithm:
 *   1. Find pending orders with a square_checkout_id older than 60s
 *   2. Check Square Terminal API for checkout status
 *   3. If COMPLETED, confirm payment via shared _process-payment helper
 *   4. If CANCELED by Square, mark order for staff attention
 *
 * Schedule: Every 2 minutes via Netlify Scheduled Functions v2
 *
 * Security:
 *   - Only accepts scheduled invocations or CRON_SECRET header
 *   - Uses service role key (bypasses RLS)
 *   - Max 20 orders per run
 */

import { SquareClient, SquareEnvironment } from 'square';
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { confirmPayment } = require('./_process-payment');

function safeCompare(a, b) {
  if (!a || !b) return false;
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

const MAX_RECONCILE_BATCH = 20;
const MIN_AGE_SECONDS = 60;
const MAX_AGE_MINUTES = 45;

function jsonResponse(code, data) {
  return new Response(JSON.stringify(data), {
    status: code,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  });
}

export default async function handler(req, context) {
  const hdrs = {};
  for (const [k, v] of req.headers.entries()) {
    hdrs[k.toLowerCase()] = v;
  }

  const hasCronSecret = safeCompare(hdrs['x-cron-secret'], process.env.CRON_SECRET);
  if (!hasCronSecret) {
    return jsonResponse(403, { error: 'Forbidden' });
  }

  console.log('[RECONCILE] Starting pending payment reconciliation…');

  try {
    const client = new SquareClient({
      token: process.env.SQUARE_PRODUCTION_TOKEN,
      environment: SquareEnvironment.Production,
    });

    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    // 1. Find pending orders with a terminal checkout ID
    const cutoffRecent = new Date(Date.now() - MIN_AGE_SECONDS * 1000).toISOString();
    const cutoffOld = new Date(Date.now() - MAX_AGE_MINUTES * 60 * 1000).toISOString();

    const { data: pendingOrders, error: queryError } = await supabase
      .from('orders')
      .select('id, square_checkout_id, total_amount_cents, created_at')
      .eq('status', 'pending')
      .not('square_checkout_id', 'is', null)
      .is('payment_id', null)
      .lt('created_at', cutoffRecent)
      .gt('created_at', cutoffOld)
      .order('created_at', { ascending: true })
      .limit(MAX_RECONCILE_BATCH);

    if (queryError) {
      console.error('[RECONCILE] Query error:', queryError.message);
      return jsonResponse(500, { error: 'Query failed' });
    }

    if (!pendingOrders || pendingOrders.length === 0) {
      console.log('[RECONCILE] No pending terminal orders to reconcile.');
      return jsonResponse(200, { reconciled: 0, checked: 0, timestamp: new Date().toISOString() });
    }

    console.log(`[RECONCILE] Found ${pendingOrders.length} pending terminal orders to check.`);

    let reconciled = 0;
    let cancelled = 0;
    let stillPending = 0;
    let errors = 0;

    // 2. Check each order with Square
    for (const order of pendingOrders) {
      try {
        let checkout;
        try {
          const response = await client.terminal.checkouts.get(order.square_checkout_id);
          checkout = response.result?.checkout;
        } catch (squareErr) {
          console.warn(`[RECONCILE] Square API error for checkout ${order.square_checkout_id}:`, squareErr.message);
          errors++;
          continue;
        }

        if (!checkout) {
          console.warn(`[RECONCILE] Checkout ${order.square_checkout_id} not found in Square.`);
          errors++;
          continue;
        }

        const checkoutStatus = checkout.status;

        if (checkoutStatus === 'COMPLETED') {
          const paymentIds = checkout.payment_ids || [];
          if (paymentIds.length === 0) {
            console.error(`[RECONCILE] Checkout COMPLETED but no payment IDs for order ${order.id}`);
            errors++;
            continue;
          }

          const paymentId = paymentIds[0];

          let paidAmount = order.total_amount_cents;
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
          console.log(`[RECONCILE] Checkout cancelled for order ${order.id}. Marking as cancelled.`);
          const { error: cancelErr } = await supabase.from('orders').update({
            status: 'cancelled',
            notes: 'Terminal checkout cancelled by Square',
            updated_at: new Date().toISOString()
          }).eq('id', order.id).eq('status', 'pending');
          if (cancelErr) {
            console.error(`[RECONCILE] Failed to mark order ${order.id} as cancelled:`, cancelErr.message);
            errors++;
          } else {
            cancelled++;
          }

        } else {
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

    return jsonResponse(200, summary);

  } catch (err) {
    console.error('[RECONCILE] Unhandled error:', err?.message);
    return jsonResponse(500, { error: 'Reconciliation failed' });
  }
}

export const config = {
  schedule: "*/2 * * * *"
};
