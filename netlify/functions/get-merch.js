const { createClient } = require('@supabase/supabase-js');
const { publicBucket } = require('./_token-bucket');
const { sanitizeInput } = require('./_sanitize');

// --- Strict CORS allowlist ---
const ALLOWED_ORIGINS = [
  process.env.URL,
  'https://brewhubphl.com',
  'https://www.brewhubphl.com',
].filter(Boolean);

function corsOrigin(event) {
  const requestOrigin = (event.headers || {}).origin || (event.headers || {}).Origin;
  if (requestOrigin && ALLOWED_ORIGINS.includes(requestOrigin)) return requestOrigin;
  return 'https://brewhubphl.com';
}

exports.handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': corsOrigin(event),
    'Vary': 'Origin',
    'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=60',
  };

  // CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }

  // Method guard
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  // Per-IP rate limiting
  const clientIp = (event.headers || {})['x-nf-client-connection-ip']
    || (event.headers || {})['x-forwarded-for']?.split(',')[0]?.trim()
    || 'unknown';
  const ipLimit = publicBucket.consume('merch:' + clientIp);
  if (!ipLimit.allowed) {
    return {
      statusCode: 429,
      headers: { ...headers, 'Retry-After': String(Math.ceil(ipLimit.retryAfterMs / 1000)) },
      body: JSON.stringify({ error: 'Too many requests. Please try again shortly.' }),
    };
  }

  try {
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

    const { data, error } = await supabase
      .from('merch_products')
      .select('name, price_cents, description, image_url, checkout_url, sort_order')
      .eq('is_active', true)
      .limit(200);

    if (error) {
      console.error('[GET-MERCH] Supabase error:', error?.message);
      return { statusCode: 500, headers, body: JSON.stringify({ error: 'Failed to load products' }) };
    }

    const safe = (data || []).slice(0, 200).map(item => {
      const name = String(sanitizeInput(item.name || '')).slice(0, 200);
      const description = String(sanitizeInput(item.description || '')).slice(0, 500);
      let price_cents = Number(item.price_cents) || 0;
      if (!Number.isFinite(price_cents) || price_cents < 0) price_cents = 0;
      if (price_cents > 100000) price_cents = 100000;
      const image_url = String(item.image_url || '').slice(0, 2048);
      const checkout_available = !!item.checkout_url;

      return { name, description, price_cents, price_display: `$${(price_cents / 100).toFixed(2)}`, image_url, checkout_available };
    });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify(safe),
    };
  } catch (err) {
    console.error('[GET-MERCH] Error:', err?.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Server error' }) };
  }
};