// get-inventory.js — Server-side proxy for InventoryTable.
// Returns inventory items with id, item_name, category, current_stock, min_threshold, unit.
// Uses service_role to bypass RLS on inventory table.

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
      .from('inventory')
      .select('id, item_name, category, current_stock, min_threshold, unit')
      .order('item_name', { ascending: true });

    if (error) throw error;

    return json(200, { inventory: data || [] });
  } catch (err) {
    return sanitizedError(err, 'get-inventory');
  }
};
