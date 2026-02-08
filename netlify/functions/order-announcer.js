const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabase = createClient(supabaseUrl, process.env.SUPABASE_SERVICE_ROLE_KEY);

exports.handler = async (event) => {
  // Internal-only: called by supabase-webhook.js
  const incomingSecret = event.headers?.['x-brewhub-secret'];
  if (!incomingSecret || incomingSecret !== process.env.INTERNAL_SYNC_SECRET) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  const { record } = JSON.parse(event.body || '{}');

  try {
    // Get the customer's name for logging
    const { data: profile } = await supabase
      .from('profiles')
      .select('full_name')
      .eq('id', record.user_id)
      .single();

    const name = profile?.full_name || "Guest";
    
    // Log for monitoring - orders show up in real-time on cafe.html via Supabase subscription
    console.log(`🔔 ORDER PAID: ${name} - $${(record.total_amount_cents / 100).toFixed(2)}`);

    return { statusCode: 200, body: JSON.stringify({ success: true, customer: name }) };
  } catch (err) {
    console.error("Order announcer error:", err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Announcement failed' }) };
  }
};