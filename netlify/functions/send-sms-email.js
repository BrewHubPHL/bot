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
    const { recipient_name, phone, tracking } = JSON.parse(event.body || '{}');

    if (!phone) {
      return json(400, { error: 'Missing phone number' });
    }

    // Format phone number to E.164 (+1XXXXXXXXXX)
    const cleanPhone = phone.replace(/\D/g, '');
    const formattedPhone = cleanPhone.startsWith('1') ? `+${cleanPhone}` : `+1${cleanPhone}`;

    const message = `Yo ${recipient_name || 'neighbor'}! Your package (${tracking || 'Parcel'}) is at the Hub. 📦 Grab a coffee when you swing by! Reply STOP to opt out.`;

    // Use Twilio API
    const twilioSid = process.env.TWILIO_ACCOUNT_SID;
    const twilioToken = process.env.TWILIO_AUTH_TOKEN;
    const twilioPhone = process.env.TWILIO_PHONE_NUMBER;

    if (!twilioSid || !twilioToken || !twilioPhone) {
      console.error('[SEND-SMS] Missing Twilio credentials');
      return json(500, { error: 'SMS not configured' });
    }

    const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/Messages.json`;
    const authHeader = Buffer.from(`${twilioSid}:${twilioToken}`).toString('base64');

    const res = await fetch(twilioUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${authHeader}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        From: twilioPhone,
        To: formattedPhone,
        Body: message
      }).toString()
    });

    const data = await res.json();

    if (!res.ok) {
      console.error('[SEND-SMS] Twilio error:', data);
      return json(res.status, { error: data.message || 'SMS failed', code: data.code });
    }
    
    return {
      statusCode: 200,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ success: true, sid: data.sid, status: data.status })
    };
  } catch (error) {
    console.error('[SEND-SMS] Error:', error);
    return json(500, { error: 'Send failed' });
  }
};
