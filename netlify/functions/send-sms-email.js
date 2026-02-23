const { createClient } = require('@supabase/supabase-js');
const { authorize, json, verifyServiceSecret } = require('./_auth');
const { requireCsrfHeader } = require('./_csrf');
const { checkQuota } = require('./_usage');
const { sendSMS } = require('./_sms');

// HTML-escape user-supplied strings to prevent injection in emails
const escapeHtml = (s) => String(s || '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;')
  .replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

exports.handler = async (event) => {
  const ALLOWED_ORIGIN = process.env.SITE_URL || 'https://brewhubphl.com';
  // Handle CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-BrewHub-Action',
        'Access-Control-Allow-Methods': 'POST, OPTIONS'
      },
      body: ''
    };
  }

  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Method Not Allowed' });
  }

  // Check internal service secret first (for service-to-service calls)
  // Uses timing-safe comparison with null guard
  const serviceAuth = verifyServiceSecret(event);
  if (serviceAuth.valid) {
    // Service-to-service call authenticated — skip CSRF
  } else {
    // CSRF protection for browser-initiated requests
    const csrfBlock = requireCsrfHeader(event);
    if (csrfBlock) return csrfBlock;

    // Standard auth check for staff
    const auth = await authorize(event);
    if (!auth.ok) return auth.response;
  }

  // Rate limit to prevent Denial-of-Wallet via Twilio/Resend
  const isUnderLimit = await checkQuota('sms_email');
  if (!isUnderLimit) {
    return json(429, { error: 'Notification rate limit exceeded. Please try again later.' });
  }

  try {
    const { recipient_name, phone, email, tracking, pickup_code, value_tier } = JSON.parse(event.body || '{}');

    if (!phone && !email) {
      return json(400, { error: 'Missing phone or email' });
    }

    const codeSnippet = pickup_code ? ` Your pickup code: ${pickup_code}.` : '';
    const idWarning = (value_tier === 'high_value' || value_tier === 'premium') ? ' Photo ID required for pickup.' : '';
    const message = `Yo ${recipient_name || 'neighbor'}! Your package (${tracking || 'Parcel'}) is at the Hub.${codeSnippet}${idWarning} 📦 Grab a coffee when you swing by! Reply STOP to opt out.`;
    let smsSuccess = false;
    let emailSuccess = false;
    let smsSid = null;
    let smsBlocked = false;
    let smsBlockReason = null;

    // Try SMS first if phone provided — routed through TCPA-compliant gateway
    if (phone) {
      const smsResult = await sendSMS({
        to: phone,
        body: message,
        messageType: 'parcel_arrived',
        sourceFunction: 'send-sms-email',
      });

      if (smsResult.sent) {
        smsSuccess = true;
        smsSid = smsResult.sid;
      } else if (smsResult.blocked) {
        smsBlocked = true;
        smsBlockReason = smsResult.reason;
        console.warn(`[SEND-SMS] SMS blocked: ${smsResult.reason}`);
      } else {
        console.error('[SEND-SMS] SMS error:', smsResult.error);
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
                <p>Hi ${escapeHtml(recipient_name) || 'Neighbor'},</p>
                <p>Your package <strong>(${escapeHtml(tracking) || 'Parcel'})</strong> is at <strong>BrewHub PHL</strong>.</p>
                ${pickup_code ? `
                <div style="margin: 20px 0; padding: 15px; background: #f8f4e8; border: 2px solid #d4a843; border-radius: 8px; text-align: center;">
                  <p style="margin: 0 0 5px 0; font-size: 12px; color: #666; text-transform: uppercase; letter-spacing: 2px;">Your Pickup Code</p>
                  <p style="margin: 0; font-size: 32px; font-weight: bold; letter-spacing: 8px; color: #333; font-family: monospace;">${escapeHtml(pickup_code)}</p>
                  <p style="margin: 8px 0 0 0; font-size: 11px; color: #888;">Show this code to the barista when you pick up your package.</p>
                  ${(value_tier === 'high_value' || value_tier === 'premium') ? '<p style="margin: 8px 0 0 0; font-size: 11px; color: #c0392b; font-weight: bold;">⚠️ Government-issued photo ID required for high-value pickup.</p>' : ''}
                </div>` : ''}
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
      headers: { 'Access-Control-Allow-Origin': ALLOWED_ORIGIN },
      body: JSON.stringify({
        success: true,
        sms: smsSuccess,
        email: emailSuccess,
        sid: smsSid,
        sms_blocked: smsBlocked || undefined,
        sms_block_reason: smsBlockReason || undefined,
      })
    };
  } catch (error) {
    console.error('[SEND-SMS] Error:', error);
    return json(500, { error: 'Send failed' });
  }
};
