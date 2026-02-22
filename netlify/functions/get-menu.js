/**
 * GET /api/menu (or /.netlify/functions/get-menu)
 * 
 * Public API endpoint for AI agents (Elise, Claude) to fetch the cafe menu.
 * Returns menu items in a format optimized for voice ordering.
 * 
 * Response format:
 * {
 *   "cafe_name": "BrewHub PHL",
 *   "location": "Point Breeze, Philadelphia",
 *   "menu_items": [
 *     {
 *       "name": "Latte",
 *       "price_dollars": 4.50,
 *       "price_display": "$4.50",
 *       "description": "Espresso with steamed milk",
 *       "available": true
 *     }
 *   ],
 *   "ordering_instructions": "To place an order, call the place-order endpoint..."
 * }
 */

const { createClient } = require('@supabase/supabase-js');
const { publicBucket } = require('./_token-bucket');

const supabaseUrl = process.env.SUPABASE_URL;
const supabase = createClient(supabaseUrl, process.env.SUPABASE_ANON_KEY);

// Fallback menu if DB is unreachable — keep in sync with merch_products table!
// Last synced: 2026-02-18
const FALLBACK_MENU = [
  { name: 'Latte', price_cents: 450, description: 'Espresso with steamed milk' },
  { name: 'Espresso', price_cents: 300, description: 'Single shot of espresso' },
  { name: 'Americano', price_cents: 350, description: 'Espresso with hot water' },
  { name: 'Cappuccino', price_cents: 450, description: 'Espresso with steamed milk and foam' },
  { name: 'Mocha', price_cents: 525, description: 'Espresso, chocolate, steamed milk, whipped cream' },
  { name: 'Cortado', price_cents: 400, description: 'Espresso cut with warm milk' },
  { name: 'Macchiato', price_cents: 375, description: 'Espresso stained with a dash of foam' },
  { name: 'Iced Latte', price_cents: 500, description: 'Espresso over ice with cold milk' },
  { name: 'Iced Americano', price_cents: 400, description: 'Espresso and cold water over ice' },
  { name: 'Iced Mocha', price_cents: 550, description: 'Chocolate espresso over ice with cold milk' },
  { name: 'Cold Brew', price_cents: 500, description: 'Smooth cold-steeped coffee' },
  { name: 'Lemonade', price_cents: 400, description: 'Fresh-squeezed with cane sugar' },
  { name: 'Smoothie', price_cents: 600, description: 'Mixed berry with banana and oat milk' },
  { name: 'Bagel', price_cents: 350, description: 'Plain or everything, with cream cheese' },
  { name: 'Scone', price_cents: 375, description: 'Cranberry orange, crumbly and sweet' },
  { name: 'Toast', price_cents: 400, description: 'Sourdough with avocado or jam' },
  { name: 'Cookie', price_cents: 275, description: 'Chocolate chip, house-made' },
  { name: 'Breakfast Sandwich', price_cents: 650, description: 'Egg, cheese, bacon on brioche' },
  { name: 'Wrap', price_cents: 600, description: 'Grilled chicken Caesar wrap' },
];

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
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
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
  const ipLimit = publicBucket.consume('menu:' + clientIp);
  if (!ipLimit.allowed) {
    return {
      statusCode: 429,
      headers: { ...headers, 'Retry-After': String(Math.ceil(ipLimit.retryAfterMs / 1000)) },
      body: JSON.stringify({ error: 'Too many requests. Please try again shortly.' }),
    };
  }

  if (event.httpMethod !== 'GET') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' }),
    };
  }

  try {
    // Check if cafe is open/enabled
    const { data: settingsData } = await supabase
      .from('site_settings')
      .select('value')
      .eq('key', 'cafe_enabled')
      .single();

    const cafeEnabled = settingsData?.value !== false;

    // Fetch active menu items
    const { data: products, error } = await supabase
      .from('merch_products')
      .select('name, price_cents, description, is_active')
      .eq('is_active', true)
      .is('archived_at', null)
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true });

    // Use fallback if DB unavailable
    const menuItems = (error || !products || products.length === 0)
      ? FALLBACK_MENU
      : products;

    // Format for AI-friendly consumption
    const formattedMenu = menuItems.map(item => ({
      name: item.name,
      price_cents: item.price_cents,
      price_dollars: item.price_cents / 100,
      price_display: `$${(item.price_cents / 100).toFixed(2)}`,
      description: item.description || '',
      available: true,
    }));

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        cafe_name: 'BrewHub PHL',
        location: 'Point Breeze, Philadelphia',
        address: '1801 S 20th St, Philadelphia, PA 19145',
        cafe_open: cafeEnabled,
        menu_items: formattedMenu,
        ordering_instructions: 'To place an order, POST to https://brewhubphl.com/api/order with X-API-Key header and body: { "items": [{"name": "Latte", "quantity": 1}], "customer_name": "optional" }',
        api_version: '1.0',
      }),
    };
  } catch (err) {
    console.error('[GET-MENU] Error:', err);
    
    // Return fallback menu even on error
    const fallbackFormatted = FALLBACK_MENU.map(item => ({
      name: item.name,
      price_cents: item.price_cents,
      price_dollars: item.price_cents / 100,
      price_display: `$${(item.price_cents / 100).toFixed(2)}`,
      description: item.description || '',
      available: true,
    }));

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        cafe_name: 'BrewHub PHL',
        location: 'Point Breeze, Philadelphia',
        address: '1801 S 20th St, Philadelphia, PA 19145',
        cafe_open: true,
        menu_items: fallbackFormatted,
        ordering_instructions: 'To place an order, POST to https://brewhubphl.com/api/order with X-API-Key header and body: { "items": [{"name": "Latte", "quantity": 1}], "customer_name": "optional" }',
        api_version: '1.0',
        _fallback: true,
      }),
    };
  }
};
