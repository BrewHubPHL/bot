const { createClient } = require('@supabase/supabase-js');
const { authorize } = require('./_auth');
const { requireCsrfHeader } = require('./_csrf');
const { sanitizeInput } = require('./_sanitize');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

/**
 * staff-add-inventory-item — Lightweight quick-add for ANY authenticated staff.
 *
 * Allows baristas to add new inventory items (name + barcode + category) when
 * scanning an unknown barcode. Pricing fields (unit_cost_cents) are omitted —
 * managers set those from the manager dashboard.
 *
 * Items are created with current_stock = 0, min_threshold = 10, unit = 'units'.
 */
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

  // Any authenticated staff can quick-add items (not manager-only)
  const auth = await authorize(event, { requirePin: true, requireOnboarded: true });
  if (!auth.ok) return auth.response;

  const csrfBlock = requireCsrfHeader(event);
  if (csrfBlock) return csrfBlock;

  let barcode, name, category, unit;
  try {
    ({ barcode, name, category, unit } = JSON.parse(event.body || '{}'));
  } catch {
    return cors(400, { error: 'Invalid JSON body' });
  }

  if (!barcode || !name) {
    return cors(400, { error: 'barcode and name are required' });
  }

  // Validate barcode format
  const barcodeStr = String(barcode).trim();
  if (barcodeStr.length < 1 || barcodeStr.length > 50) {
    return cors(400, { error: 'Barcode must be 1-50 characters' });
  }
  if (!/^[A-Za-z0-9\-_.]+$/.test(barcodeStr)) {
    return cors(400, { error: 'Barcode contains invalid characters' });
  }

  // Validate + sanitize name
  const nameStr = sanitizeInput(String(name).trim()).slice(0, 100);
  if (nameStr.length < 1) {
    return cors(400, { error: 'Name must be 1-100 characters' });
  }

  // Check for duplicate barcode
  const { data: existing, error: lookupErr } = await supabase
    .from('inventory')
    .select('id')
    .eq('barcode', barcodeStr)
    .maybeSingle();

  if (lookupErr) throw lookupErr;

  if (existing) {
    return cors(409, { error: 'Item with this barcode already exists' });
  }

  // Validate category
  const ALLOWED_CATS = new Set([
    'Coffee Beans', 'Milk & Dairy', 'Syrups & Flavors', 'Cups & Lids',
    'Pastry & Food', 'Cleaning Supplies', 'Equipment Parts', 'Merchandise', 'Other', 'general',
  ]);
  const catStr = category ? sanitizeInput(String(category).trim()).slice(0, 100) : 'general';
  const safeCat = ALLOWED_CATS.has(catStr) ? catStr : 'general';

  // Validate unit/size
  const ALLOWED_UNITS = new Set([
    'units', '8oz cups', '12oz cups', '16oz cups', '20oz cups',
    'lids', 'sleeves', 'g', 'kg', 'oz', 'lb',
    'bags', 'boxes', 'gallons', 'liters', 'bottles', 'packets', 'each',
  ]);
  const unitStr = unit ? sanitizeInput(String(unit).trim()).slice(0, 30) : 'units';
  const safeUnit = ALLOWED_UNITS.has(unitStr) ? unitStr : 'units';

  const { data, error } = await supabase
    .from('inventory')
    .insert({
      barcode: barcodeStr,
      item_name: nameStr,
      current_stock: 0,
      min_threshold: 10,
      unit: safeUnit,
      category: safeCat,
    })
    .select()
    .single();

  if (error) {
    console.error('[staff-add-inventory] Insert error:', error?.message);
    return cors(500, { error: 'Failed to create item' });
  }

  console.log(`[staff-add-inventory] Created "${nameStr}" barcode=${barcodeStr} by staff=${auth.staffId}`);
  return cors(200, { item: data });
};
