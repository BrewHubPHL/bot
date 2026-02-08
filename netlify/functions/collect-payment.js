const { SquareClient, SquareEnvironment } = require('square');
const { createClient } = require('@supabase/supabase-js');
const { authorize, json } = require('./_auth');

const squareEnvironment = process.env.NODE_ENV === 'production'
  ? SquareEnvironment.Production
  : SquareEnvironment.Sandbox;

const squareToken = process.env.NODE_ENV === 'production'
  ? process.env.SQUARE_ACCESS_TOKEN
  : process.env.SQUARE_SANDBOX_TOKEN;

const client = new SquareClient({
  token: squareToken,
  environment: squareEnvironment,
});

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

exports.handler = async (event) => {
  const auth = await authorize(event);
  if (!auth.ok) return auth.response;

  const { orderId, deviceId } = JSON.parse(event.body || '{}');

  if (!orderId) {
    return json(400, { error: 'orderId is required' });
  }

  const { data: order, error: orderError } = await supabase
    .from('orders')
    .select('total_amount_cents, status')
    .eq('id', orderId)
    .single();

  if (orderError || !order) {
    console.error('Collect-payment order lookup failed:', orderError);
    return json(404, { error: 'Order not found' });
  }

  if (order.status === 'paid') {
    return json(409, { error: 'Order already paid' });
  }

  const amount = Number(order.total_amount_cents || 0);
  if (!amount || amount <= 0) {
    return json(400, { error: 'Order total is invalid' });
  }

  const terminalDeviceId = deviceId || process.env.SQUARE_DEVICE_ID;
  if (!terminalDeviceId) {
    return json(400, { error: 'Missing Square device ID' });
  }

  try {
    const response = await client.terminal.checkouts.create({
      checkout: {
        amountMoney: {
          amount: amount, // In cents (e.g., 550 for $5.50)
          currency: 'USD'
        },
        deviceOptions: {
          deviceId: terminalDeviceId, // The ID of your specific Square Terminal or Stand
          skipReceiptScreen: false,
          collectSignature: true
        },
        referenceId: orderId // This links back to your Supabase order!
      },
      idempotencyKey: require('crypto').randomBytes(12).toString('hex')
    });

    return {
      statusCode: 200,
      body: JSON.stringify(response.result)
    };
  } catch (error) {
    console.error("Terminal Error:", error);
    return { statusCode: 500, body: JSON.stringify(error) };
  }
};