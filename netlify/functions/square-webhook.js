const { createClient } = require('@supabase/supabase-js');
const { SquareClient, SquareEnvironment } = require('square');
const QRCode = require('qrcode');
const crypto = require('crypto');

const supabaseUrl = process.env.SUPABASE_URL;
const supabase = createClient(supabaseUrl, process.env.SUPABASE_SERVICE_ROLE_KEY);

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

// Generate unique voucher codes like BRW-K8L9P2
const generateVoucherCode = () => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // No 'I' or '1' to avoid confusion
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return `BRW-${code}`;
};

exports.handler = async (event) => {
  const signatureKey = process.env.SQUARE_WEBHOOK_SIGNATURE;
  const signatureHeader = event.headers['x-square-signature'];
  const rawBody = event.body || '';

  if (signatureKey && signatureHeader) {
    const baseUrl = process.env.SQUARE_WEBHOOK_URL || process.env.URL;
    const notificationUrl = `${baseUrl}/.netlify/functions/square-webhook`;
    const payload = notificationUrl + rawBody;
    const digest = crypto
      .createHmac('sha256', signatureKey)
      .update(payload, 'utf8')
      .digest('base64');

    if (digest !== signatureHeader) {
      console.error('Invalid Square webhook signature');
      return { statusCode: 401, body: JSON.stringify({ error: 'Invalid signature' }) };
    }
  } else {
    console.warn('Square webhook signature not verified: missing header or signature key');
  }

  const body = JSON.parse(rawBody);
  console.log('Square webhook received:', body.type);

  if (body.type !== 'payment.updated') {
    return { statusCode: 200, body: JSON.stringify({ skipped: body.type }) };
  }

  const payment = body.data?.object?.payment;
  if (!payment || payment.status !== 'COMPLETED') {
    return { statusCode: 200, body: JSON.stringify({ status: payment?.status || 'no payment' }) };
  }

  // 1. Get our internal Order ID from Square's reference_id
  const orderId = payment.reference_id;
  
  // Safety Check for Test Events or missing IDs
  if (!orderId || orderId === 'undefined') {
    console.log('⚠️ Skipping lookup: No valid reference_id found (likely a Test Event).');
    return { 
      statusCode: 200, 
      body: JSON.stringify({ message: "Test received successfully, no DB update needed." }) 
    };
  }

  console.log(`Processing payment for Order: ${orderId}`);

  // 2. Look up the order in Supabase to find the user_id
  const { data: order, error: orderError } = await supabase
    .from('orders')
    .select('user_id')
    .eq('id', orderId)
    .single();

  if (orderError || !order) {
    console.error("Order lookup failed:", orderError);
    return { statusCode: 500, body: "Could not link Square payment to Supabase user" };
  }

  const userId = order.user_id;

  // 3. Update the Order status to 'paid'
  const { error: updateError } = await supabase
    .from('orders')
    .update({ 
      status: 'paid',
      payment_id: payment.id 
    })
    .eq('id', orderId);

  if (updateError) {
    console.error("Failed to update order status:", updateError);
    return { statusCode: 500 };
  }

  // 4. Increment points using the RPC function we wrote
  // Note: Your RPC parameter name should match (e.g., 'target_user_id')
  const { data: loyalty, error: loyaltyError } = await supabase.rpc('increment_loyalty', { 
    target_user_id: userId 
  });

  if (loyaltyError) {
    console.error("Loyalty increment failed:", loyaltyError);
  } else if (loyalty && loyalty.loyalty_points % 500 === 0) {
    // 50 pts per purchase, 500 pts = free coffee (10 purchases)
    // Generate voucher code and QR
    const newVoucherCode = generateVoucherCode();
    
    // Generate the QR Code as a Data URL (image string)
    const qrDataUrl = await QRCode.toDataURL(newVoucherCode, {
      color: {
        dark: '#000000',
        light: '#FFFFFF'
      },
      width: 300
    });
    
    const { error: voucherError } = await supabase
      .from('vouchers')
      .insert([{ 
        user_id: userId, 
        code: newVoucherCode,
        qr_code_base64: qrDataUrl
      }]);

    if (voucherError) {
      console.error("Voucher creation failed:", voucherError);
    } else {
      console.log(`[VOUCHER + QR GENERATED] Code ${newVoucherCode} is ready for scanning.`);
    }
    
    console.log(`VIP Alert: User ${userId} earned a free coffee!`);
    // This is where ElevenLabs can shout it out
  }

  // 5. Decrement inventory - derive quantities from Square line items
  let cupCount = 0;
  let beanCount = 0;
  let lineItems = [];

  if (payment.order_id) {
    try {
      const { result } = await square.ordersApi.retrieveOrder(payment.order_id);
      lineItems = result?.order?.lineItems || [];
    } catch (err) {
      console.error('Square order lookup failed:', err);
    }
  }

  if (lineItems.length > 0) {
    for (const item of lineItems) {
      const name = (item?.name || '').toLowerCase();
      const quantity = Number(item?.quantity || 0);

      if (name.includes('whole bean') || name.includes('beans')) {
        beanCount += quantity || 0;
      } else {
        cupCount += quantity || 0;
      }
    }
  }

  if (cupCount === 0) {
    const { count, error: cupsError } = await supabase
      .from('coffee_orders')
      .select('id', { count: 'exact', head: true })
      .eq('order_id', orderId);

    if (cupsError) {
      console.error("Cup count lookup failed:", cupsError);
    } else if (typeof count === 'number' && count > 0) {
      cupCount = count;
    }
  }

  if (cupCount > 0) {
    const { error: inventoryError } = await supabase.rpc('decrement_inventory', { 
      item: '12oz Cups', 
      amount: cupCount 
    });

    if (inventoryError) {
      console.error("Inventory decrement failed:", inventoryError);
    } else {
      console.log(`[INVENTORY] Decremented 12oz Cups by ${cupCount}`);
    }
  }
  
  if (inventoryError) {
    console.error("Inventory decrement failed:", inventoryError);
  } else {
    console.log(`[INVENTORY] Decremented 12oz Cups by 1`);
  }

  // 6. If it's a bulk bean sale, decrement beans too
  if (beanCount > 0) {
    await supabase.rpc('decrement_inventory', { 
      item: 'Espresso Beans', 
      amount: beanCount 
    });
    console.log(`[INVENTORY] Decremented Espresso Beans by ${beanCount}`);
  }

  return { statusCode: 200, body: JSON.stringify({ received: true }) };
};