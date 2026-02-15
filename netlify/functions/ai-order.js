/**
 * POST /api/order (or /.netlify/functions/ai-order)
 * 
 * API endpoint for AI agents (Elise, Claude) to place cafe orders.
 * Requires API key authentication via X-API-Key header.
 * 
 * Request body:
 * {
 *   "items": [
 *     { "name": "Latte", "quantity": 1 },
 *     { "name": "Croissant", "quantity": 2 }
 *   ],
 *   "customer_name": "Optional customer name",
 *   "customer_phone": "Optional phone for order ready notification",
 *   "notes": "Optional order notes (e.g., oat milk, extra hot)"
 * }
 * 
 * Response:
 * {
 *   "success": true,
 *   "order_id": "abc12345",
 *   "order_number": "ABC1",
 *   "items": [...],
 *   "total_dollars": 9.00,
 *   "total_display": "$9.00",
 *   "message": "Order placed successfully! Your order number is ABC1."
 * }
 */

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Fallback menu prices if DB is unreachable
const FALLBACK_PRICES = {
  'Latte': 450,
  'Espresso': 300,
  'Cappuccino': 450,
  'Americano': 350,
  'Croissant': 350,
  'Muffin': 300,
  'Cold Brew': 500,
  'Drip Coffee': 250,
};

// Load menu prices from DB
async function getMenuPrices() {
  const { data, error } = await supabase
    .from('merch_products')
    .select('name, price_cents')
    .eq('is_active', true);
  
  if (error || !data || data.length === 0) {
    console.warn('[AI-ORDER] Using fallback prices');
    return FALLBACK_PRICES;
  }
  
  const prices = {};
  for (const item of data) {
    prices[item.name] = item.price_cents;
  }
  return prices;
}

// Generate short order number for easy reference
function generateOrderNumber(orderId) {
  return orderId.slice(0, 4).toUpperCase();
}

// Validate API key
function validateApiKey(event) {
  const apiKey = event.headers['x-api-key'] || event.headers['X-Api-Key'];
  const validKey = process.env.BREWHUB_API_KEY;
  
  // If no API key is configured, allow requests (dev mode)
  if (!validKey) {
    console.warn('[AI-ORDER] No BREWHUB_API_KEY configured - allowing request');
    return true;
  }
  
  return apiKey === validKey;
}

function json(status, data) {
  return {
    statusCode: status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-API-Key',
    },
    body: JSON.stringify(data),
  };
}

exports.handler = async (event) => {
  // Handle CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return json(200, {});
  }

  if (event.httpMethod !== 'POST') {
    return json(405, { 
      success: false, 
      error: 'Method not allowed. Use POST to place orders.' 
    });
  }

  // Validate API key
  if (!validateApiKey(event)) {
    return json(401, { 
      success: false, 
      error: 'Invalid or missing API key. Include X-API-Key header.' 
    });
  }

  try {
    const body = JSON.parse(event.body || '{}');
    let { items, customer_name, customer_phone, notes } = body;

    // Handle items as JSON string (from Eleven Labs) or array
    if (typeof items === 'string') {
      try {
        items = JSON.parse(items);
      } catch (e) {
        return json(400, { 
          success: false, 
          error: 'Items must be a valid JSON array. Example: [{"name": "Latte", "quantity": 1}]' 
        });
      }
    }

    // Validate items array
    if (!Array.isArray(items) || items.length === 0) {
      return json(400, { 
        success: false, 
        error: 'Items array is required. Example: { "items": [{"name": "Latte", "quantity": 1}] }' 
      });
    }

    // Load menu prices
    const menuPrices = await getMenuPrices();
    const menuItemNames = Object.keys(menuPrices);

    // Validate and calculate order
    let totalCents = 0;
    const validatedItems = [];

    for (const item of items) {
      const name = item?.name;
      const quantity = Math.max(1, parseInt(item?.quantity) || 1);

      if (!name) {
        return json(400, { 
          success: false, 
          error: 'Each item must have a name.' 
        });
      }

      // Case-insensitive menu item matching
      const matchedName = menuItemNames.find(
        menuName => menuName.toLowerCase() === name.toLowerCase()
      );

      if (!matchedName) {
        return json(400, { 
          success: false, 
          error: `"${name}" is not on our menu.`,
          available_items: menuItemNames,
          suggestion: `Try one of: ${menuItemNames.slice(0, 5).join(', ')}...`
        });
      }

      const priceCents = menuPrices[matchedName];
      const itemTotal = priceCents * quantity;
      totalCents += itemTotal;

      validatedItems.push({
        name: matchedName,
        quantity,
        price_cents: priceCents,
        price_dollars: priceCents / 100,
        subtotal_cents: itemTotal,
        subtotal_dollars: itemTotal / 100,
      });
    }

    // Create order in database
    const { data: order, error: orderErr } = await supabase
      .from('orders')
      .insert({
        status: 'pending',
        total_amount_cents: totalCents,
        customer_name: customer_name || 'AI Order',
        notes: notes || null,
      })
      .select()
      .single();

    if (orderErr) {
      console.error('[AI-ORDER] Order create error:', orderErr);
      return json(500, { 
        success: false, 
        error: 'Failed to create order. Please try again.' 
      });
    }

    const orderNumber = generateOrderNumber(order.id);

    // Insert coffee order line items
    const coffeeItems = [];
    for (const item of validatedItems) {
      for (let i = 0; i < item.quantity; i++) {
        coffeeItems.push({
          order_id: order.id,
          drink_name: item.name,
          price: item.price_dollars,
        });
      }
    }

    const { error: itemErr } = await supabase
      .from('coffee_orders')
      .insert(coffeeItems);

    if (itemErr) {
      console.error('[AI-ORDER] Coffee items insert error:', itemErr);
      // Don't fail - order was created
    }

    // Build confirmation message
    const itemSummary = validatedItems
      .map(i => `${i.quantity}x ${i.name}`)
      .join(', ');

    return json(200, {
      success: true,
      order_id: order.id,
      order_number: orderNumber,
      items: validatedItems,
      total_cents: totalCents,
      total_dollars: totalCents / 100,
      total_display: `$${(totalCents / 100).toFixed(2)}`,
      customer_name: customer_name || null,
      message: `Order placed successfully! Order number: ${orderNumber}. ${itemSummary} - Total: $${(totalCents / 100).toFixed(2)}. It will be ready shortly.`,
    });

  } catch (err) {
    console.error('[AI-ORDER] Error:', err);
    return json(500, { 
      success: false, 
      error: 'Something went wrong. Please try again.' 
    });
  }
};
