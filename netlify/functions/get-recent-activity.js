// get-recent-activity.js — Server-side proxy for RecentActivity.
// Returns latest orders + inventory changes for the manager dashboard.

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
    const [ordersRes, inventoryRes] = await Promise.all([
      supabase
        .from('orders')
        .select('id, customer_name, status, created_at')
        .order('created_at', { ascending: false })
        .limit(5),
      supabase
        .from('inventory')
        .select('id, item_name, current_stock, updated_at')
        .order('updated_at', { ascending: false })
        .limit(5),
    ]);

    return json(200, {
      orders: ordersRes.data || [],
      inventory: inventoryRes.data || [],
    });
  } catch (err) {
    return sanitizedError(err, 'get-recent-activity');
  }
};
