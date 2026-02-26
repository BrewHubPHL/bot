/**
 * update-item-status.js — Toggle per-item completion on a KDS order
 *
 * When a barista taps the checkbox next to "Iced Latte" on iPad A,
 * this function toggles `completed_at` / `completed_by` on the
 * coffee_orders row. Supabase Realtime broadcasts the change to
 * every other KDS screen so iPad B sees the item crossed off.
 *
 * POST { itemId: uuid }
 * → 200 { success: true, item: { id, completed_at, completed_by } }
 */

const { createClient } = require('@supabase/supabase-js');
const { authorize, json } = require('./_auth');
const { requireCsrfHeader } = require('./_csrf');

exports.handler = async (event) => {
  const ALLOWED_ORIGINS = [
    process.env.SITE_URL,
    'https://brewhubphl.com',
    'https://www.brewhubphl.com',
  ].filter(Boolean);
  const origin = event.headers?.origin || '';
  const corsOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  const CORS_HEADERS = {
    'Access-Control-Allow-Origin': corsOrigin,
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-BrewHub-Action',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS_HEADERS, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  // CSRF protection
  const csrfBlock = requireCsrfHeader(event);
  if (csrfBlock) return csrfBlock;

  // Staff authentication required
  const auth = await authorize(event, { requirePin: true });
  if (!auth.ok) return auth.response;

  try {
    const body = JSON.parse(event.body || '{}');
    const itemId = body.itemId;

    if (!itemId) {
      return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Missing itemId' }) };
    }

    // Validate UUID format
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!UUID_RE.test(itemId)) {
      return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Invalid itemId format' }) };
    }

    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
    );

    const staffId = auth.user?.id || null;

    const { data, error } = await supabase.rpc('toggle_item_completed', {
      p_item_id: itemId,
      p_staff_id: staffId,
    });

    if (error) {
      console.error('[ITEM-STATUS] RPC error:', error.message);
      return { statusCode: 500, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Failed to update item' }) };
    }

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({ success: true, item: data }),
    };
  } catch (err) {
    console.error('[ITEM-STATUS] Unexpected error:', err?.message || err);
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'Internal server error' }),
    };
  }
};
