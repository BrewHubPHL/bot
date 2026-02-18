const { SquareClient, SquareEnvironment } = require('square');
const { createClient } = require('@supabase/supabase-js');
const { verifyServiceSecret } = require('./_auth');

const square = new SquareClient({
  token: process.env.SQUARE_PRODUCTION_TOKEN,
  environment: SquareEnvironment.Production,
});

const supabase = createClient(
  process.env.SUPABASE_URL, 
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

exports.handler = async (event) => {
  // Auth: Only callable from internal Supabase webhook chain
  // Uses timing-safe comparison with null guard
  const serviceAuth = verifyServiceSecret(event);
  if (!serviceAuth.valid) return serviceAuth.response;

  const { record } = JSON.parse(event.body || '{}');

  try {
    // 1. Create the Order in Square
    const { result } = await square.orders.create({
      order: {
        locationId: process.env.SQUARE_LOCATION_ID,
        lineItems: [{
          name: "BrewHub Mobile Order",
          quantity: "1",
          basePriceMoney: { 
            amount: BigInt(record.total_amount_cents), 
            currency: 'USD' 
          }
        }],
        referenceId: record.id
      }
    });

    // 2. Save the Square ID back to our DB
    await supabase
      .from('orders')
      .update({ square_order_id: result.order.id })
      .eq('id', record.id);

    return { statusCode: 200, body: "Square Sync Complete" };
  } catch (error) {
    console.error("Square Sync Error:", error);
    return { statusCode: 500, body: "Failed to Sync with Square" };
  }
};