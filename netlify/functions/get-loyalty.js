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
const { checkQuota } = require('./_usage');
const { publicBucket } = require('./_token-bucket');
const { sendSMS } = require('./_sms');
const { sanitizeInput } = require('./_sanitize');

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

  // Per-IP burst rate limit
  const clientIp = event.headers['x-nf-client-connection-ip']
    || event.headers['x-forwarded-for']?.split(',')[0]?.trim()
    || 'unknown';
  const ipLimit = publicBucket.consume('loyalty:' + clientIp);
  if (!ipLimit.allowed) {
    return json(429, { success: false, error: 'Too many requests. Please slow down.' });
  }

  // Daily quota limit to prevent Denial-of-Wallet
  const hasQuota = await checkQuota('loyalty_lookup');
  if (!hasQuota) {
    return json(429, { success: false, error: 'Rate limit reached. Try again later.' });
  }

  try {
    // Parse params from query string or body and sanitize
    let email, phone, send_sms;
    if (event.httpMethod === 'GET') {
      const params = event.queryStringParameters || {};
      email = sanitizeInput(params.email);
      phone = sanitizeInput(params.phone);
      send_sms = params.send_sms === 'true' || params.send_sms === '1';
    } else {
      const body = JSON.parse(event.body || '{}');
      email = sanitizeInput(body.email);
      phone = sanitizeInput(body.phone);
      send_sms = body.send_sms === true || body.send_sms === 'true' || body.send_sms === '1';
    }

    // GL-3: Input length caps
    if (email && String(email).length > 254) {
      return json(400, { success: false, error: 'Invalid email' });
    }
    if (phone && String(phone).length > 20) {
      return json(400, { success: false, error: 'Invalid phone number' });
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
      const normalized = String(email).toLowerCase().trim();
      const { data } = await supabase
        .from('profiles')
        .select('id, email, loyalty_points')
        .eq('email', normalized)
        .maybeSingle();
      profile = data;
      lookupEmail = normalized;
    }

    // If not found and phone provided, try residents table
    // GL-2: Use separate .ilike() filters instead of string interpolation in .or()
    if (!profile && phone) {
      const cleanPhone = phone.replace(/\D/g, '').slice(-10);
      if (cleanPhone.length >= 7) {
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
    // GL-1 / API-H6: Use opaque customer ID instead of email in QR URL
    const qrDataUrl = `${portalUrl}?cid=${encodeURIComponent(profile.id)}`;
    const qrImageUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(qrDataUrl)}`;

    // Send SMS if requested — via TCPA-compliant gateway
    let smsSent = false;
    let smsBlocked = false;
    let smsBlockReason = null;
    if (send_sms && phone && process.env.TWILIO_ACCOUNT_SID) {
      const smsBody = `☕ BrewHub Loyalty\nYou have ${points} points!\n${pointsToReward} more to your next free drink.\n\nYour QR: ${qrImageUrl}\n\nPortal: ${portalUrl}`;

      const smsResult = await sendSMS({
        to: phone,
        body: smsBody,
        messageType: 'loyalty_qr',
        sourceFunction: 'get-loyalty',
      });

      if (smsResult.sent) {
        smsSent = true;
      } else if (smsResult.blocked) {
        smsBlocked = true;
        smsBlockReason = smsResult.reason;
      }
    }

    // API-H6: Mask PII — return customer_id (UUID) instead of raw email/name
    const maskedEmail = profile.email
      ? profile.email.replace(/^(.).+(@.+)$/, '$1***$2')
      : null;

    return json(200, {
      success: true,
      found: true,
      customer_id: profile.id,
      email_masked: maskedEmail,
      points,
      points_to_next_reward: pointsToReward,
      portal_url: portalUrl,
      qr_image_url: qrImageUrl,
      sms_sent: smsSent,
      sms_blocked: smsBlocked || undefined,
      sms_block_reason: smsBlockReason || undefined,
      message: `You have ${points} loyalty points! ${pointsToReward} more until your next free drink.${smsSent ? ' QR code texted!' : ''}${smsBlocked ? (smsBlockReason === 'opted_out' ? ' SMS not sent — recipient has opted out.' : ' SMS deferred — quiet hours.') : ''}`
    });

  } catch (err) {
    // GL-5: Log only message to avoid leaking Supabase schema details
    console.error('[GET-LOYALTY] Error:', err?.message || 'Unknown error');
    return json(500, { success: false, error: 'Something went wrong' });
  }
};
