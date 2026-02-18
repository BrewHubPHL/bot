const { createClient } = require('@supabase/supabase-js');
const { authorize, json } = require('./_auth');

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
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
      },
      body: '',
    };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  // 2. Staff Authentication Required
  const auth = await authorize(event);
  if (!auth.ok) return auth.response;

  try {
    const { orderId, status } = JSON.parse(event.body);

    if (!orderId) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Missing Order ID' }) };
    }

    // Validate status is one of allowed values
    const allowedStatuses = ['preparing', 'ready', 'completed', 'cancelled'];
    if (!status || !allowedStatuses.includes(status)) {
      return { statusCode: 400, body: JSON.stringify({ error: `Invalid status. Must be one of: ${allowedStatuses.join(', ')}` }) };
    }

    // Update the Order Status
    const { data, error } = await supabase
      .from('orders')
      .update({ status })
      .eq('id', orderId)
      .select();

    if (error) throw error;

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