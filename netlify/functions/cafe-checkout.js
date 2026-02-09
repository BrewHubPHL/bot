const { createClient } = require('@supabase/supabase-js');
const { authorize, json } = require('./_auth');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Server-side price list - the ONLY source of truth for cafe prices
const CAFE_MENU = {
  'Latte': 450,           // $4.50
  'Espresso': 300,        // $3.00
  'Cappuccino': 450,      // $4.50
  'Americano': 350,       // $3.50
  'Croissant': 350,       // $3.50
  'Muffin': 300,          // $3.00
  'Cold Brew': 500,       // $5.00
  'Drip Coffee': 250,     // $2.50
};

exports.handler = async (event) => {
  // CORS
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
      },
      body: '',
    };
  }

  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Method not allowed' });
  }

  // Staff auth required
  const auth = await authorize(event);
  if (!auth.ok) return auth.response;

  try {
    const { cart } = JSON.parse(event.body || '{}');

    if (!Array.isArray(cart) || cart.length === 0) {
      return json(400, { error: 'Cart cannot be empty' });
    }

    // Validate and calculate total using SERVER-SIDE prices only
    let totalCents = 0;
    const validatedItems = [];

    for (const item of cart) {
      const name = item?.name;
      if (!name || !CAFE_MENU[name]) {
        return json(400, { error: `Unknown menu item: ${name}` });
      }

      const priceCents = CAFE_MENU[name];
      totalCents += priceCents;
      validatedItems.push({
        drink_name: name,
        price: priceCents / 100  // Store as decimal for coffee_orders
      });
    }

    // Create order with SERVER-calculated total
    const { data: order, error: orderErr } = await supabase
      .from('orders')
      .insert({
        status: 'paid',
        total_amount_cents: totalCents
      })
      .select()
      .single();

    if (orderErr) {
      console.error('Cafe order create error:', orderErr);
      return json(500, { error: 'Failed to create order' });
    }

    // Insert coffee line items
    const coffeeItems = validatedItems.map(item => ({
      order_id: order.id,
      drink_name: item.drink_name,
      price: item.price
    }));

    const { error: itemErr } = await supabase
      .from('coffee_orders')
      .insert(coffeeItems);

    if (itemErr) {
      console.error('Coffee orders insert error:', itemErr);
      // Order was created, items failed - log but don't fail completely
    }

    return json(200, { 
      success: true, 
      order: order,
      total_cents: totalCents 
    });

  } catch (err) {
    console.error('Cafe checkout error:', err);
    return json(500, { error: 'Checkout failed' });
  }
};
