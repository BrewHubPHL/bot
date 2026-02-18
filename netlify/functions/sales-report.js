const { createClient } = require('@supabase/supabase-js');
const { authorize, json } = require('./_auth');

const supabase = createClient(
  process.env.SUPABASE_URL, 
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

exports.handler = async (event, context) => {
  // Always require manager auth — no header-based bypass
  const auth = await authorize(event, { requireManager: true });
  if (!auth.ok) return auth.response;

  try {
    // 2. Query the View we just built
    const { data, error } = await supabase
      .from('daily_sales_report')
      .select('*')
      .maybeSingle();

    if (error) {
      console.error("SQL View Error:", error.message);
      throw error;
    }

    // 3. Return the data exactly as manager.html expects it
    // Convert cents to dollars for gross_revenue
    return json(200, {
      total_orders: data?.total_orders || 0,
      gross_revenue: (data?.gross_revenue || 0) / 100,
      completed_orders: data?.completed_orders || 0,
      timestamp: new Date().toISOString()
    });

  } catch (err) {
    console.error("Function Crash:", err.message);
    return json(500, { error: "Failed to fetch report" });
  }
};