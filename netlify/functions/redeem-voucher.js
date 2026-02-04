const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://rruionkpgswvncypweiv.supabase.co';
const supabase = createClient(
  supabaseUrl, 
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  const { code, orderId } = JSON.parse(event.body || '{}');

  if (!code) return { statusCode: 400, body: "Voucher code required" };

  console.log(`[REDEEM] Looking for voucher: "${code.toUpperCase()}"`);

  try {
    // 1. Check if the voucher is valid and not yet redeemed
    const { data: voucher, error: vError } = await supabase
      .from('vouchers')
      .select('*')
      .eq('code', code.toUpperCase())
      .single();

    console.log(`[REDEEM] Query result:`, { voucher, vError });

    if (vError || !voucher) {
      return { statusCode: 404, body: JSON.stringify({ error: "Voucher not found" }) };
    }

    if (voucher.is_redeemed) {
      return { statusCode: 400, body: JSON.stringify({ error: "Voucher already used" }) };
    }

    // 2. The "Atomic Burn": Mark it as redeemed immediately
    const { error: burnError } = await supabase
      .from('vouchers')
      .update({ 
        is_redeemed: true, 
        redeemed_at: new Date().toISOString(),
        applied_to_order_id: orderId // Link the voucher to the specific order
      })
      .eq('id', voucher.id);

    if (burnError) throw burnError;

    // 3. Apply the discount to the order in Supabase
    // We set total_amount_cents to 0 (or apply a discount)
    await supabase
      .from('orders')
      .update({ 
        total_amount_cents: 0, 
        status: 'paid', // Vouchers count as instant payment
        notes: `Redeemed via voucher: ${code}` 
      })
      .eq('id', orderId);

    console.log(`[VOUCHER REDEEMED] ${code} applied to order ${orderId}`);

    return { 
      statusCode: 200, 
      body: JSON.stringify({ message: "Success! Order is now free." }) 
    };
  } catch (err) {
    console.error("Redemption Error:", err.message);
    return { statusCode: 500, body: "Internal Server Error" };
  }
};