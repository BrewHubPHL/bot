const { createClient } = require('@supabase/supabase-js');
const { authorize, json } = require('./_auth');

const supabase = createClient(
  process.env.SUPABASE_URL, 
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

exports.handler = async (event, context) => {
  // 1. Secure: Managers Only (RBAC enforced)
  // High-sensitivity: Require token issued within last 15 minutes
  const auth = await authorize(event, { requireManager: true, maxTokenAgeMinutes: 15 });
  if (!auth.ok) return auth.response;

  try {
    // 2. Pull data from the Daily Sales View
    const { data, error } = await supabase
      .from('daily_sales_report')
      .select('*')
      .single();

    if (error) throw error;

    const report = `
      ☕ BrewHubPHL Daily Sales Summary
      ---------------------------------
      Orders: ${data?.total_orders || 0}
      Revenue: $${(data?.gross_revenue || 0).toFixed(2)}
      Vouchers Used: ${data?.vouchers_redeemed || 0}
      ---------------------------------
      Report Generated: ${new Date().toLocaleString()}
    `;

    console.log(report);

    return json(200, { message: "Daily report generated", report, data });
  } catch (err) {
    console.error("Reporting Error:", err.message);
    return json(500, { error: "Report Failed" });
  }
};

// THE MAGIC SAUCE: This tells Netlify to run this function every night at 9PM
// Cron syntax: "minute hour day-of-month month day-of-week"
// "0 21 * * *" = 9:00 PM every single day.
export const config = {
  schedule: "0 21 * * *"
};