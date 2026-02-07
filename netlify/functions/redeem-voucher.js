const { createClient } = require('@supabase/supabase-js');
const { authorize } = require('./_auth');

const supabaseUrl = process.env.SUPABASE_URL;
const supabase = createClient(
  supabaseUrl,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

exports.handler = async (event) => {
  const auth = await authorize(event);
  if (!auth.ok) return auth.response;

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  const { code, orderId } = JSON.parse(event.body || '{}');
  const voucherCode = (code || '').toUpperCase();

  if (!voucherCode) return { statusCode: 400, body: "Voucher code required" };

  console.log(`[REDEEM] Attempt burn: "${voucherCode}"`);

  try {
    // Atomic burn: only update if not already redeemed
    const { data: burnRow, error: burnError } = await supabase
      .from('vouchers')
      .update({
        is_redeemed: true,
        redeemed_at: new Date().toISOString(),
        applied_to_order_id: orderId
      })
      .eq('code', voucherCode)
      .eq('is_redeemed', false)
      .select()
      .single();

    if (burnError) {
      console.error('[REDEEM] Burn error:', burnError);
      return { statusCode: 500, body: JSON.stringify({ error: 'Burn failed' }) };
    }

    if (!burnRow) {
      return { statusCode: 400, body: JSON.stringify({ error: "Voucher not found or already used" }) };
    }

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

    console.log(`[VOUCHER REDEEMED] ${voucherCode} applied to order ${orderId}`);

    return { 
      statusCode: 200, 
      body: JSON.stringify({ message: "Success! Order is now free." }) 
    };
  } catch (err) {
    console.error("Redemption Error:", err.message);
    return { statusCode: 500, body: "Internal Server Error" };
  }
};