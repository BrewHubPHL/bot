const { createClient } = require('@supabase/supabase-js');
const { publicBucket } = require('./_token-bucket');

exports.handler = async (event) => {
  // Per-IP rate limiting
  const clientIp = (event.headers || {})['x-nf-client-connection-ip']
    || (event.headers || {})['x-forwarded-for']?.split(',')[0]?.trim()
    || 'unknown';
  const ipLimit = publicBucket.consume('merch:' + clientIp);
  if (!ipLimit.allowed) {
    return {
      statusCode: 429,
      headers: { 'Content-Type': 'application/json', 'Retry-After': String(Math.ceil(ipLimit.retryAfterMs / 1000)) },
      body: JSON.stringify({ error: 'Too many requests. Please try again shortly.' }),
    };
  }

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

  const { data, error } = await supabase
    .from('merch_products')
    .select('name, price_cents, description, image_url, checkout_url, sort_order')
    .eq('is_active', true);

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=60',
    },
    body: JSON.stringify(data || [])
  };
};