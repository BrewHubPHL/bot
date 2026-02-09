const { createClient } = require('@supabase/supabase-js');
const { authorize, json } = require('./_auth');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

exports.handler = async (event) => {
  // Handle CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Methods': 'POST, OPTIONS'
      },
      body: ''
    };
  }

  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Method Not Allowed' });
  }

  // Check internal service secret first (for service-to-service calls)
  const incomingSecret = event.headers?.['x-brewhub-secret'];
  if (incomingSecret && incomingSecret === process.env.INTERNAL_SYNC_SECRET) {
    // Service-to-service call authenticated
  } else {
    // Standard auth check for staff
    const auth = await authorize(event);
    if (!auth.ok) return auth.response;
  }

  try {
    const { recipient_name, phone, carrier, tracking } = JSON.parse(event.body || '{}');

    if (!phone || !carrier) {
      return json(400, { error: 'Missing phone or carrier' });
    }

    const gateways = {
      'verizon': '@vtext.com',
      'xfinity': '@vtext.com',
      'att': '@txt.att.net',
      'tmobile': '@tmomail.net',
      'googlefi': '@msg.fi.google.com',
      'cricket': '@sms.cricketwireless.net'
    };

    const gateway = gateways[carrier.toLowerCase()];
    if (!gateway) {
      return json(400, { error: `Unknown carrier: ${carrier}` });
    }

    const smsAddress = `${phone.replace(/\D/g, '')}${gateway}`;

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'BrewHub Alerts <alerts@brewhubphl.com>',
        to: [smsAddress],
        subject: '',
        text: `Yo ${recipient_name}! Your package (${tracking || 'Parcel'}) is at the Hub. 📦 Grab a coffee when you swing by! Reply STOP to opt out.`,
      }),
    });

    const data = await res.json();
    
    return {
      statusCode: res.status,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ success: res.ok, id: data.id })
    };
  } catch (error) {
    console.error('[SEND-SMS-EMAIL] Error:', error);
    return json(500, { error: 'Send failed' });
  }
};
