/**
 * WEBAUTHN AUTHENTICATION — Netlify Function
 * Path: netlify/functions/webauthn-login.js
 *
 * Two-phase WebAuthn authentication flow:
 *   POST { action: 'options' } → generate authentication options
 *   POST { action: 'verify', credential: {...} } → verify & return session
 *
 * No PIN session required — this IS the login method.
 * Returns the same session payload as pin-login.js for drop-in compatibility.
 */

const { createClient } = require('@supabase/supabase-js');
const {
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} = require('@simplewebauthn/server');
const crypto = require('crypto');
const { redactIP } = require('./_ip-hash');

const RP_ID = process.env.WEBAUTHN_RP_ID || 'brewhubphl.com';
const ORIGIN = process.env.SITE_URL || 'https://brewhubphl.com';

function supabase() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
}

const corsHeaders = () => {
  const allowed = process.env.SITE_URL || 'https://brewhubphl.com';
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Headers': 'Content-Type, X-BrewHub-Action',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Credentials': 'true',
  };
};

const respond = (code, data, extraHeaders = {}) => ({
  statusCode: code,
  headers: { 'Content-Type': 'application/json', ...corsHeaders(), ...extraHeaders },
  body: JSON.stringify(data),
});

/**
 * Derive device fingerprint — MUST match pin-login.js / _auth.js / middleware.ts:
 *   sha256(user-agent + '|' + accept-language + '|' + clientIP).slice(0, 16)
 */
function deriveDeviceFingerprint(event) {
  const ua = event.headers['user-agent'] || '';
  const accept = event.headers['accept-language'] || '';
  const xff = event.headers['x-forwarded-for'];
  const clientIp =
    event.headers['x-nf-client-connection-ip']
    || (xff ? xff.split(',')[0].trim() : null)
    || 'unknown';
  const raw = `${ua}|${accept}|${clientIp}`;
  return crypto.createHash('sha256').update(raw).digest('hex').slice(0, 16);
}

/**
 * IP allowlist — must match the same ALLOWED_IPS logic in pin-login.js.
 * Returns null if allowed, or a 403 response if blocked.
 */
function checkIPAllowlist(event) {
  const ip = event.headers['x-nf-client-connection-ip']
    || event.headers['x-forwarded-for']?.split(',')[0]?.trim()
    || 'unknown';

  const allowedRaw = process.env.ALLOWED_IPS || '';
  const allowedIPs = allowedRaw.split(',').map(s => s.trim()).filter(Boolean);
  const LOCAL_IPS = ['127.0.0.1', '::1', 'localhost', '::ffff:127.0.0.1'];
  const isLocal = LOCAL_IPS.includes(ip);
  const isWildcard = allowedRaw.trim() === '*';

  if (allowedIPs.length > 0 && !isLocal && !isWildcard && !allowedIPs.includes(ip)) {
    console.warn(`[WEBAUTHN-LOGIN] Blocked IP: ${redactIP(ip)}`);
    return respond(403, { error: 'Must be on BrewHub Wi-Fi', code: 'IP_BLOCKED' });
  }
  return null;
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return respond(200, {});
  if (event.httpMethod !== 'POST') return respond(405, { error: 'Method Not Allowed' });

  // ── IP Allowlist Gate (same as pin-login.js) ──────────────────────
  const ipBlock = checkIPAllowlist(event);
  if (ipBlock) return ipBlock;

  const sb = supabase();

  try {
    const body = JSON.parse(event.body || '{}');
    const { action } = body;

    if (action === 'options') {
      return await handleGenerateOptions(sb, event);
    } else if (action === 'verify') {
      return await handleVerifyAuth(sb, body, event);
    } else {
      return respond(400, { error: 'Invalid action. Use "options" or "verify".' });
    }
  } catch (err) {
    console.error('[WEBAUTHN-LOGIN] Error:', err.message);
    return respond(500, { error: 'Authentication failed' });
  }
};

// ── Phase 1: Generate Authentication Options ────────────────────────────────

async function handleGenerateOptions(sb, event) {
  // Get ALL registered credentials (for discoverable / non-discoverable flow)
  const { data: allCreds } = await sb
    .from('webauthn_credentials')
    .select('id, transports');

  const allowCredentials = (allCreds || []).map(c => ({
    id: c.id,
    type: 'public-key',
    transports: c.transports || [],
  }));

  const options = await generateAuthenticationOptions({
    rpID: RP_ID,
    userVerification: 'preferred',
    allowCredentials,
  });

  // Store the challenge
  await sb.from('webauthn_challenges').insert({
    challenge: options.challenge,
    type: 'authenticate',
    staff_id: null, // Unknown until verification
  });

  return respond(200, { options });
}

// ── Phase 2: Verify Authentication & Return Session ─────────────────────────

async function handleVerifyAuth(sb, body, event) {
  const { credential } = body;

  if (!credential || !credential.id) {
    return respond(400, { error: 'Missing credential' });
  }

  // Look up the credential
  const { data: credRow, error: credErr } = await sb
    .from('webauthn_credentials')
    .select('id, staff_id, public_key, counter, transports')
    .eq('id', credential.id)
    .single();

  if (credErr || !credRow) {
    return respond(401, { error: 'Passkey not recognized. Use your PIN instead.' });
  }

  // Retrieve the challenge
  const { data: challengeRow, error: challengeErr } = await sb
    .from('webauthn_challenges')
    .select('challenge')
    .eq('type', 'authenticate')
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (challengeErr || !challengeRow) {
    return respond(400, { error: 'Challenge expired. Please try again.' });
  }

  // Verify the response
  const verification = await verifyAuthenticationResponse({
    response: credential,
    expectedChallenge: challengeRow.challenge,
    expectedOrigin: ORIGIN,
    expectedRPID: RP_ID,
    credential: {
      id: credRow.id,
      publicKey: Buffer.from(credRow.public_key, 'base64url'),
      counter: credRow.counter,
      transports: credRow.transports || [],
    },
  });

  if (!verification.verified) {
    return respond(401, { error: 'Biometric verification failed' });
  }

  // Update the counter (replay protection)
  await sb.from('webauthn_credentials')
    .update({
      counter: verification.authenticationInfo.newCounter,
      last_used_at: new Date().toISOString(),
    })
    .eq('id', credRow.id);

  // Clean up used challenges
  await sb.from('webauthn_challenges')
    .delete()
    .eq('type', 'authenticate')
    .lte('created_at', new Date().toISOString());

  // Look up the staff member
  const { data: staffRow, error: staffErr } = await sb
    .from('staff_directory')
    .select('id, name, full_name, email, role, is_working, is_active')
    .eq('id', credRow.staff_id)
    .single();

  if (staffErr || !staffRow) {
    return respond(403, { error: 'Staff record not found' });
  }

  // Block deactivated / terminated staff
  if (staffRow.is_active === false) {
    console.warn(`[WEBAUTHN-LOGIN] Blocked login for deactivated staff ${staffRow.email}`);
    return respond(403, { error: 'Your account has been deactivated. Contact your manager.' });
  }

  // ═══════════════════════════════════════════════════════════
  // Generate session token — identical format to pin-login.js
  // so OpsGate can use it interchangeably
  // ═══════════════════════════════════════════════════════════
  const sessionId = crypto.randomBytes(24).toString('hex');
  const deviceFp = deriveDeviceFingerprint(event);
  const expiresAt = Date.now() + (8 * 60 * 60 * 1000); // 8-hour shift
  const payload = JSON.stringify({
    sid: sessionId,
    staffId: staffRow.id,
    email: staffRow.email,
    role: staffRow.role,
    dfp: deviceFp,
    iat: Date.now(),
    exp: expiresAt,
    needsPinRotation: false,
    authMethod: 'passkey',
  });

  const secret = process.env.INTERNAL_SYNC_SECRET;
  if (!secret) {
    console.error('[WEBAUTHN-LOGIN] INTERNAL_SYNC_SECRET not configured');
    return respond(500, { error: 'Server misconfiguration' });
  }

  const signature = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  const token = Buffer.from(payload).toString('base64') + '.' + signature;

  console.log(`[WEBAUTHN-LOGIN] ${staffRow.full_name || staffRow.name} logged in via passkey`);

  // Set HttpOnly session cookie (same as pin-login.js)
  const isProduction = !['localhost', '127.0.0.1'].includes(
    (event.headers?.host || '').split(':')[0]
  );
  const cookieFlags = [
    `hub_staff_session=${token}`,
    'HttpOnly',
    'SameSite=Strict',
    'Path=/',
    `Max-Age=${8 * 60 * 60}`,
    isProduction ? 'Secure' : '',
  ].filter(Boolean).join('; ');

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders(),
      'Set-Cookie': cookieFlags,
    },
    body: JSON.stringify({
      success: true,
      token,
      needsPinRotation: false,
      authMethod: 'passkey',
      staff: {
        id: staffRow.id,
        name: staffRow.full_name || staffRow.name,
        email: staffRow.email,
        role: staffRow.role,
        is_working: false, // Same as pin-login: login ≠ clock-in
      },
    }),
  };
}
