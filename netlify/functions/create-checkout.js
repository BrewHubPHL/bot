const { SquareClient, SquareEnvironment } = require('square');
const { createClient } = require('@supabase/supabase-js');
const { randomUUID } = require('crypto');
const { checkQuota } = require('./_usage');

const square = new SquareClient({
  token: process.env.SQUARE_PRODUCTION_TOKEN,
  environment: SquareEnvironment.Production,
});

const supabase = createClient(
  process.env.SUPABASE_URL, 
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

exports.handler = async (event) => {
  // Wallet Protection: Rate limit public checkout creation
  const isUnderLimit = await checkQuota('square_checkout');
  if (!isUnderLimit) {
    return { statusCode: 429, body: "Too many checkout requests. Please try again in a few minutes." };
  }

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: { 'Access-Control-Allow-Origin': process.env.SITE_URL || 'https://brewhubphl.com' }, body: '' };
  }
  
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

  try {
    const { cart, user_id, customer_details } = JSON.parse(event.body);

    if (!cart || cart.length === 0) return { statusCode: 400, body: "Cart empty" };

    // Server-side price lookup â€” NEVER trust client-supplied prices
    const itemNames = cart.map(i => i.name);
    const { data: dbProducts, error: dbErr } = await supabase
      .from('merch_products')
      .select('name, price_cents')
      .in('name', itemNames)
      .eq('is_active', true);

    if (dbErr) throw new Error('Failed to load product prices');

    const priceMap = {};
    for (const p of (dbProducts || [])) {
      priceMap[p.name] = p.price_cents;
    }

    // Validate every item has a server-side price
    for (const item of cart) {
      if (priceMap[item.name] === undefined) {
        return {
          statusCode: 400,
          headers: { 'Access-Control-Allow-Origin': process.env.SITE_URL || 'https://brewhubphl.com' },
          body: JSON.stringify({ error: `Unknown product: ${item.name}` })
        };
      }
    }

    // 1. Prepare Square Line Items using SERVER prices
    let totalCents = 0;
    const lineItems = cart.map(item => {
      const serverPrice = priceMap[item.name];
      totalCents += (serverPrice * item.quantity);
      return {
        name: item.name,
        quantity: item.quantity.toString(),
        basePriceMoney: { amount: BigInt(serverPrice), currency: 'USD' },
        note: item.modifiers ? item.modifiers.join(', ') : ''
      };
    });

    const orderId = randomUUID();

    // 2. Create Square Checkout Link
    const { result } = await square.checkoutApi.createPaymentLink({
      idempotencyKey: orderId,
      order: {
        locationId: process.env.SQUARE_LOCATION_ID,
        referenceId: orderId, // Links Square -> Supabase
        lineItems: lineItems,
      },
      checkoutOptions: {
        redirectUrl: `${process.env.URL}/order-confirmation?order_id=${orderId}`, 
      },
      prePopulatedData: { buyerEmail: customer_details?.email }
    });

    // 3. Insert Parent Transaction (orders)
    const { error: parentError } = await supabase
      .from('orders')
      .insert([{
        id: orderId,
        user_id: user_id || null,
        customer_name: customer_details?.name,
        customer_email: customer_details?.email,
        total_amount_cents: totalCents,
        status: 'pending',
        square_order_id: result.paymentLink.orderId
      }]);

    if (parentError) throw parentError;

    // 4. Insert Child Tickets (coffee_orders)
    // We assume your 'cart' items have { name, modifiers }
    const tickets = cart.map(item => ({
      order_id: orderId, // The Link
      customer_id: user_id || null,
      drink_name: item.name,
      customizations: item.modifiers || {}, 
      status: 'pending',
      guest_name: customer_details?.name
    }));

    const { error: childError } = await supabase
      .from('coffee_orders')
      .insert(tickets);

    if (childError) console.error("Ticket Error:", childError);

    return {
      statusCode: 200,
      headers: { 'Access-Control-Allow-Origin': process.env.SITE_URL || 'https://brewhubphl.com' },
      body: JSON.stringify({ url: result.paymentLink.url })
    };

  } catch (err) {
    console.error(err);
    return {
      statusCode: 500,
      headers: { 'Access-Control-Allow-Origin': process.env.SITE_URL || 'https://brewhubphl.com' },
      body: JSON.stringify({ error: 'Checkout failed' })
    };
  }
};
