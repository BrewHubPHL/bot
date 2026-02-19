#!/usr/bin/env node
/**
 * simulate-rush.js — BrewHub Cafe Stress Test
 *
 * Simulates a busy rush by placing 5 orders via the ai-order endpoint,
 * then firing Square payment.updated webhooks for 3 of them with valid
 * HMAC-SHA256 signatures.  Random delays between order and payment
 * mimic real-world latency.
 *
 * Required env vars (via .env or shell):
 *   BREWHUB_API_KEY            – API key accepted by ai-order
 *   SQUARE_WEBHOOK_SIGNATURE   – HMAC signing secret for square-webhook
 *   SQUARE_WEBHOOK_URL         – Base URL (e.g. http://localhost:3000 or https://brewhubphl.com)
 *
 * Usage:
 *   node scripts/simulate-rush.js
 */

require('dotenv').config();
const crypto = require('crypto');
const fetch = require('node-fetch');

// ---------------------------------------------------------------------------
// CONFIG
// ---------------------------------------------------------------------------
const BASE_URL = process.env.SQUARE_WEBHOOK_URL || 'http://localhost:3000';
const API_KEY = process.env.BREWHUB_API_KEY;
const WEBHOOK_SECRET = process.env.SQUARE_WEBHOOK_SIGNATURE;

if (!API_KEY) {
  console.error('❌  Missing BREWHUB_API_KEY in environment.');
  process.exit(1);
}
if (!WEBHOOK_SECRET) {
  console.error('❌  Missing SQUARE_WEBHOOK_SIGNATURE in environment.');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// MOCK ORDER LIBRARY
// ---------------------------------------------------------------------------
const MOCK_ORDERS = [
  {
    label: 'The Regular',
    body: {
      customer_name: 'Mike R.',
      items: [{ name: 'Latte', quantity: 1 }],
      notes: 'Oat milk please',
    },
    shouldPay: true,
  },
  {
    label: 'The Latte Lover',
    body: {
      customer_name: 'Jess T.',
      items: [
        { name: 'Iced Latte', quantity: 2 },
        { name: 'Cookie', quantity: 1 },
      ],
      notes: 'Extra shot on both lattes',
    },
    shouldPay: true,
  },
  {
    label: 'The Group Order',
    body: {
      customer_name: 'Office 4B',
      items: [
        { name: 'Americano', quantity: 3 },
        { name: 'Cappuccino', quantity: 2 },
        { name: 'Bagel', quantity: 4 },
      ],
      notes: '',
    },
    shouldPay: true,
  },
  {
    label: 'The Undecided (no pay)',
    body: {
      customer_name: 'Carlos D.',
      items: [{ name: 'Cold Brew', quantity: 1 }],
      notes: 'Might cancel',
    },
    shouldPay: false,
  },
  {
    label: 'The Snacker (no pay)',
    body: {
      customer_name: 'Amy W.',
      items: [
        { name: 'Scone', quantity: 1 },
        { name: 'Lemonade', quantity: 1 },
      ],
      notes: '',
    },
    shouldPay: false,
  },
];

// ---------------------------------------------------------------------------
// HELPERS
// ---------------------------------------------------------------------------

/** Random delay between min and max ms (inclusive) */
function randomDelay(minMs, maxMs) {
  const ms = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Generate a fake Square-style payment ID */
function fakePaymentId() {
  return 'sim_' + crypto.randomBytes(12).toString('hex');
}

/**
 * Build a signed Square webhook payload for payment.updated.
 *
 * Signature algorithm (must match square-webhook.js):
 *   HMAC-SHA256(key, notificationUrl + rawBody)  →  base64
 *
 * @param {string} orderId   – Supabase order UUID
 * @param {number} amountCents – Total amount paid
 * @returns {{ body: string, signature: string, timestamp: string }}
 */
function buildWebhookPayload(orderId, amountCents) {
  const paymentId = fakePaymentId();
  const payload = {
    type: 'payment.updated',
    data: {
      object: {
        payment: {
          id: paymentId,
          status: 'COMPLETED',
          reference_id: orderId,
          amount_money: {
            amount: amountCents,
            currency: 'USD',
          },
        },
      },
    },
  };

  const rawBody = JSON.stringify(payload);
  const notificationUrl = `${BASE_URL}/.netlify/functions/square-webhook`;
  const hmacInput = notificationUrl + rawBody;
  const signature = crypto
    .createHmac('sha256', WEBHOOK_SECRET)
    .update(hmacInput, 'utf8')
    .digest('base64');

  // Timestamp: current Unix seconds (within the 5-minute replay window)
  const timestamp = String(Math.floor(Date.now() / 1000));

  return { body: rawBody, signature, timestamp };
}

// ---------------------------------------------------------------------------
// STEP A: Place an order via ai-order
// ---------------------------------------------------------------------------
async function placeOrder(mockOrder) {
  const url = `${BASE_URL}/.netlify/functions/ai-order`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': API_KEY,
    },
    body: JSON.stringify(mockOrder.body),
  });

  const data = await res.json();
  if (!res.ok || !data.success) {
    throw new Error(`Order failed (${res.status}): ${data.error || 'unknown'}`);
  }
  return data;
}

// ---------------------------------------------------------------------------
// STEP B: Fire a fake Square webhook
// ---------------------------------------------------------------------------
async function fireWebhook(orderId, amountCents) {
  const { body, signature, timestamp } = buildWebhookPayload(orderId, amountCents);
  const url = `${BASE_URL}/.netlify/functions/square-webhook`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-square-signature': signature,
      'x-square-hmacsha256-signature-timestamp': timestamp,
    },
    body,
  });

  const text = await res.text();
  return { status: res.status, body: text };
}

// ---------------------------------------------------------------------------
// MAIN
// ---------------------------------------------------------------------------
(async () => {
  console.log('');
  console.log('═══════════════════════════════════════');
  console.log('  ☕  BrewHub Rush Simulator  ☕');
  console.log('═══════════════════════════════════════');
  console.log(`  Target:  ${BASE_URL}`);
  console.log(`  Orders:  ${MOCK_ORDERS.length}`);
  console.log(`  Payments: ${MOCK_ORDERS.filter((o) => o.shouldPay).length}`);
  console.log('═══════════════════════════════════════');
  console.log('');

  const results = [];

  // Phase 1 — Place all orders
  for (const mock of MOCK_ORDERS) {
    try {
      const data = await placeOrder(mock);
      console.log(
        `✅  [${mock.label}] Order placed → ${data.order_id.slice(0, 8)}…  (${data.total_display})`
      );
      results.push({
        label: mock.label,
        orderId: data.order_id,
        totalCents: data.total_cents,
        shouldPay: mock.shouldPay,
      });
    } catch (err) {
      console.error(`❌  [${mock.label}] ${err.message}`);
    }
  }

  console.log('');
  console.log('--- Phase 2: Payment Webhooks (with chaos delays) ---');
  console.log('');

  // Phase 2 — Fire webhooks for orders that should pay
  const payable = results.filter((r) => r.shouldPay);

  for (const order of payable) {
    // Chaos: random 500ms–2000ms delay
    const delay = Math.floor(Math.random() * 1501) + 500;
    console.log(`⏳  [${order.label}] Waiting ${delay}ms before payment webhook…`);
    await randomDelay(delay, delay);

    try {
      const webhookRes = await fireWebhook(order.orderId, order.totalCents);
      const ok = webhookRes.status === 200;
      console.log(
        `${ok ? '💰' : '⚠️'}  [${order.label}] Webhook → ${webhookRes.status}  ${webhookRes.body.slice(0, 80)}`
      );
    } catch (err) {
      console.error(`❌  [${order.label}] Webhook error: ${err.message}`);
    }
  }

  // Summary
  console.log('');
  console.log('═══════════════════════════════════════');
  console.log('  📊  Rush Complete — Summary');
  console.log('═══════════════════════════════════════');
  console.log(`  Placed: ${results.length} orders`);
  console.log(`  Paid:   ${payable.length} via webhook`);
  console.log(`  Unpaid: ${results.length - payable.length} (idle / will be cleaned by stale-order cron)`);
  console.log('');
  console.log('👀  Check the Manager Dashboard → 🖨️ Live Receipt Roll');
  console.log('    You should see 3 new thermal receipts slide in.');
  console.log('');
})();
