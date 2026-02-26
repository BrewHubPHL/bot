// log-shrinkage.js — Atomic inventory shrinkage recorder for retail write-offs.
// Decrements merch_products.stock_quantity and writes to inventory_shrinkage_log
// in a single Postgres transaction via the atomic_record_shrinkage() RPC.
//
// Requires manager-level auth (same as manage-catalog writes).
// Doomsday Scenario 4: THE BROKEN MUG

const { createClient } = require('@supabase/supabase-js');
const { authorize, json, sanitizedError } = require('./_auth');
const { requireCsrfHeader } = require('./_csrf');
const { sanitizeInput } = require('./_sanitize');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VALID_CATEGORIES = ['breakage', 'spoilage', 'theft', 'other'];

exports.handler = async (event) => {
  const ALLOWED_ORIGINS = [process.env.URL, 'https://brewhubphl.com', 'https://www.brewhubphl.com'].filter(Boolean);
  const origin = event.headers?.origin || '';
  const CORS_ORIGIN = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  const corsHeaders = {
    'Access-Control-Allow-Origin': CORS_ORIGIN,
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-BrewHub-Action',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };
  const corsJson = (code, data) => ({
    statusCode: code,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
    body: JSON.stringify(data),
  });

  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: corsHeaders, body: '' };

  if (event.httpMethod !== 'POST') {
    return corsJson(405, { error: 'Method not allowed. Use POST.' });
  }

  // Manager-only: shrinkage reporting is a privileged operation
  const auth = await authorize(event, { requireManager: true });
  if (!auth.ok) return auth.response;

  // CSRF protection
  const csrfBlock = requireCsrfHeader(event);
  if (csrfBlock) return csrfBlock;

  try {
    let body;
    try {
      body = JSON.parse(event.body || '{}');
    } catch {
      return corsJson(400, { error: 'Invalid JSON body' });
    }

    const { product_id, category, quantity, reason } = body;

    // ── Validate inputs ──────────────────────────────────────
    if (!product_id || typeof product_id !== 'string' || !UUID_RE.test(product_id)) {
      return corsJson(422, { error: 'Missing or invalid product_id (UUID)' });
    }
    if (!category || !VALID_CATEGORIES.includes(category)) {
      return corsJson(422, { error: `Invalid category. Must be one of: ${VALID_CATEGORIES.join(', ')}` });
    }
    const qty = parseInt(quantity, 10);
    if (!Number.isInteger(qty) || qty < 1 || qty > 9999) {
      return corsJson(422, { error: 'quantity must be a positive integer (1–9999)' });
    }
    const safeReason = sanitizeInput((reason || '').toString().trim()).slice(0, 500);
    if (safeReason.length < 2) {
      return corsJson(422, { error: 'A reason is required (min 2 characters)' });
    }

    // ── Call atomic RPC ──────────────────────────────────────
    const { data, error } = await supabase.rpc('atomic_record_shrinkage', {
      p_product_id: product_id,
      p_category: category,
      p_quantity: qty,
      p_reason: safeReason,
      p_staff_id: auth.user?.id || null,
      p_staff_email: auth.user?.email || 'unknown',
    });

    if (error) {
      console.error('[SHRINKAGE] RPC error:', error.message);
      return corsJson(500, { error: 'Failed to record shrinkage' });
    }

    if (data && data.ok === false) {
      return corsJson(422, { error: data.error || 'Shrinkage recording failed' });
    }

    console.log(
      `[SHRINKAGE] ${auth.user?.email} recorded ${category}: ${qty}× ${data?.product_name} — "${safeReason}" ` +
      `(loss: $${((data?.total_loss_cents || 0) / 100).toFixed(2)}, stock: ${data?.old_stock} → ${data?.new_stock})`
    );

    return corsJson(200, {
      ok: true,
      shrinkage: {
        log_id: data.log_id,
        product_name: data.product_name,
        category,
        quantity: qty,
        reason: safeReason,
        total_loss_cents: data.total_loss_cents,
        old_stock: data.old_stock,
        new_stock: data.new_stock,
        staff_email: auth.user?.email,
      },
    });
  } catch (err) {
    return sanitizedError(err, 'log-shrinkage');
  }
};
