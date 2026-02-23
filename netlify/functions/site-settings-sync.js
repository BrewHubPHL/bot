const { createClient } = require('@supabase/supabase-js');
const { verifyServiceSecret } = require('./_auth');

function sanitizeString(s, max = 2000) {
  if (s === null || s === undefined) return '';
  const str = String(s).replace(/<[^>]*>?/g, '').trim();
  return str.length > max ? str.slice(0, max) : str;
}

function jsonResponse(status, data, origin) {
  const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
  const allowlist = [process.env.SITE_URL, 'https://brewhubphl.com', 'https://www.brewhubphl.com'].filter(Boolean);
  if (origin && allowlist.includes(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Vary'] = 'Origin';
  }
  return { statusCode: status, headers, body: JSON.stringify(data) };
}

exports.handler = async (event) => {
  const hdrs = Object.keys(event.headers || {}).reduce((m, k) => (m[k.toLowerCase()] = event.headers[k], m), {});
  const origin = hdrs.origin;

  if (event.httpMethod === 'OPTIONS') {
    const headers = { 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };
    if (origin && [process.env.SITE_URL, 'https://brewhubphl.com', 'https://www.brewhubphl.com'].includes(origin)) {
      headers['Access-Control-Allow-Origin'] = origin;
      headers['Vary'] = 'Origin';
    }
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return jsonResponse(405, { error: 'Method Not Allowed' }, origin);
  }

  // Service secret verification (timing-safe inside verifyServiceSecret)
  const serviceAuth = verifyServiceSecret(event);
  if (!serviceAuth.valid) return serviceAuth.response;

  // Fail-closed env guard
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('[SITE-SETTINGS] Missing Supabase configuration');
    return jsonResponse(500, { error: 'Server misconfiguration' }, origin);
  }

  // Create Supabase client per-request
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch (e) {
    return jsonResponse(400, { error: 'Invalid JSON body' }, origin);
  }

  const key = sanitizeString(payload.key || '', 200);
  const value = sanitizeString(payload.value || '', 2000);

  if (!key) return jsonResponse(400, { error: 'Missing key' }, origin);

  try {
    const { error } = await supabase
      .from('site_settings')
      .upsert({ key, value }, { onConflict: 'key' });

    if (error) {
      console.error('[SITE-SETTINGS] Upsert error:', String(error.message || error).slice(0, 200));
      return jsonResponse(500, { error: 'Sync failed' }, origin);
    }

    return jsonResponse(200, { success: true }, origin);
  } catch (err) {
    console.error('[SITE-SETTINGS] Unexpected error:', String(err?.message || err).slice(0, 200));
    return jsonResponse(500, { error: 'Sync failed' }, origin);
  }
};
