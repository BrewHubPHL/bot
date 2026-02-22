const { createClient } = require('@supabase/supabase-js');
const { publicBucket } = require('./_token-bucket');

const supabaseUrl = process.env.SUPABASE_URL;
const supabase = createClient(supabaseUrl, process.env.SUPABASE_ANON_KEY);

// --- Strict CORS allowlist ---
const ALLOWED_ORIGINS = [
  process.env.URL,                   // Netlify deploy URL
  'https://brewhubphl.com',
  'https://www.brewhubphl.com',
].filter(Boolean);

function corsOrigin(event) {
  const requestOrigin = (event.headers || {}).origin || (event.headers || {}).Origin;
  if (requestOrigin && ALLOWED_ORIGINS.includes(requestOrigin)) return requestOrigin;
  return 'https://brewhubphl.com'; // strict default
}

exports.handler = async (event) => {
    const headers = {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': corsOrigin(event),
        'Vary': 'Origin',
        'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=60',
    };

    // Handle CORS preflight
    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers, body: '' };
    }

    // Per-IP rate limiting
    const clientIp = event.headers['x-nf-client-connection-ip']
      || event.headers['x-forwarded-for']?.split(',')[0]?.trim()
      || 'unknown';
    const ipLimit = publicBucket.consume('shop:' + clientIp);
    if (!ipLimit.allowed) {
      return {
        statusCode: 429,
        headers: { ...headers, 'Retry-After': String(Math.ceil(ipLimit.retryAfterMs / 1000)) },
        body: JSON.stringify({ error: 'Too many requests. Please try again shortly.' }),
      };
    }

    // Public endpoint - no auth required for browsing shop products
    // Uses service role key to read products but only exposes safe fields

    try {
        // Check shop status
        const { data: settingsData } = await supabase
            .from('site_settings')
            .select('value')
            .eq('key', 'shop_enabled')
            .single();

        const shopEnabled = settingsData?.value !== false;

        if (!shopEnabled) {
            return {
                statusCode: 200,
                headers,
                body: JSON.stringify({ shopEnabled: false, products: [] }),
            };
        }

        // Fetch active products
        const { data: products, error } = await supabase
            .from('merch_products')
            .select('name, price_cents, description, image_url, checkout_url, sort_order, category')
            .eq('is_active', true)
            .order('sort_order', { ascending: true })
            .order('name', { ascending: true });

        if (error) {
            console.error('Shop data fetch error:', error);
            return {
                statusCode: 500,
                headers,
                body: JSON.stringify({ error: 'Failed to load products' }),
            };
        }

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({ shopEnabled: true, products: products || [] }),
        };
    } catch (err) {
        console.error('Shop data error:', err);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ error: 'Server error' }),
        };
    }
};
