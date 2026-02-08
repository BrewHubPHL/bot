const { SquareClient, SquareEnvironment } = require('square');
const { createClient } = require('@supabase/supabase-js');

const squareEnvironment = process.env.NODE_ENV === 'production'
  ? SquareEnvironment.Production
  : SquareEnvironment.Sandbox;

const squareToken = process.env.NODE_ENV === 'production'
  ? process.env.SQUARE_ACCESS_TOKEN
  : process.env.SQUARE_SANDBOX_TOKEN;

const square = new SquareClient({
  token: squareToken,
  environment: squareEnvironment,
});

const supabase = createClient(
  process.env.SUPABASE_URL, 
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

exports.handler = async (event) => {
  // Auth: Only callable from internal Supabase webhook chain
  const secret = event.headers?.['x-brewhub-secret'];
  if (!secret || secret !== process.env.INTERNAL_SYNC_SECRET) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

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