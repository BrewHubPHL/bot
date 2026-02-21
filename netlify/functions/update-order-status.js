const { createClient } = require('@supabase/supabase-js');
const { authorize, json } = require('./_auth');
const { generateReceiptString, queueReceipt } = require('./_receipt');
const { requireCsrfHeader } = require('./_csrf');

// Initialize with Service Role Key (Bypasses RLS)
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

exports.handler = async (event) => {
  const ALLOWED_ORIGIN = process.env.SITE_URL || 'https://brewhubphl.com';

  // 1. Handle CORS
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-BrewHub-Action',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
      },
      body: '',
    };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  // CSRF protection
  const csrfBlock = requireCsrfHeader(event);
  if (csrfBlock) return csrfBlock;

  // 2. Staff Authentication Required
  const auth = await authorize(event, { requirePin: true });
  if (!auth.ok) return auth.response;

  try {
    const { orderId, status, paymentMethod } = JSON.parse(event.body);

    if (!orderId) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Missing Order ID' }) };
    }

    // Validate status is one of allowed values
    const allowedStatuses = ['paid', 'preparing', 'ready', 'completed', 'cancelled'];
    if (!status || !allowedStatuses.includes(status)) {
      return { statusCode: 400, body: JSON.stringify({ error: `Invalid status. Must be one of: ${allowedStatuses.join(', ')}` }) };
    }

    // Build update payload
    const updatePayload = { status };

    // Track order completion speed
    if (status === 'completed') {
      updatePayload.completed_at = new Date().toISOString();
    }

    // Record payment method (cash, comp, etc.) and set payment_id marker
    const ALLOWED_PAYMENT_METHODS = ['cash', 'comp', 'square', 'other'];
    if (paymentMethod && ALLOWED_PAYMENT_METHODS.includes(paymentMethod)) {
      updatePayload.payment_id = paymentMethod;    // marks order as paid
    }

    // Update the Order Status
    const { data, error } = await supabase
      .from('orders')
      .update(updatePayload)
      .eq('id', orderId)
      .select();

    if (error) throw error;

    // Generate receipt for cash/comp payments (Square receipts handled by webhook)
    if (paymentMethod && ['cash', 'comp'].includes(paymentMethod) && data && data[0]) {
      try {
        const { data: lineItems } = await supabase
          .from('coffee_orders')
          .select('drink_name, price')
          .eq('order_id', orderId);

        const receiptText = generateReceiptString(data[0], lineItems || []);
        await queueReceipt(supabase, orderId, receiptText);
      } catch (receiptErr) {
        console.error('[RECEIPT] Non-fatal receipt error:', receiptErr.message);
      }
    }

    return {
      statusCode: 200,
      headers: { 'Access-Control-Allow-Origin': ALLOWED_ORIGIN },
      body: JSON.stringify({ success: true, order: data })
    };

  } catch (err) {
    console.error('[COMPLETE-ORDER] Error:', err);
    return {
      statusCode: 500,
      headers: { 'Access-Control-Allow-Origin': ALLOWED_ORIGIN },
      body: JSON.stringify({ error: 'Internal server error' })
    };
  }
};