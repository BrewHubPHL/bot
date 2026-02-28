import { createClient } from '@supabase/supabase-js';
import twilio from 'twilio';

export default async function (req, context) {
  if (process.env.ENABLE_DAILY_PULSE !== 'true') return new Response('Disabled');

  try {
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
    const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

    const endTime = new Date();
    const startTime = new Date(endTime.getTime() - (24 * 60 * 60 * 1000));

    const [orders, parcelsIn, parcelsOut, residents] = await Promise.all([
      supabase.from('orders').select('*').gte('created_at', startTime.toISOString()),
      supabase.from('parcels').select('*', { count: 'exact', head: true }).eq('status', 'logged').gte('logged_at', startTime.toISOString()),
      supabase.from('parcels').select('*', { count: 'exact', head: true }).eq('status', 'picked_up').gte('picked_up_at', startTime.toISOString()),
      supabase.from('residents').select('*', { count: 'exact', head: true }).gte('created_at', startTime.toISOString())
    ]);

    const rev = orders.data?.reduce((acc, o) => acc + (o.status === 'completed' ? o.total_cents : 0), 0) || 0;

    const message = `
☕ BrewHub Pulse
-------------------
💰 Revenue: $${(rev / 100).toFixed(2)}
📦 Parcels: ${parcelsIn.count} in / ${parcelsOut.count} out
🌱 New Residents: ${residents.count}
`.trim();

    await client.messages.create({
      body: message,
      from: process.env.TWILIO_PHONE_NUMBER,
      to: process.env.ADMIN_PHONE
    });

    return new Response('Sent');
  } catch (e) {
    return new Response(e.message, { status: 500 });
  }
};

export const config = {
  schedule: "0 3 * * *" // 3:00 AM UTC = 10:00 PM EST
};