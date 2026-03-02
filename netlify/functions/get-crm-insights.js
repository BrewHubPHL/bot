// get-crm-insights.js — Unified CRM breakdown for the Manager Dashboard.
// Calls the crm_insights() RPC and returns the JSON result.
// Manager-only + rate-limited.
const { createClient } = require('@supabase/supabase-js');
const { authorize, sanitizedError } = require('./_auth');
const { staffBucket } = require('./_token-bucket');

const MISSING_ENV = !process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY;

const ALLOWED_ORIGINS = new Set([
  process.env.SITE_URL,
  process.env.URL,
  'https://brewhubphl.com',
  'https://www.brewhubphl.com',
].filter(Boolean));

function validateOrigin(headers) {
  const origin = headers['origin'] || headers['Origin'] || '';
  if (ALLOWED_ORIGINS.has(origin)) return origin;
  if (origin === '' && process.env.SITE_URL) return process.env.SITE_URL;
  return null;
}

const makeHeaders = (origin) => Object.assign({
  'Content-Type': 'application/json',
  'Cache-Control': 'private, max-age=30',
  'Vary': 'Origin',
}, origin ? { 'Access-Control-Allow-Origin': origin } : {});

exports.handler = async (event) => {
  if (MISSING_ENV) {
    return { statusCode: 500, headers: makeHeaders(null), body: JSON.stringify({ error: 'Server misconfiguration' }) };
  }

  const origin = validateOrigin(event.headers || {});
  const headers = makeHeaders(origin);

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  // Manager auth
  const auth = await authorize(event, { requireManager: true, requirePin: true });
  if (!auth.ok) {
    return Object.assign({}, auth.response, {
      headers: Object.assign({}, auth.response.headers || {}, headers),
    });
  }

  // Rate limit
  const clientIp = event.headers['x-nf-client-connection-ip']
    || event.headers['x-forwarded-for']?.split(',')[0]?.trim()
    || 'unknown';
  const rl = staffBucket.consume(`crm-insights:${clientIp}`);
  if (!rl.allowed) {
    return {
      statusCode: 429,
      headers: Object.assign({}, headers, { 'Retry-After': String(Math.ceil(rl.retryAfterMs / 1000)) }),
      body: JSON.stringify({ error: 'Too many requests' }),
    };
  }

  try {
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
    const { data, error } = await supabase.rpc('crm_insights');
    if (error) throw error;

    return { statusCode: 200, headers, body: JSON.stringify(data || {}) };
  } catch (err) {
    console.error('[CRM-INSIGHTS]', err?.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: sanitizedError(err) }) };
  }
};
