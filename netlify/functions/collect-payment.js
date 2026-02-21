const { SquareClient, SquareEnvironment } = require('square');
const { createClient } = require('@supabase/supabase-js');
const { authorize } = require('./_auth');
const { requireCsrfHeader } = require('./_csrf');

// 1. Initialize Square for Production using your Netlify variables
const client = new SquareClient({
  token: process.env.SQUARE_PRODUCTION_TOKEN,
  environment: SquareEnvironment.Production,
});

// 2. Initialize Supabase
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

exports.handler = async (event) => {
  // Check for POST request
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  // CSRF protection
  const csrfBlock = requireCsrfHeader(event);
  if (csrfBlock) return csrfBlock;

  // Require staff authentication for terminal checkout
  const auth = await authorize(event, { requirePin: true });
  if (!auth.ok) return auth.response;

  let orderId, deviceId;
  try {
    ({ orderId, deviceId } = JSON.parse(event.body || '{}'));
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON body' }) };
  }

  if (!orderId) {
    return { statusCode: 400, body: JSON.stringify({ error: 'orderId is required' }) };
  }

  try {
    // 3. Fetch the order details from Supabase
    const { data: order, error: orderError } = await supabase
      .from('orders')
      .select('total_amount_cents, status')
      .eq('id', orderId)
      .single();

    if (orderError || !order) {
      console.error('Order lookup failed:', orderError);
      return { statusCode: 404, body: JSON.stringify({ error: 'Order not found' }) };
    }

    // 4. Prevent double-charging
    if (order.status === 'paid') {
      return { statusCode: 409, body: JSON.stringify({ error: 'Order already paid' }) };
    }

    const amount = Number(order.total_amount_cents || 0);
    if (!amount || amount <= 0) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Order total is invalid' }) };
    }

    // 5. Use provided deviceId, env var, or error if none configured
    const terminalDeviceId = deviceId || process.env.SQUARE_TERMINAL_DEVICE_ID;
    if (!terminalDeviceId) {
      return { statusCode: 400, body: JSON.stringify({ error: 'No Square Terminal device configured. Set SQUARE_TERMINAL_DEVICE_ID in Netlify.' }) };
    }

    // 6. Create Terminal Checkout
    const response = await client.terminal.checkouts.create({
      checkout: {
        amountMoney: {
          amount: BigInt(Math.round(amount)), // Square SDK requires BigInt for cents
          currency: 'USD'
        },
        // IMPORTANT: Tie this sale to the Point Breeze location
        locationId: process.env.SQUARE_LOCATION_ID, 
        deviceOptions: {
          deviceId: terminalDeviceId, 
          skipReceiptScreen: false,
          collectSignature: true
        },
        referenceId: orderId // Links Square transaction to Supabase order ID
      },
      idempotencyKey: require('crypto').randomBytes(12).toString('hex')
    });

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: "Checkout created",
        checkout: response.result.checkout
      })
    };

  } catch (error) {
    console.error("Terminal Error:", error);
    return { 
      statusCode: 500, 
      body: JSON.stringify({ error: "Failed to create terminal checkout" }) 
    };
  }
};