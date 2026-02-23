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

  // OA-4: validate record shape before use
  if (!record?.user_id || typeof record.total_amount_cents !== 'number') {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid record: user_id and total_amount_cents required' }) };
  }

  try {
    // Get the customer's name for logging (redacted)
    const { data: profile } = await supabase
      .from('profiles')
      .select('full_name')
      .eq('id', record.user_id)
      .single();

    // OA-1: redact PII — log initials only, never full name
    const full = profile?.full_name || '';
    const initials = full
      ? full.split(/\s+/).map(w => w[0]?.toUpperCase() || '').join('.')
      : 'G';
    
    // Log order ID + redacted initials only — no dollar amounts, no full names
    const orderId = String(record.id || 'unknown').slice(0, 8);
    console.log(`🔔 ORDER PAID: ${initials} [${orderId}]`);

    // OA-2: don't return customer name in response
    return { statusCode: 200, body: JSON.stringify({ success: true }) };
  } catch (err) {
    console.error('Order announcer error:', err?.message);
    return { statusCode: 500, body: JSON.stringify({ error: 'Announcement failed' }) };
  }
};