const { createClient } = require('@supabase/supabase-js');
const { authorize, json } = require('./_auth');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

exports.handler = async (event) => {
  // Auth check
  const auth = await authorize(event);
  if (!auth.ok) return auth.response;

  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Method not allowed' });
  }

  const { barcode, name } = JSON.parse(event.body || '{}');

  if (!barcode || !name) {
    return json(400, { error: 'barcode and name are required' });
  }

  // Check for duplicate barcode
  const { data: existing } = await supabase
    .from('inventory')
    .select('id')
    .eq('barcode', barcode)
    .single();

  if (existing) {
    return json(409, { error: 'Item with this barcode already exists' });
  }

  const { data, error } = await supabase
    .from('inventory')
    .insert({
      barcode,
      item_name: name,
      current_stock: 0,
      min_threshold: 10,
      unit: 'units'
    })
    .select()
    .single();

  if (error) {
    console.error('Create inventory item error:', error);
    return json(500, { error: 'Creation failed' });
  }

  return json(200, { item: data });
};
