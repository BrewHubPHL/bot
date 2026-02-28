import { createClient } from '@supabase/supabase-js';
import twilio from 'twilio';

// In V2, we use a standard default export
export default async function (req, context) => {
  if (process.env.ENABLE_DAILY_PULSE !== 'true') {
    console.log('Daily Pulse disabled. Skipping.');
    return new Response('Skipped', { status: 200 });
  }

  try {
    const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
    const supabase = createClient(supabaseUrl, process.env.SUPABASE_SERVICE_ROLE_KEY);
    
    const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

    // ⏱️ 24-Hour Rolling Lookback
    const endTime = new Date();
    const startTime = new Date(endTime.getTime() - (24 * 60 * 60 * 1000));
    
    const startIso = startTime.toISOString();
    const endIso = endTime.toISOString();

    const [
      { data: orders },
      { count: parcelsCheckedIn },
      { count: parcelsPickedUp },
      { count: newResidents }
    ] = await Promise.all([
      supabase.from('orders').select('total_cents, status, comp_reason').gte('created_at', startIso).lt('created_at', endIso),
      supabase.from('parcels').select('*', { count: 'exact', head: true }).eq('status', 'logged').gte('logged_at', startIso).lt('logged_at', endIso),
      supabase.from('parcels').select('*', { count: 'exact', head: true }).eq('status', 'picked_up').gte('picked_up_at', startIso).lt('picked_up_at', endIso),
      supabase.from('residents').select('*', { count: 'exact', head: true }).gte('created_at', startIso).lt('created_at', endIso)
    ]);

    let grossRevenue = 0;
    let completedTickets = 0;
    let compedItems = 0;

    if (orders) {
      orders.forEach(order => {
        if (order.status === 'completed') {
          grossRevenue += (order.total_cents || 0);
          completedTickets++;
        }
        if (order.comp_reason) compedItems++;
      });
    }

    const revenueFormatted = `$${(grossRevenue / 100).toFixed(2)}`;

    const messageBody = `
☕ BrewHub Daily Pulse
-------------------
💰 Revenue: ${revenueFormatted}
🎟️ Tickets: ${completedTickets}
📦 Parcels In: ${parcelsCheckedIn || 0}
✅ Parcels Out: ${parcelsPickedUp || 0}
🚨 Comps/Voids: ${compedItems}
🌱 New Residents: ${newResidents || 0}
`.trim();

    await client.messages.create({
      body: messageBody,
      from: process.env.TWILIO_PHONE_NUMBER,
      to: process.env.ADMIN_PHONE
    });

    console.log('Daily Pulse sent successfully.');
    // V2 uses standard Web Responses
    return new Response('Pulse Sent', { status: 200 });

  } catch (error) {
    console.error('Error generating Daily Pulse:', error);
    return new Response('Internal Server Error', { status: 500 });
  }
};

// ⚙️ V2 API Config Object (No imports needed!)
// Set for 2:20 AM UTC -> 9:20 PM EST for our test
export const config = {
  schedule: "20 2 * * *"
};