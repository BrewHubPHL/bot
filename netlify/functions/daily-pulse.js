import { schedule } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';
import twilio from 'twilio';

const myHandler = async (event, context) => {
  // 🛑 THE KILL SWITCH: Prevents empty texts before grand opening
  if (process.env.ENABLE_DAILY_PULSE !== 'true') {
    console.log('Daily Pulse is currently disabled. Skipping SMS generation.');
    return { statusCode: 200, body: 'Skipped' };
  }

  try {
    // Initialize Supabase (Checking both VITE_ and standard prefix just in case)
    const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
    const supabase = createClient(supabaseUrl, process.env.SUPABASE_SERVICE_ROLE_KEY);
    
    // Initialize Twilio
    const client = twilio(
      process.env.TWILIO_ACCOUNT_SID, 
      process.env.TWILIO_AUTH_TOKEN
    );

    // ⏱️ TIMEZONE SAFE DATE BOUNDARIES
    // Netlify runs on UTC. Instead of guessing midnight EST, we do a rolling 24-hour lookback.
    const endTime = new Date();
    const startTime = new Date(endTime.getTime() - (24 * 60 * 60 * 1000));
    
    const startIso = startTime.toISOString();
    const endIso = endTime.toISOString();

    // 📊 1. FETCH METRICS CONCURRENTLY
    const [
      { data: orders },
      { count: parcelsCheckedIn },
      { count: parcelsPickedUp },
      { count: newResidents }
    ] = await Promise.all([
      // Gross Revenue & Ticket Count
      supabase.from('orders').select('total_cents, status, comp_reason').gte('created_at', startIso).lt('created_at', endIso),
      // Parcels In
      supabase.from('parcels').select('*', { count: 'exact', head: true }).eq('status', 'logged').gte('logged_at', startIso).lt('logged_at', endIso),
      // Parcels Out
      supabase.from('parcels').select('*', { count: 'exact', head: true }).eq('status', 'picked_up').gte('picked_up_at', startIso).lt('picked_up_at', endIso),
      // New Residents Registered
      supabase.from('residents').select('*', { count: 'exact', head: true }).gte('created_at', startIso).lt('created_at', endIso)
    ]);

    // 🧮 2. CRUNCH THE NUMBERS
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

    // 📝 3. FORMAT THE SMS MESSAGE
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

    // 🚀 4. FIRE THE TEXT MESSAGE (Using your existing TWILIO_PHONE_NUMBER variable)
    await client.messages.create({
      body: messageBody,
      from: process.env.TWILIO_PHONE_NUMBER,
      to: process.env.ADMIN_PHONE
    });

    console.log('Daily Pulse sent successfully.');
    return { statusCode: 200, body: 'Pulse Sent' };

  } catch (error) {
    console.error('Error generating Daily Pulse:', error);
    return { statusCode: 500, body: 'Internal Server Error' };
  }
};

// '0 2 * * *' = 2:00 AM UTC -> 9:00 PM EST (Standard Time)
// (Note: During Daylight Saving Time, this shifts to 10:00 PM EDT. We can adjust the cron string in the spring if needed).
export const handler = schedule('0 2 * * *', myHandler);