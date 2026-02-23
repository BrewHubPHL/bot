const { createClient } = require('@supabase/supabase-js');
const { authorize } = require('./_auth');
const { requireCsrfHeader } = require('./_csrf');

const supabaseUrl = process.env.SUPABASE_URL;
const supabase = createClient(supabaseUrl, process.env.SUPABASE_SERVICE_ROLE_KEY);

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
    return cors(405, { error: 'Method Not Allowed' });
  }

  // 1. Secure Auth (Manager Only — baristas cannot adjust stock)
  const auth = await authorize(event, { requireManager: true, requirePin: true });
  if (!auth.ok) return auth.response;

  // CSRF protection
  const csrfBlock = requireCsrfHeader(event);
  if (csrfBlock) return csrfBlock;

  try {
    let parsed;
    try {
      parsed = JSON.parse(event.body || '{}');
    } catch {
      return cors(400, { error: 'Invalid JSON body' });
    }
    const { itemId, delta, itemName, barcode } = parsed;

    if (!itemId || delta === undefined) {
      return cors(400, { error: 'Missing itemId or delta' });
    }

    // Validate itemId as UUID
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(itemId))) {
      return cors(400, { error: 'Invalid itemId format' });
    }

    const adjustment = Number(delta);
    if (isNaN(adjustment) || Math.abs(adjustment) > 1000) {
      return cors(400, { error: 'Invalid adjustment amount. Must be a number between -1000 and 1000.' });
    }

    console.log(`[INVENTORY] Adjusting stock for ${itemId} by ${adjustment}`);

    // MISSION CRITICAL: Atomic Update via Postgres RPC
    // Fallback removed to prevent race conditions during Read-Modify-Write cycles.
    // Ensure you have created the following RPC in Supabase SQL Editor:
    /*
      create or replace function adjust_inventory_quantity(p_id uuid, p_delta int)
      returns void as $$
      update inventory 
      set current_stock = GREATEST(0, current_stock + p_delta),
          updated_at = now()
      where id = p_id;
      $$ language sql security definer;
    */

    const { error: rpcError } = await supabase.rpc('adjust_inventory_quantity', { 
      p_id: itemId, 
      p_delta: adjustment 
    });

    if (rpcError) {
      console.error("Atomic RPC failed:", rpcError?.message);
      return cors(500, { error: 'Update failed' });
    }

    return cors(200, { success: true, delta });

  } catch (err) {
    console.error('Inventory Adjustment Error:', err?.message);
    return cors(500, { error: 'Update failed' });
  }
};
