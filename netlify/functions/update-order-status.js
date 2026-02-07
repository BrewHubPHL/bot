const { createClient } = require('@supabase/supabase-js');
const { authorize, json } = require('./_auth');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const ALLOWED_STATUSES = ['paid', 'preparing', 'ready', 'completed'];

exports.handler = async (event) => {
  const auth = await authorize(event);
  if (!auth.ok) return auth.response;

  if (event.httpMethod !== 'POST') return json(405, { error: 'Method Not Allowed' });

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (err) {
    return json(400, { error: 'Invalid JSON body' });
  }

  const { orderId, status } = body;
  if (!orderId || !status || !ALLOWED_STATUSES.includes(status)) {
    return json(400, { error: 'orderId and valid status are required' });
  }

  const { error } = await supabase
    .from('orders')
    .update({ status })
    .eq('id', orderId);

  if (error) {
    console.error('Update-order-status error:', error);
    return json(500, { error: 'Update failed' });
  }

  return json(200, { success: true, orderId, status });
};
