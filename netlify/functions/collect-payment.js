const { SquareClient, SquareEnvironment } = require('square');
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

exports.handler = async (event) => {
  const auth = await authorize(event);
  if (!auth.ok) return auth.response;

  const { amount, orderId, deviceId } = JSON.parse(event.body);

  try {
    const response = await client.terminal.checkouts.create({
      checkout: {
        amountMoney: {
          amount: amount, // In cents (e.g., 550 for $5.50)
          currency: 'USD'
        },
        deviceOptions: {
          deviceId: deviceId, // The ID of your specific Square Terminal or Stand
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