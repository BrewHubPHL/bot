/**
 * get-queue.js — Public order queue for customer-facing display board.
 *
 * Returns active orders with sanitized fields (first name only, items, status).
 * Uses service role to bypass RLS — returns only what customers should see.
 * No auth required — intended for a lobby/counter display screen.
 */
const { createClient } = require('@supabase/supabase-js');

exports.handler = async (event) => {
  const ALLOWED_ORIGIN = process.env.SITE_URL || 'https://brewhubphl.com';
  const headers = {
    'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
    'Content-Type': 'application/json',
    'Cache-Control': 'no-cache',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    // Fetch active orders (including recently completed) from today
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const { data: orders, error } = await supabase
      .from('orders')
      .select('id, customer_name, status, payment_id, created_at, completed_at, coffee_orders(drink_name, customizations)')
      .in('status', ['pending', 'unpaid', 'paid', 'preparing', 'ready', 'completed'])
      .gte('created_at', today.toISOString())
      .order('created_at', { ascending: true });

    if (error) throw error;

    // Auto-expire completed orders after 15 minutes so board stays tidy
    const COMPLETED_TTL_MS = 15 * 60 * 1000;
    const now = Date.now();
    const filtered = (orders || []).filter(o => {
      if (o.status !== 'completed') return true;
      const doneAt = o.completed_at ? new Date(o.completed_at).getTime() : new Date(o.created_at).getTime();
      return (now - doneAt) < COMPLETED_TTL_MS;
    });

    // Sanitize for public display: first name only, no IDs, no payment details
    const queue = filtered.map((order, index) => {
      // Extract first name only (privacy)
      const fullName = order.customer_name || 'Guest';
      const firstName = fullName.split(' ')[0];

      // Build item list
      const items = (order.coffee_orders || []).map(item => ({
        name: item.drink_name,
        mods: item.customizations ? formatMods(item.customizations) : null,
      }));

      return {
        position: index + 1,
        name: firstName,
        tag: `BRW-${order.id.slice(0, 4).toUpperCase()}`,
        items,
        status: order.status,
        isPaid: !!order.payment_id,
        minutesAgo: Math.round((Date.now() - new Date(order.created_at).getTime()) / 60000),
      };
    });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ queue, count: queue.length, timestamp: new Date().toISOString() }),
    };

  } catch (err) {
    console.error('[GET-QUEUE] Error:', err.message);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Failed to load queue' }),
    };
  }
};

// Format customizations object into readable string
function formatMods(customizations) {
  if (!customizations || typeof customizations !== 'object') return null;
  const parts = [];
  if (customizations.milk && customizations.milk !== 'whole') parts.push(customizations.milk);
  if (customizations.size && customizations.size !== 'regular') parts.push(customizations.size);
  if (customizations.extras) {
    const extras = Array.isArray(customizations.extras) ? customizations.extras : [customizations.extras];
    parts.push(...extras);
  }
  if (customizations.temperature) parts.push(customizations.temperature);
  if (customizations.notes) parts.push(customizations.notes);
  return parts.length > 0 ? parts.join(', ') : null;
}
