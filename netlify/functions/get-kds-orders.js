// get-kds-orders.js — Server-side proxy for KdsSection.
// Returns active orders (paid / preparing / ready) with their drink items.
// Uses service_role to bypass RLS on orders / coffee_orders tables.

const { createClient } = require('@supabase/supabase-js');
const { authorize, json, sanitizedError } = require('./_auth');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return json(204, {});
  if (event.httpMethod !== 'GET') return json(405, { error: 'Method not allowed' });

  const auth = await authorize(event);
  if (!auth.ok) return auth.response;

  try {
    const { data, error } = await supabase
      .from('orders')
      .select('id, customer_name, status, created_at, coffee_orders(id, drink_name, customizations, price)')
      .in('status', ['pending', 'paid', 'preparing', 'ready'])
      .order('created_at', { ascending: true });

    if (error) throw error;

    return json(200, { orders: data || [] });
  } catch (err) {
    return sanitizedError(err, 'get-kds-orders');
  }
};
