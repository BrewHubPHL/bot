// get-inventory.js — Server-side proxy for InventoryTable.
// Returns inventory items with id, item_name, category, current_stock, min_threshold, unit.
// Uses service_role to bypass RLS on inventory table.

const { createClient } = require('@supabase/supabase-js');
const { authorize, json, sanitizedError } = require('./_auth');
const { staffBucket } = require('./_token-bucket');
const { sanitizeInput } = require('./_sanitize');

const MISSING_ENV = !process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY;

const ALLOWED_ORIGINS = new Set([
  process.env.SITE_URL,
  'https://brewhubphl.com',
  'https://www.brewhubphl.com',
].filter(Boolean));

function validateOrigin(headers) {
  const origin = headers['origin'] || headers['Origin'] || '';
  if (ALLOWED_ORIGINS.has(origin)) return origin;
  return null;
}

const makeHeaders = (origin) => Object.assign({ 'Content-Type': 'application/json', 'Cache-Control': 'no-cache', 'Vary': 'Origin' }, origin ? { 'Access-Control-Allow-Origin': origin } : {});

const INVENTORY_LIMIT = 500;

exports.handler = async (event) => {
  const origin = validateOrigin(event.headers || {});
  const headers = makeHeaders(origin);

  if (MISSING_ENV) return { statusCode: 500, headers, body: JSON.stringify({ error: 'Server misconfiguration' }) };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: Object.assign({}, headers, { 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization' }), body: '' };
  if (event.httpMethod !== 'GET') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  const auth = await authorize(event, { requireManager: true, requirePin: true });
  if (!auth.ok) return Object.assign({}, auth.response, { headers: Object.assign({}, auth.response.headers || {}, headers) });

  // Rate limit per-manager + IP
  const clientIp = event.headers['x-nf-client-connection-ip'] || event.headers['x-forwarded-for']?.split(',')[0]?.trim() || 'unknown';
  const managerEmail = (auth.user && (auth.user.email || auth.user?.user?.email)) ? String(auth.user.email || auth.user?.user?.email).toLowerCase() : 'unknown_manager';
  const rlKey = `inventory:${managerEmail}:${clientIp}`;
  const rl = staffBucket.consume(rlKey);
  if (!rl.allowed) {
    return { statusCode: 429, headers: Object.assign({}, headers, { 'Retry-After': String(Math.ceil(rl.retryAfterMs / 1000)) }), body: JSON.stringify({ error: 'Too many requests' }) };
  }

  try {
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

    const { data, error } = await supabase
      .from('inventory')
      .select('id, item_name, category, current_stock, min_threshold, unit')
      .order('item_name', { ascending: true })
      .limit(INVENTORY_LIMIT);

    if (error) throw error;

    const inventory = (data || []).map(i => ({
      id: i.id,
      item_name: sanitizeInput(String(i.item_name || '')).slice(0, 200),
      category: sanitizeInput(String(i.category || '')).slice(0, 100),
      current_stock: Number.isFinite(Number(i.current_stock)) ? Number(i.current_stock) : null,
      min_threshold: Number.isFinite(Number(i.min_threshold)) ? Number(i.min_threshold) : null,
      unit: sanitizeInput(String(i.unit || '')).slice(0, 20),
    }));

    return { statusCode: 200, headers, body: JSON.stringify({ inventory }) };
  } catch (err) {
    const res = sanitizedError(err, 'get-inventory');
    res.headers = Object.assign({}, res.headers || {}, headers);
    return res;
  }
};
