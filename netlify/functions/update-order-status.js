const { createClient } = require('@supabase/supabase-js');
const { authorize, json } = require('./_auth');

// Initializes with Service Role Key to bypass RLS on the server side
const supabase = createClient(
  process.env.SUPABASE_URL, 
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const ALLOWED_STATUSES = ['paid', 'preparing', 'ready', 'completed'];

exports.handler = async (event) => {
  // 1. SECURITY CHECK
  // This requires the sender to have a valid Supabase JWT session
  const auth = await authorize(event);
  if (!auth.ok) {
    console.error('KDS Auth Failure: No valid session found');
    return auth.response;
  }

  // 2. METHOD CHECK
  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Method Not Allowed' });
  }

  // 3. PARSE BODY
  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (err) {
    return json(400, { error: 'Invalid JSON body' });
  }

  const { orderId, status } = body;

  // 4. VALIDATION
  if (!orderId || !status || !ALLOWED_STATUSES.includes(status)) {
    console.error(`KDS Validation Failure: ID: ${orderId}, Status: ${status}`);
    return json(400, { error: 'orderId and valid status are required' });
  }

  console.log(`KDS: Attempting to update order ${orderId} to ${status}...`);

  // 5. DATABASE UPDATE
  const { error } = await supabase
    .from('orders')
    .update({ status })
    .eq('id', orderId);

  if (error) {
    console.error('Supabase Database Error:', error.message);
    return json(500, { error: 'Update failed in database' });
  }

  console.log(`KDS: Order ${orderId} successfully updated to ${status}`);
  return json(200, { success: true, orderId, status });
};