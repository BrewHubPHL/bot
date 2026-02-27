/**
 * verify-invite.js — Server-side verification of HMAC-signed guest invite links.
 *
 * Called from the /resident registration page when URL params include `sig`.
 * Verifies the HMAC signature and expiry timestamp to ensure the invite was
 * genuinely issued by parcel-check-in and hasn't been tampered with.
 *
 * Auth: Public (no login required — this IS the onboarding entry point)
 * Method: POST
 * Body: { unit, phone, expires, sig }
 * Returns: { valid: true, unit, phone } or { valid: false, reason }
 */
const crypto = require('crypto');
const { publicBucket } = require('./_token-bucket');
const { hashIP } = require('./_ip-hash');

const ALLOWED_ORIGINS = [
  process.env.URL,
  process.env.SITE_URL,
  'https://brewhubphl.com',
  'https://www.brewhubphl.com',
].filter(Boolean);

function getCorsOrigin(event) {
  const origin = event.headers?.origin || '';
  return ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
}

/**
 * Normalize a phone string to digits-only so formatting differences
 * ('+1 (555) 123-4567' vs '15551234567') produce identical HMAC signatures.
 * Must match the normalizePhone() in parcel-check-in.js.
 */
function normalizePhone(phone) {
  return String(phone || '').replace(/\D/g, '');
}

/**
 * Recompute the HMAC-SHA256 signature for invite params.
 * Must match the algorithm in parcel-check-in.js → signInviteParams().
 * Phone is normalized to digits-only before signing.
 */
function computeSignature(unit, phone, expires) {
  const secret = process.env.INVITE_LINK_SECRET || process.env.INTERNAL_SYNC_SECRET;
  if (!secret) throw new Error('INVITE_LINK_SECRET or INTERNAL_SYNC_SECRET env var required');
  const payload = `invite:${unit || ''}:${normalizePhone(phone)}:${expires}`;
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

exports.handler = async (event) => {
  const corsOrigin = getCorsOrigin(event);
  const corsHeaders = {
    'Access-Control-Allow-Origin': corsOrigin,
    'Access-Control-Allow-Headers': 'Content-Type, X-BrewHub-Action',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };

  // CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: corsHeaders, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  // Rate limit (public endpoint — aggressive bucket)
  const clientIp = hashIP(event);
  if (!publicBucket.consume('invite:' + clientIp)) {
    return { statusCode: 429, headers: corsHeaders, body: JSON.stringify({ valid: false, reason: 'Too many requests' }) };
  }

  try {
    let body;
    try {
      body = JSON.parse(event.body || '{}');
    } catch {
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ valid: false, reason: 'Invalid request' }) };
    }

    const unit = String(body.unit || '').slice(0, 20);
    const phone = String(body.phone || '').slice(0, 20);
    const expires = String(body.expires || '');
    const sig = String(body.sig || '').slice(0, 128);

    // ── Validate required fields ──
    if (!expires || !sig) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ valid: false, reason: 'Missing signature parameters' }),
      };
    }

    // ── Check expiry ──
    const expiresMs = Number(expires);
    if (Number.isNaN(expiresMs) || Date.now() > expiresMs) {
      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({ valid: false, reason: 'Invite link has expired. Please ask the front desk to resend your package notification.' }),
      };
    }

    // ── Verify HMAC signature (timing-safe comparison) ──
    const expected = computeSignature(unit, phone, expires);

    const sigBuf = Buffer.from(sig, 'hex');
    const expBuf = Buffer.from(expected, 'hex');

    if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
      console.warn(`[VERIFY-INVITE] Invalid signature for unit=${unit} phone=***${phone.slice(-4)}`);
      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({ valid: false, reason: 'Invalid or tampered invite link. Please request a new package notification.' }),
      };
    }

    // ── Signature valid ──
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({ valid: true, unit, phone }),
    };
  } catch (err) {
    console.error('[VERIFY-INVITE] Error:', err?.message);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ valid: false, reason: 'Verification failed' }),
    };
  }
};
