const { createClient } = require('@supabase/supabase-js');
const { authorize } = require('./_auth');

const supabaseUrl = process.env.SUPABASE_URL;
const supabase = createClient(supabaseUrl, process.env.SUPABASE_SERVICE_ROLE_KEY);

exports.handler = async (event) => {
  const auth = await authorize(event);
  if (!auth.ok) return auth.response;
  try {
    // 1. Find items below threshold using RPC function
    const { data: lowStockItems, error } = await supabase.rpc('get_low_stock_items');

    if (error) throw error;

    if (lowStockItems.length > 0) {
      const alertList = lowStockItems.map(i => `${i.item_name}: ${i.current_stock} ${i.unit}`).join('\n');
      
      console.log("🚨 LOW STOCK ALERT:\n" + alertList);
      
      // Here you could trigger a Push Notification or Email
      return { statusCode: 200, body: JSON.stringify({ alert: true, items: lowStockItems }) };
    }

    return { statusCode: 200, body: JSON.stringify({ alert: false }) };
  } catch (err) {
    return { statusCode: 500, body: err.message };
  }
};