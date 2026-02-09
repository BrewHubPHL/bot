const { createClient } = require('@supabase/supabase-js');
const { authorize, json } = require('./_auth');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Fallback menu if DB is unreachable (defense-in-depth)
const FALLBACK_MENU = {
  'Latte': 450,
  'Espresso': 300,
  'Cappuccino': 450,
  'Americano': 350,
  'Croissant': 350,
  'Muffin': 300,
  'Cold Brew': 500,
  'Drip Coffee': 250,
};

// Load cafe menu from merch_products table
async function getCafeMenu() {
  const { data, error } = await supabase
    .from('merch_products')
    .select('name, price_cents')
    .eq('is_active', true);
  
  if (error || !data || data.length === 0) {
    console.warn('[CAFE] Using fallback menu - DB unavailable or empty');
    return FALLBACK_MENU;
  }
  
  const menu = {};
  for (const item of data) {
    menu[item.name] = item.price_cents;
  }
  return menu;
}

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

    // Load menu from DB (with fallback)
    const CAFE_MENU = await getCafeMenu();

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

    // Send order confirmation email if customer email provided
    const { customer_email, customer_name } = JSON.parse(event.body || '{}');
    if (customer_email && process.env.RESEND_API_KEY) {
      const itemList = validatedItems.map(i => `${i.drink_name} - $${i.price.toFixed(2)}`).join('<br>');
      fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
        },
        body: JSON.stringify({
          from: 'BrewHub PHL <info@brewhubphl.com>',
          to: [customer_email],
          subject: `BrewHub Order Confirmed ☕ #${order.id.slice(0,8)}`,
          html: `
            <div style="font-family: sans-serif; max-width: 600px; margin: auto; padding: 20px;">
              <h1 style="color: #333;">Thanks for your order!</h1>
              <p>Hi ${customer_name || 'there'},</p>
              <div style="background: #f9f9f9; padding: 15px; border-radius: 8px; margin: 20px 0;">
                <p style="margin: 0;"><strong>Order #:</strong> ${order.id.slice(0,8).toUpperCase()}</p>
                <p style="margin: 10px 0 0 0;"><strong>Items:</strong></p>
                <p style="margin: 5px 0;">${itemList}</p>
                <hr style="border: 0; border-top: 1px solid #ddd; margin: 15px 0;">
                <p style="margin: 0; font-size: 1.2em;"><strong>Total: $${(totalCents/100).toFixed(2)}</strong></p>
              </div>
              <p>Your order is being prepared. See you soon!</p>
              <p>— The BrewHub PHL Team</p>
            </div>
          `
        })
      }).catch(err => console.error('[CAFE] Email send error:', err));
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
