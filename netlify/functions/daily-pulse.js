import { createClient } from '@supabase/supabase-js';
import twilio from 'twilio';

function withSourceComment(query, tag) {
  if (typeof query?.comment === 'function') {
    return query.comment(`source: ${tag}`);
  }
  return query;
}

export default async function (req, context) {
  if (process.env.ENABLE_DAILY_PULSE !== 'true') return new Response('Disabled');

  try {
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
    const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

    const endTime = new Date();
    const startTime = new Date(endTime.getTime() - (24 * 60 * 60 * 1000));

    const [orders, parcelsIn, parcelsOut, newCustomers] = await Promise.all([
      withSourceComment(supabase.from('orders').select('status, total_amount_cents').gte('created_at', startTime.toISOString()), 'pulse-orders'),
      withSourceComment(supabase.from('parcels').select('id', { count: 'exact', head: true }).eq('status', 'logged').gte('logged_at', startTime.toISOString()), 'pulse-parcels-inbound'),
      withSourceComment(supabase.from('parcels').select('id', { count: 'exact', head: true }).eq('status', 'picked_up').gte('picked_up_at', startTime.toISOString()), 'pulse-parcels-outbound'),
      supabase.from('customers').select('*', { count: 'exact', head: true }).gte('created_at', startTime.toISOString())
    ]);

    // Abort SMS if any query failed — do not send misleading zeros
    const dbErrors = [
      orders.error && `orders: ${orders.error.message}`,
      parcelsIn.error && `parcelsIn: ${parcelsIn.error.message}`,
      parcelsOut.error && `parcelsOut: ${parcelsOut.error.message}`,
      newCustomers.error && `newCustomers: ${newCustomers.error.message}`,
    ].filter(Boolean);
    if (dbErrors.length > 0) {
      console.error('[DAILY-PULSE] DB query errors — aborting SMS:', dbErrors.join('; '));
      return new Response(JSON.stringify({ error: 'DB query failed', details: dbErrors }), { status: 502 });
    }

    const rev = orders.data?.reduce((acc, o) => acc + (o.status === 'completed' ? o.total_amount_cents : 0), 0) || 0;

    const message = `
☕ BrewHub Pulse
-------------------
💰 Revenue: $${(rev / 100).toFixed(2)}
📦 Parcels: ${parcelsIn.count} in / ${parcelsOut.count} out
🌱 New Customers: ${newCustomers.count}
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