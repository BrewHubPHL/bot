const { createClient } = require('@supabase/supabase-js');
const { publicBucket } = require('./_token-bucket');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

exports.handler = async (event) => {
  // Per-IP rate limiting
  const clientIp = (event.headers || {})['x-nf-client-connection-ip']
    || (event.headers || {})['x-forwarded-for']?.split(',')[0]?.trim()
    || 'unknown';
  const ipLimit = publicBucket.consume('health:' + clientIp);
  if (!ipLimit.allowed) {
    return {
      statusCode: 429,
      headers: { 'Content-Type': 'application/json', 'Retry-After': String(Math.ceil(ipLimit.retryAfterMs / 1000)) },
      body: JSON.stringify({ error: 'Too many requests. Please try again shortly.' }),
    };
  }

  const checks = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    services: {}
  };

  // Check Supabase connectivity
  try {
    const start = Date.now();
    const { error } = await supabase.from('site_settings').select('key').limit(1);
    checks.services.supabase = {
      status: error ? 'error' : 'ok',
      latency_ms: Date.now() - start
    };
    if (error) {
      console.error('[HEALTH] Supabase error:', error.message);
      checks.status = 'degraded';
    }
  } catch (e) {
    console.error('[HEALTH] Supabase connectivity error:', e.message);
    checks.services.supabase = { status: 'error' };
    checks.status = 'degraded';
  }

  // Config status: only report whether required services are reachable, not which are configured
  // (prevents reconnaissance of which third-party services are in use)

  // --- Strict CORS allowlist ---
  const ALLOWED_ORIGINS = [
    process.env.URL,
    'https://brewhubphl.com',
    'https://www.brewhubphl.com',
  ].filter(Boolean);
  const requestOrigin = (event.headers || {}).origin || (event.headers || {}).Origin;
  const allowedOrigin = (requestOrigin && ALLOWED_ORIGINS.includes(requestOrigin))
    ? requestOrigin
    : 'https://brewhubphl.com';

  return {
    statusCode: checks.status === 'ok' ? 200 : 503,
    headers: { 
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': allowedOrigin,
      'Vary': 'Origin',
      'Cache-Control': 'no-cache'
    },
    body: JSON.stringify(checks, null, 2)
  };
};
