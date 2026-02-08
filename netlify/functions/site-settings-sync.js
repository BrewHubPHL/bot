const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type' },
      body: ''
    };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const incomingSecret = event.headers['x-brewhub-secret'];
  const localSecret = process.env.INTERNAL_SYNC_SECRET;

  if (!incomingSecret || incomingSecret !== localSecret) {
    return { statusCode: 401, body: 'Unauthorized' };
  }

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
