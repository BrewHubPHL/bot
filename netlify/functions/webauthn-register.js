/**
 * WEBAUTHN REGISTRATION — Netlify Function
 * Path: netlify/functions/webauthn-register.js
 *
 * Two-phase WebAuthn registration flow:
 *   POST { action: 'options' } → generate registration options
 *   POST { action: 'verify', credential: {...} } → verify & store credential
 *
 * Requires a valid PIN session token (staff must be logged in to register a passkey).
 */

const { createClient } = require('@supabase/supabase-js');
const {
  generateRegistrationOptions,
  verifyRegistrationResponse,
} = require('@simplewebauthn/server');
const crypto = require('crypto');
const { authorize, json } = require('./_auth');
const { requireCsrfHeader } = require('./_csrf');
const { redactIP } = require('./_ip-hash');

const RP_NAME = 'BrewHub PHL';
const RP_ID = process.env.WEBAUTHN_RP_ID || 'brewhubphl.com';
const ORIGIN = process.env.SITE_URL || 'https://brewhubphl.com';

function supabase() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
}

const corsHeaders = (event) => {
  const allowed = process.env.SITE_URL || 'https://brewhubphl.com';
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-BrewHub-Action',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Credentials': 'true',
  };
};

const respond = (code, data, event) => ({
  statusCode: code,
  headers: { 'Content-Type': 'application/json', ...corsHeaders(event) },
  body: JSON.stringify(data),
});

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
    console.warn(`[WEBAUTHN-REGISTER] Blocked IP: ${redactIP(ip)}`);
    return respond(403, { error: 'Must be on BrewHub Wi-Fi', code: 'IP_BLOCKED' }, event);
  }
  return null;
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return respond(200, {}, event);
  if (event.httpMethod !== 'POST') return respond(405, { error: 'Method Not Allowed' }, event);

  // ── IP Allowlist Gate (same as pin-login.js) ──────────────────────
  const ipBlock = checkIPAllowlist(event);
  if (ipBlock) return ipBlock;

  // CSRF protection
  const csrfBlock = requireCsrfHeader(event);
  if (csrfBlock) return { ...csrfBlock, headers: { ...csrfBlock.headers, ...corsHeaders(event) } };

  // Require PIN session
  const auth = await authorize(event, { requirePin: true });
  if (!auth.ok) return { ...auth.response, headers: { ...auth.response.headers, ...corsHeaders(event) } };

  const sb = supabase();

  try {
    const body = JSON.parse(event.body || '{}');
    const { action } = body;

    if (action === 'options') {
      return await handleGenerateOptions(sb, auth, event);
    } else if (action === 'verify') {
      return await handleVerifyRegistration(sb, auth, body, event);
    } else {
      return respond(400, { error: 'Invalid action. Use "options" or "verify".' }, event);
    }
  } catch (err) {
    console.error('[WEBAUTHN-REGISTER] Error:', err.message);
    return respond(500, { error: 'Registration failed' }, event);
  }
};

// ── Phase 1: Generate Registration Options ──────────────────────────────────

async function handleGenerateOptions(sb, auth, event) {
  const staffId = auth.user.staffId || auth.user.id;
  const staffEmail = auth.user.email;

  // Get existing credentials for this staff member (to exclude them)
  const { data: existing } = await sb
    .from('webauthn_credentials')
    .select('id')
    .eq('staff_id', staffId);

  const excludeCredentials = (existing || []).map(c => ({
    id: c.id,
    type: 'public-key',
  }));

  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: RP_ID,
    userName: staffEmail,
    userDisplayName: auth.user.name || staffEmail,
    userID: staffId,
    attestationType: 'none', // We don't need attestation for this use case
    excludeCredentials,
    authenticatorSelection: {
      residentKey: 'preferred',
      userVerification: 'preferred',
      authenticatorAttachment: 'platform', // Only built-in biometrics (Face ID, Touch ID, Windows Hello)
    },
  });

  // Store the challenge for verification
  await sb.from('webauthn_challenges').insert({
    challenge: options.challenge,
    staff_id: staffId,
    type: 'register',
  });

  console.log(`[WEBAUTHN-REGISTER] Generated options for ${staffEmail}`);
  return respond(200, { options }, event);
}

// ── Phase 2: Verify Registration & Store Credential ─────────────────────────

async function handleVerifyRegistration(sb, auth, body, event) {
  const staffId = auth.user.staffId || auth.user.id;
  const { credential, deviceName } = body;

  if (!credential) {
    return respond(400, { error: 'Missing credential' }, event);
  }

  // Retrieve the challenge
  const { data: challengeRow, error: challengeErr } = await sb
    .from('webauthn_challenges')
    .select('challenge')
    .eq('staff_id', staffId)
    .eq('type', 'register')
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (challengeErr || !challengeRow) {
    return respond(400, { error: 'Challenge expired or not found. Please try again.' }, event);
  }

  const verification = await verifyRegistrationResponse({
    response: credential,
    expectedChallenge: challengeRow.challenge,
    expectedOrigin: ORIGIN,
    expectedRPID: RP_ID,
  });

  if (!verification.verified || !verification.registrationInfo) {
    return respond(400, { error: 'Verification failed' }, event);
  }

  const { credential: regCred, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;

  // Store the credential
  const { error: insertErr } = await sb.from('webauthn_credentials').insert({
    id: regCred.id,
    staff_id: staffId,
    public_key: Buffer.from(regCred.publicKey).toString('base64url'),
    counter: regCred.counter,
    transports: credential.response?.transports || [],
    device_name: deviceName || `${credentialDeviceType}${credentialBackedUp ? ' (synced)' : ''}`,
  });

  if (insertErr) {
    console.error('[WEBAUTHN-REGISTER] Insert error:', insertErr.message);
    return respond(500, { error: 'Failed to store credential' }, event);
  }

  // Clean up used challenge
  await sb.from('webauthn_challenges')
    .delete()
    .eq('staff_id', staffId)
    .eq('type', 'register');

  console.log(`[WEBAUTHN-REGISTER] Credential stored for ${auth.user.email} (${deviceName || 'unnamed'})`);
  return respond(200, { success: true, deviceType: credentialDeviceType }, event);
}
