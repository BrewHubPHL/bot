require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

// 1. Setup your credentials
// Get service role key from: Supabase Dashboard > Settings > API > service_role (secret)
const supabase = createClient(
  'https://rruionkpgswvncypweiv.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function simulateOrder() {
  console.log("🚀 Starting BrewHubPHL Test Flow...");

  // 2. Insert a new 'pending' order
  // This triggers: Supabase Trigger -> Webhook Router -> Square Sync
  const { data, error } = await supabase
    .from('orders')
    .insert({
      total_amount_cents: 450, // $4.50
      status: 'pending'
    })
    .select()
    .single();

  if (error) {
    console.error("❌ Failed to insert order:", error);
    return;
  }

  console.log(`✅ Order ${data.id} created. Checking Square sync...`);

  // 3. Wait 5 seconds for the Square Sync to finish
  setTimeout(async () => {
    const { data: updatedOrder } = await supabase
      .from('orders')
      .select('square_order_id, status')
      .eq('id', data.id)
      .single();

    console.log(`📦 Square Order ID: ${updatedOrder.square_order_id}`);

    // 4. Manually update to 'paid' to trigger ElevenLabs
    // In production, your Square webhook or payment logic would do this
    console.log("💰 Simulating successful payment...");
    await supabase
      .from('orders')
      .update({ status: 'paid' })
      .eq('id', data.id);

    console.log("🔊 ElevenLabs announcement should fire now!");
  }, 5000);
}

simulateOrder();