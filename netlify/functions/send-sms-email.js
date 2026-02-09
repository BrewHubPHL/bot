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
    const { recipient_name, phone, email, tracking } = JSON.parse(event.body || '{}');

    if (!phone && !email) {
      return json(400, { error: 'Missing phone or email' });
    }

    const message = `Yo ${recipient_name || 'neighbor'}! Your package (${tracking || 'Parcel'}) is at the Hub. 📦 Grab a coffee when you swing by! Reply STOP to opt out.`;
    let smsSuccess = false;
    let emailSuccess = false;
    let smsSid = null;

    // Try SMS first if phone provided
    if (phone) {
      const cleanPhone = phone.replace(/\D/g, '');
      const formattedPhone = cleanPhone.startsWith('1') ? `+${cleanPhone}` : `+1${cleanPhone}`;

      const twilioSid = process.env.TWILIO_ACCOUNT_SID;
      const twilioToken = process.env.TWILIO_AUTH_TOKEN;
      const twilioPhone = process.env.TWILIO_PHONE_NUMBER;

      if (twilioSid && twilioToken && twilioPhone) {
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
        if (res.ok) {
          smsSuccess = true;
          smsSid = data.sid;
          console.log(`[SEND-SMS] Twilio success: ${data.sid}`);
        } else {
          console.error('[SEND-SMS] Twilio error:', data);
        }
      }
    }

    // Email fallback: send if SMS failed OR if email was requested
    if (email && (!smsSuccess || !phone)) {
      const resendKey = process.env.RESEND_API_KEY;
      if (resendKey) {
        const emailRes = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${resendKey}`,
          },
          body: JSON.stringify({
            from: 'BrewHub PHL <info@brewhubphl.com>',
            to: [email],
            subject: 'Your Parcel is Ready at the Hub! 📦☕',
            html: `
              <div style="font-family: sans-serif; max-width: 600px; margin: auto; padding: 20px;">
                <h1>Package Arrived!</h1>
                <p>Hi ${recipient_name || 'Neighbor'},</p>
                <p>Your package <strong>(${tracking || 'Parcel'})</strong> is at <strong>BrewHub PHL</strong>.</p>
                <p>Stop by during cafe hours to pick it up. Fresh coffee waiting!</p>
                <p>— Thomas & The BrewHub PHL Team</p>
              </div>
            `
          })
        });

        if (emailRes.ok) {
          emailSuccess = true;
          console.log(`[SEND-SMS] Email fallback sent to ${email}`);
        } else {
          console.error('[SEND-SMS] Email fallback failed:', await emailRes.text());
        }
      }
    }

    if (!smsSuccess && !emailSuccess) {
      return json(500, { error: 'Both SMS and email failed' });
    }
    
    return {
      statusCode: 200,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ success: true, sms: smsSuccess, email: emailSuccess, sid: smsSid })
    };
  } catch (error) {
    console.error('[SEND-SMS] Error:', error);
    return json(500, { error: 'Send failed' });
  }
};
