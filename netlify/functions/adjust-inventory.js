const { createClient } = require('@supabase/supabase-js');
const { authorize, json } = require('./_auth');

const supabaseUrl = process.env.SUPABASE_URL;
const supabase = createClient(supabaseUrl, process.env.SUPABASE_SERVICE_ROLE_KEY);

exports.handler = async (event) => {
  // 1. Secure Auth (Staff Only)
  const auth = await authorize(event);
  if (!auth.ok) return auth.response;

  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Method Not Allowed' });
  }

  try {
    const { itemId, delta, itemName, barcode } = JSON.parse(event.body);

    if (!itemId || delta === undefined) {
      return json(400, { error: 'Missing itemId or delta' });
    }

    const adjustment = Number(delta);
    if (isNaN(adjustment) || Math.abs(adjustment) > 1000) {
      return json(400, { error: 'Invalid adjustment amount. Must be a number between -1000 and 1000.' });
    }

    console.log(`[INVENTORY] Adjusting stock for ${itemId} (${itemName || '?'}) by ${adjustment}`);

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
      console.error("Atomic RPC failed:", rpcError);
      return json(500, { error: 'Update failed' });
    }

    return json(200, { success: true, delta });

  } catch (err) {
    console.error('Inventory Adjustment Error:', err);
    return json(500, { error: 'Update failed' });
  }
};
