const { createClient } = require('@supabase/supabase-js');
const { authorize } = require('./_auth');

const supabaseUrl = process.env.SUPABASE_URL;
const supabase = createClient(supabaseUrl, process.env.SUPABASE_SERVICE_ROLE_KEY);

exports.handler = async (event) => {
  const auth = await authorize(event);
  if (!auth.ok) return auth.response;
  try {
    // Parse optional query param: ?dev_mode=true includes simulation items
    const params = event.queryStringParameters || {};
    const includeSimulation = params.dev_mode === 'true';

    // get_low_stock_items(p_include_simulation) — defaults to production-only
    const { data: lowStockItems, error } = await supabase.rpc('get_low_stock_items', {
      p_include_simulation: includeSimulation,
    });

    if (error) throw error;

    if (lowStockItems.length > 0) {
      const alertList = lowStockItems.map(i => `${i.item_name}: ${i.current_stock} ${i.unit} [${i.data_integrity_level}]`).join('\n');
      
      console.log("🚨 LOW STOCK ALERT:\n" + alertList);
      
      // Here you could trigger a Push Notification or Email
      return { statusCode: 200, body: JSON.stringify({ alert: true, items: lowStockItems }) };
    }

    return { statusCode: 200, body: JSON.stringify({ alert: false }) };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Inventory check failed' }) };
  }
};