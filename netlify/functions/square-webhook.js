const { createClient } = require('@supabase/supabase-js');
const QRCode = require('qrcode');

const supabaseUrl = 'https://rruionkpgswvncypweiv.supabase.co';
const supabase = createClient(supabaseUrl, process.env.SUPABASE_SERVICE_ROLE_KEY);

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
  const body = JSON.parse(event.body);
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
  } else if (loyalty && loyalty.loyalty_points % 10 === 0) {
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

  // 5. Decrement inventory - every coffee sale uses 1 cup
  const { error: inventoryError } = await supabase.rpc('decrement_inventory', { 
    item: '12oz Cups', 
    amount: 1 
  });
  
  if (inventoryError) {
    console.error("Inventory decrement failed:", inventoryError);
  } else {
    console.log(`[INVENTORY] Decremented 12oz Cups by 1`);
  }

  // 6. If it's a bulk bean sale, decrement beans too
  if (payment.note && payment.note.includes('Whole Bean')) {
    await supabase.rpc('decrement_inventory', { 
      item: 'Espresso Beans', 
      amount: 1 
    });
    console.log(`[INVENTORY] Decremented Espresso Beans by 1`);
  }

  return { statusCode: 200, body: JSON.stringify({ received: true }) };
};