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

// UUID v4 format check
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  // Auth: Only callable from internal Supabase webhook chain
  // Uses timing-safe comparison with null guard
  const serviceAuth = verifyServiceSecret(event);
  if (!serviceAuth.valid) return serviceAuth.response;

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, body: 'Invalid JSON' };
  }

  const record = body.record;
  if (!record || typeof record !== 'object') {
    return { statusCode: 400, body: 'Missing record' };
  }

  // Validate record.id is a UUID
  if (!record.id || !UUID_RE.test(String(record.id))) {
    return { statusCode: 400, body: 'Invalid record ID' };
  }

  // Validate total_amount_cents is a positive integer
  const amountCents = Number(record.total_amount_cents);
  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    return { statusCode: 400, body: 'Invalid amount' };
  }

  try {
    // 1. Create the Order in Square
    const { result } = await square.orders.create({
      order: {
        locationId: process.env.SQUARE_LOCATION_ID,
        lineItems: [{
          name: "BrewHub Mobile Order",
          quantity: "1",
          basePriceMoney: { 
            amount: BigInt(amountCents), 
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
    console.error("Square Sync Error:", error?.message);
    return { statusCode: 500, body: "Failed to Sync with Square" };
  }
};