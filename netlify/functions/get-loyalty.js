/**
 * GET/POST /api/loyalty (or /.netlify/functions/get-loyalty)
 * 
 * API endpoint for AI agents to look up loyalty points and QR codes.
 * Requires API key authentication via X-API-Key header.
 * 
 * Query params (GET) or body (POST):
 * - email: Customer email
 * - phone: Customer phone (alternative)
 * - send_sms: If true, text the QR code link to the customer
 */

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function validateApiKey(event) {
  const crypto = require('crypto');
  const apiKey = event.headers['x-api-key'] || event.headers['X-Api-Key'];
  const validKey = process.env.BREWHUB_API_KEY;
  if (!validKey) { console.error('[LOYALTY] BREWHUB_API_KEY not configured'); return false; }
  if (!apiKey) return false;
  const bufA = Buffer.from(String(apiKey));
  const bufB = Buffer.from(String(validKey));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function json(status, data) {
  const ALLOWED_ORIGIN = process.env.SITE_URL || 'https://brewhubphl.com';
  return {
    statusCode: status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-API-Key',
    },
    body: JSON.stringify(data),
  };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return json(200, {});
  }

  if (!validateApiKey(event)) {
    return json(401, { success: false, error: 'Invalid or missing API key' });
  }

  try {
    // Parse params from query string or body
    let email, phone, send_sms;
    
    if (event.httpMethod === 'GET') {
      const params = event.queryStringParameters || {};
      email = params.email;
      phone = params.phone;
      send_sms = params.send_sms === 'true';
    } else {
      const body = JSON.parse(event.body || '{}');
      email = body.email;
      phone = body.phone;
      send_sms = body.send_sms;
    }

    if (!email && !phone) {
      return json(400, { 
        success: false, 
        error: 'Email or phone number required' 
      });
    }

    let profile = null;
    let lookupEmail = email;

    // Look up by email first
    if (email) {
      const { data } = await supabase
        .from('profiles')
        .select('id, email, full_name, loyalty_points')
        .eq('email', email.toLowerCase().trim())
        .maybeSingle();
      profile = data;
      lookupEmail = email;
    }

    // If not found and phone provided, try residents table
    if (!profile && phone) {
      const cleanPhone = phone.replace(/\D/g, '').slice(-10);
      const { data: resident } = await supabase
        .from('residents')
        .select('email, name')
        .or(`phone.ilike.%${cleanPhone}%,phone.ilike.%${cleanPhone.slice(-7)}%`)
        .maybeSingle();
      
      if (resident?.email) {
        lookupEmail = resident.email;
        const { data } = await supabase
          .from('profiles')
          .select('id, email, full_name, loyalty_points')
          .eq('email', resident.email.toLowerCase())
          .maybeSingle();
        profile = data;
      }
    }

    if (!profile) {
      return json(404, {
        success: false,
        found: false,
        message: `No loyalty account found. Sign up at brewhubphl.com/portal to start earning points!`
      });
    }

    const points = profile.loyalty_points || 0;
    const pointsToReward = Math.max(0, 100 - (points % 100));
    const portalUrl = 'https://brewhubphl.com/portal';
    const qrImageUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(profile.email)}`;

    // Send SMS if requested
    let smsSent = false;
    if (send_sms && phone && process.env.TWILIO_ACCOUNT_SID) {
      const twilioSid = process.env.TWILIO_ACCOUNT_SID;
      const twilioToken = process.env.TWILIO_AUTH_TOKEN;
      const messagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID;
      
      const formattedPhone = phone.startsWith('+') ? phone : `+1${phone.replace(/\D/g, '')}`;
      
      try {
        await fetch(`https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/Messages.json`, {
          method: 'POST',
          headers: {
            'Authorization': 'Basic ' + Buffer.from(`${twilioSid}:${twilioToken}`).toString('base64'),
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({
            To: formattedPhone,
            MessagingServiceSid: messagingServiceSid,
            Body: `☕ BrewHub Loyalty\nYou have ${points} points!\n${pointsToReward} more to your next free drink.\n\nYour QR: ${qrImageUrl}\n\nPortal: ${portalUrl}`
          }).toString()
        });
        smsSent = true;
      } catch (err) {
        console.error('SMS send error:', err);
      }
    }

    return json(200, {
      success: true,
      found: true,
      email: profile.email,
      name: profile.full_name || null,
      points,
      points_to_next_reward: pointsToReward,
      portal_url: portalUrl,
      qr_image_url: qrImageUrl,
      sms_sent: smsSent,
      message: `You have ${points} loyalty points! ${pointsToReward} more until your next free drink.${smsSent ? ' QR code texted!' : ''}`
    });

  } catch (err) {
    console.error('[GET-LOYALTY] Error:', err);
    return json(500, { success: false, error: 'Something went wrong' });
  }
};
