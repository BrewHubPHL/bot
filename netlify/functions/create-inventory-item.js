const { createClient } = require('@supabase/supabase-js');
const { authorize } = require('./_auth');
const { requireCsrfHeader } = require('./_csrf');
const { sanitizeInput } = require('./_sanitize');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

exports.handler = async (event) => {
  const ALLOWED_ORIGINS = [process.env.URL, 'https://brewhubphl.com', 'https://www.brewhubphl.com'].filter(Boolean);
  const origin = event.headers?.origin || '';
  const CORS_ORIGIN = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  const corsHeaders = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': CORS_ORIGIN, 'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-BrewHub-Action', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
  const cors = (code, data) => ({ statusCode: code, headers: corsHeaders, body: JSON.stringify(data) });

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return cors(405, { error: 'Method not allowed' });
  }

  // Auth check (Manager Only — baristas cannot create inventory items)
  const auth = await authorize(event, { requireManager: true, requirePin: true });
  if (!auth.ok) return auth.response;

  // CSRF protection
  const csrfBlock = requireCsrfHeader(event);
  if (csrfBlock) return csrfBlock;

  let barcode, name;
  try {
    ({ barcode, name } = JSON.parse(event.body || '{}'));
  } catch {
    return cors(400, { error: 'Invalid JSON body' });
  }

  if (!barcode || !name) {
    return cors(400, { error: 'barcode and name are required' });
  }

  // Validate barcode format (ASCII printable, reasonable length, no special chars)
  const barcodeStr = String(barcode).trim();
  if (barcodeStr.length < 1 || barcodeStr.length > 50) {
    return cors(400, { error: 'Barcode must be 1-50 characters' });
  }
  if (!/^[A-Za-z0-9\-_.]+$/.test(barcodeStr)) {
    return cors(400, { error: 'Barcode contains invalid characters' });
  }

  // Validate + sanitize name (reasonable length, no control characters or HTML)
  const nameStr = sanitizeInput(String(name).trim()).slice(0, 100);
  if (nameStr.length < 1) {
    return cors(400, { error: 'Name must be 1-100 characters' });
  }

  // Check for duplicate barcode
  const { data: existing } = await supabase
    .from('inventory')
    .select('id')
    .eq('barcode', barcodeStr)
    .single();

  if (existing) {
    return cors(409, { error: 'Item with this barcode already exists' });
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
    console.error('Create inventory item error:', error?.message);
    return cors(500, { error: 'Creation failed' });
  }

  return cors(200, { item: data });
};
