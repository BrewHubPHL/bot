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

const supabaseUrl = process.env.SUPABASE_URL;
const supabase = createClient(supabaseUrl, process.env.SUPABASE_SERVICE_ROLE_KEY);

// Fallback menu if DB is unreachable
const FALLBACK_MENU = [
  { name: 'Drip Coffee', price_cents: 250, description: 'Fresh brewed house coffee' },
  { name: 'Espresso', price_cents: 300, description: 'Single shot of espresso' },
  { name: 'Americano', price_cents: 350, description: 'Espresso with hot water' },
  { name: 'Latte', price_cents: 450, description: 'Espresso with steamed milk' },
  { name: 'Cappuccino', price_cents: 450, description: 'Espresso with steamed milk and foam' },
  { name: 'Cold Brew', price_cents: 500, description: 'Smooth cold-steeped coffee' },
  { name: 'Croissant', price_cents: 350, description: 'Buttery pastry' },
  { name: 'Muffin', price_cents: 300, description: 'Freshly baked muffin' },
];

exports.handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  // Handle CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
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
