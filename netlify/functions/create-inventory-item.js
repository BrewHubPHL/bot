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

  // Validate barcode format (ASCII printable, reasonable length, no special chars)
  const barcodeStr = String(barcode).trim();
  if (barcodeStr.length < 1 || barcodeStr.length > 50) {
    return json(400, { error: 'Barcode must be 1-50 characters' });
  }
  if (!/^[A-Za-z0-9\-_.]+$/.test(barcodeStr)) {
    return json(400, { error: 'Barcode contains invalid characters' });
  }

  // Validate name (reasonable length, no control characters)
  const nameStr = String(name).trim();
  if (nameStr.length < 1 || nameStr.length > 100) {
    return json(400, { error: 'Name must be 1-100 characters' });
  }

  // Check for duplicate barcode
  const { data: existing } = await supabase
    .from('inventory')
    .select('id')
    .eq('barcode', barcodeStr)
    .single();

  if (existing) {
    return json(409, { error: 'Item with this barcode already exists' });
  }

  const { data, error } = await supabase
    .from('inventory')
    .insert({
      barcode: barcodeStr,
      item_name: nameStr,
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
