const { createClient } = require('@supabase/supabase-js');
const { SquareClient, SquareEnvironment } = require('square');
const { requireCsrfHeader } = require('./_csrf');
const { confirmPayment } = require('./_process-payment');

const square = new SquareClient({
  token: process.env.SQUARE_PRODUCTION_TOKEN,
  environment: SquareEnvironment.Production,
});

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const ALLOWED_ORIGINS = [
  process.env.SITE_URL || 'https://brewhubphl.com',
  'https://brewhubphl.com',
  'https://www.brewhubphl.com',
].filter(Boolean);

const FINAL_STATUSES = new Set(['paid', 'preparing', 'ready', 'completed']);

exports.handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': process.env.SITE_URL || 'https://brewhubphl.com',
    'Access-Control-Allow-Headers': 'Content-Type, X-BrewHub-Action, Authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  const csrfBlock = requireCsrfHeader(event);
  if (csrfBlock) return csrfBlock;

  const origin = (event.headers['origin'] || '').replace(/\/$/, '');
  const referer = (event.headers['referer'] || '');
  const isValidOrigin = ALLOWED_ORIGINS.some(allowed => origin === allowed || referer.startsWith(allowed));
  const isLocalDev = process.env.NODE_ENV !== 'production' && (origin.includes('://localhost') || referer.includes('://localhost'));
  if (!isValidOrigin && !isLocalDev) {
    return { statusCode: 403, headers, body: JSON.stringify({ error: 'Invalid request origin' }) };
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON body' }) };
  }

  const orderId = String(body.orderId || '').trim();
  const paymentIdHint = String(body.paymentId || '').trim();

  if (!orderId) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'orderId is required' }) };
  }

  try {
    const { data: order, error: orderErr } = await supabase
      .from('orders')
      .select('id, status, payment_id, total_amount_cents')
      .eq('id', orderId)
      .single();

    if (orderErr || !order) {
      return { statusCode: 404, headers, body: JSON.stringify({ error: 'Order not found' }) };
    }

    if (paymentIdHint && order.payment_id && paymentIdHint !== order.payment_id) {
      return { statusCode: 409, headers, body: JSON.stringify({ error: 'Payment mismatch' }) };
    }

    if (order.payment_id && FINAL_STATUSES.has(String(order.status || '').toLowerCase())) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          confirmed: true,
          finality: 'confirmed',
          orderStatus: order.status,
          paymentId: order.payment_id,
        }),
      };
    }

    const paymentId = order.payment_id || paymentIdHint;
    if (!paymentId) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          confirmed: false,
          finality: 'pending_confirmation',
          orderStatus: order.status,
          message: 'Payment reference not attached yet',
        }),
      };
    }

    const payRes = await square.payments.get(paymentId);
    const payment = payRes.result?.payment;

    if (!payment) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          confirmed: false,
          finality: 'pending_confirmation',
          orderStatus: order.status,
          paymentId,
          message: 'Payment lookup pending',
        }),
      };
    }

    if (payment.status !== 'COMPLETED') {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          confirmed: false,
          finality: 'pending_confirmation',
          orderStatus: order.status,
          paymentId,
          paymentStatus: payment.status,
        }),
      };
    }

    const confirm = await confirmPayment({
      supabase,
      orderId: order.id,
      paymentId,
      paidAmountCents: Number(payment.amount_money?.amount || order.total_amount_cents || 0),
      currency: String(payment.amount_money?.currency || 'USD'),
      confirmedVia: 'poll_merch',
    });

    if (!confirm.ok) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          confirmed: false,
          finality: 'verification_failed',
          orderStatus: order.status,
          paymentId,
          reason: confirm.reason,
        }),
      };
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        confirmed: true,
        finality: 'confirmed',
        orderStatus: 'preparing',
        paymentId,
        reason: confirm.reason,
      }),
    };
  } catch (err) {
    console.error('[POLL-MERCH] Error:', err?.message || err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Payment confirmation check failed' }),
    };
  }
};
