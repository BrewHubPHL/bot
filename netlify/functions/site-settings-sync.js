const { createClient } = require('@supabase/supabase-js');
const { verifyServiceSecret } = require('./_auth');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

exports.handler = async (event) => {
  const ALLOWED_ORIGIN = process.env.SITE_URL || 'https://brewhubphl.com';
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: { 'Access-Control-Allow-Origin': ALLOWED_ORIGIN, 'Access-Control-Allow-Headers': 'Content-Type' },
      body: ''
    };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  // Uses timing-safe comparison with null guard
  const serviceAuth = verifyServiceSecret(event);
  if (!serviceAuth.valid) return serviceAuth.response;

  try {
    const payload = JSON.parse(event.body || '{}');
    const key = payload.key;
    const value = payload.value;

    if (!key) {
      return { statusCode: 400, body: 'Missing key' };
    }

    const { error } = await supabase
      .from('site_settings')
      .upsert({ key, value }, { onConflict: 'key' });

    if (error) throw error;

    return { statusCode: 200, body: JSON.stringify({ success: true }) };
  } catch (err) {
    console.error('site-settings-sync error:', err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Sync failed' }) };
  }
};
