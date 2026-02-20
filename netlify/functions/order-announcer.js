const { createClient } = require('@supabase/supabase-js');
const { verifyServiceSecret } = require('./_auth');

const supabaseUrl = process.env.SUPABASE_URL;
const supabase = createClient(supabaseUrl, process.env.SUPABASE_SERVICE_ROLE_KEY);

exports.handler = async (event) => {
  // Internal-only: called by supabase-webhook.js
  // Uses timing-safe comparison with null guard
  const serviceAuth = verifyServiceSecret(event);
  if (!serviceAuth.valid) return serviceAuth.response;

  let record;
  try {
    ({ record } = JSON.parse(event.body || '{}'));
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON body' }) };
  }

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