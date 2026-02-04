const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL, 
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

exports.handler = async (event, context) => {
  try {
    // 1. Pull data from the Daily Sales View
    const { data, error } = await supabase
      .from('daily_sales_report')
      .select('*')
      .single();

    if (error) throw error;

    const report = `
      ☕ BrewHubPHL Daily Sales Summary
      ---------------------------------
      Orders: ${data.total_orders}
      Revenue: $${data.gross_revenue.toFixed(2)}
      Vouchers Used: ${data.vouchers_redeemed}
      ---------------------------------
      Report Generated: ${new Date().toLocaleString()}
    `;

    // 2. Log it so you can see it in Netlify/Terminal logs
    console.log(report);

    // 3. Return the data for the "Beautification Committee"
    return { 
      statusCode: 200, 
      body: JSON.stringify({ message: "Daily report logged", data }) 
    };
  } catch (err) {
    console.error("Reporting Error:", err.message);
    return { statusCode: 500, body: "Report Failed" };
  }
};

// THE MAGIC SAUCE: This tells Netlify to run this function every night at 9PM
// Cron syntax: "minute hour day-of-month month day-of-week"
// "0 21 * * *" = 9:00 PM every single day.
export const config = {
  schedule: "0 21 * * *"
};