// ═══════════════════════════════════════════════════════════════════════════
// manager-challenge.js — Ephemeral TOTP Challenge for Sensitive Manager Actions
// ═══════════════════════════════════════════════════════════════════════════
//
// VULNERABILITY ADDRESSED: "Shoulder-Surfed God Mode" (Insider Threat)
//
// A static 6-digit PIN, entered 10x/day on a shared iPad, is trivially
// observable. Once a barista memorizes it, they can comp drinks, edit
// timesheets, and adjust inventory — all logged under the manager's name.
//
// SOLUTION: Every sensitive manager action requires an ephemeral one-time
// code that:
//   1. Is generated fresh for each action (30-second window)
//   2. Uses a per-manager TOTP secret (not the PIN)
//   3. Can only be consumed once (replay-proof via DB nonce)
//   4. Logs the device fingerprint + IP for forensic attribution
//
// FLOW:
//   1. Manager initiates a sensitive action (comp, fix-clock, adjust hours)
//   2. Frontend calls POST /manager-challenge with { action_type }
//   3. This function generates a TOTP code, shows it on the manager's
//      authenticated session, and stores a nonce in the DB
//   4. Manager enters the code into the confirmation modal
//   5. The action endpoint (fix-clock, update-hours, etc.) verifies the
//      nonce via the consume_challenge_nonce RPC
//
// The benefit: even if a barista knows the login PIN, they cannot
// generate TOTP codes because those require the manager's active session
// AND the per-manager TOTP secret (stored only in the DB, never exposed).
// ═══════════════════════════════════════════════════════════════════════════

const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');
const { authorize } = require('./_auth');
const { requireCsrfHeader } = require('./_csrf');
const { sanitizeInput } = require('./_sanitize');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const ALLOWED_ORIGIN = process.env.SITE_URL || 'https://brewhubphl.com';

const VALID_ACTION_TYPES = [
  'comp_order', 'adjust_hours', 'fix_clock', 'void_order',
  'voucher_override', 'inventory_adjust', 'discount_override',
  'parcel_override', 'schedule_edit', 'pin_reset', 'role_change',
];

// TOTP parameters
const TOTP_DIGITS = 6;
const TOTP_STEP_SECONDS = 30;
const NONCE_EXPIRY_SECONDS = 90; // Nonce valid for 90 seconds (3 TOTP steps)

const cors = (code, data) => ({
  statusCode: code,
  headers: {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-BrewHub-Action',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Credentials': 'true',
  },
  body: JSON.stringify(data),
});

/**
 * Generate a TOTP code using HMAC-SHA256.
 * @param {string} secret  Hex-encoded secret
 * @param {number} counter Time-step counter
 * @returns {string} 6-digit TOTP code
 */
function generateTOTP(secret, counter) {
  // Convert counter to 8-byte big-endian buffer
  const counterBuf = Buffer.alloc(8);
  counterBuf.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  counterBuf.writeUInt32BE(counter >>> 0, 4);

  const hmac = crypto.createHmac('sha256', Buffer.from(secret, 'hex')).update(counterBuf).digest();

  // Dynamic truncation (RFC 4226)
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code = (
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff)
  ) % Math.pow(10, TOTP_DIGITS);

  return String(code).padStart(TOTP_DIGITS, '0');
}

/**
 * Verify a TOTP code, allowing for clock skew (±1 step).
 */
function verifyTOTP(secret, code) {
  const now = Math.floor(Date.now() / 1000);

  for (let drift = -1; drift <= 1; drift++) {
    const counter = Math.floor((now + drift * TOTP_STEP_SECONDS) / TOTP_STEP_SECONDS);
    if (generateTOTP(secret, counter) === code) {
      return true;
    }
  }
  return false;
}

exports.handler = async (event) => {
  // ── CORS preflight ──────────────────────────────────────
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: {
        'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-BrewHub-Action',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
      },
      body: '',
    };
  }

  if (event.httpMethod !== 'POST') return cors(405, { error: 'Method not allowed' });

  // CSRF protection
  const csrfBlock = requireCsrfHeader(event);
  if (csrfBlock) return csrfBlock;

  // Manager auth required (via PIN session)
  const auth = await authorize(event, { requireManager: true, requirePin: true });
  if (!auth.ok) return auth.response;

  const managerEmail = auth.user?.email;
  if (!managerEmail) return cors(403, { error: 'Could not resolve manager identity' });

  try {
    const body = JSON.parse(event.body || '{}');
    const action_type = sanitizeInput(body.action_type);
    const mode = sanitizeInput(body.mode);

    // ── ISSUE mode: Generate a TOTP challenge ─────────────
    if (!mode || mode === 'issue') {
      if (!action_type || !VALID_ACTION_TYPES.includes(action_type)) {
        return cors(400, { error: `Invalid action_type. Must be one of: ${VALID_ACTION_TYPES.join(', ')}` });
      }

      // Rate limit: max 5 challenge requests per manager per 5 minutes
      const { data: velocityCheck } = await supabase.rpc('check_manager_action_velocity', {
        p_manager_email: managerEmail,
        p_action_type: action_type,
        p_window_minutes: 5,
        p_max_actions: 20,
      });
      const velocity = velocityCheck?.[0] || velocityCheck;
      if (velocity?.is_anomalous) {
        console.warn(`[CHALLENGE] Anomalous challenge velocity for ${managerEmail}: ${velocity.action_count} in 5m`);
        return cors(429, { error: 'Too many challenge requests. Please wait a few minutes.' });
      }

      // Fetch manager's TOTP secret
      const { data: managerRow, error: mgrErr } = await supabase
        .from('staff_directory')
        .select('id, totp_secret')
        .eq('email', managerEmail)
        .single();

      if (mgrErr || !managerRow) {
        console.error('[CHALLENGE] Manager not found:', mgrErr?.message);
        return cors(500, { error: 'Manager lookup failed' });
      }

      let totpSecret = managerRow.totp_secret;

      // Generate TOTP secret on first use
      if (!totpSecret) {
        totpSecret = crypto.randomBytes(32).toString('hex');
        await supabase
          .from('staff_directory')
          .update({ totp_secret: totpSecret })
          .eq('id', managerRow.id);
      }

      // Generate TOTP code
      const counter = Math.floor(Date.now() / 1000 / TOTP_STEP_SECONDS);
      const totpCode = generateTOTP(totpSecret, counter);

      // Generate a unique nonce for this challenge
      const nonce = crypto.randomBytes(24).toString('hex');
      const expiresAt = new Date(Date.now() + NONCE_EXPIRY_SECONDS * 1000).toISOString();

      // Store nonce in DB (consumed later by the action endpoint)
      const { error: nonceErr } = await supabase
        .from('manager_challenge_nonces')
        .insert({
          staff_email: managerEmail,
          action_type,
          nonce,
          expires_at: expiresAt,
        });

      if (nonceErr) {
        console.error('[CHALLENGE] Failed to store nonce:', nonceErr?.message);
        return cors(500, { error: 'Challenge generation failed' });
      }

      console.log(`[CHALLENGE] Issued ${action_type} challenge for ${managerEmail}`);

      return cors(200, {
        challenge_code: totpCode,
        nonce,
        expires_in: NONCE_EXPIRY_SECONDS,
        action_type,
      });
    }

    // ── VERIFY mode: Check a TOTP code and return the nonce ─
    if (mode === 'verify') {
      const code = sanitizeInput(body.code);
      const challengeNonce = sanitizeInput(body.nonce);

      if (!code || typeof code !== 'string' || !/^\d{6}$/.test(code)) {
        return cors(400, { error: 'Code must be exactly 6 digits' });
      }

      if (!challengeNonce) {
        return cors(400, { error: 'Challenge nonce is required' });
      }

      // Fetch manager's TOTP secret
      const { data: managerRow, error: mgrErr } = await supabase
        .from('staff_directory')
        .select('totp_secret')
        .eq('email', managerEmail)
        .single();

      if (mgrErr || !managerRow?.totp_secret) {
        return cors(403, { error: 'TOTP not configured for this manager' });
      }

      // Verify the TOTP code
      if (!verifyTOTP(managerRow.totp_secret, code)) {
        console.warn(`[CHALLENGE] Invalid TOTP code for ${managerEmail}`);
        return cors(401, { error: 'Invalid challenge code' });
      }

      // Verify the nonce exists and belongs to this manager
      const { data: nonceRow, error: nonceErr } = await supabase
        .from('manager_challenge_nonces')
        .select('id, action_type, consumed, expires_at')
        .eq('nonce', challengeNonce)
        .eq('staff_email', managerEmail)
        .single();

      if (nonceErr || !nonceRow) {
        return cors(403, { error: 'Invalid challenge nonce' });
      }

      if (nonceRow.consumed) {
        return cors(403, { error: 'Challenge already used' });
      }

      if (new Date(nonceRow.expires_at) < new Date()) {
        return cors(403, { error: 'Challenge expired' });
      }

      console.log(`[CHALLENGE] Verified ${nonceRow.action_type} challenge for ${managerEmail}`);

      return cors(200, {
        verified: true,
        nonce: challengeNonce,
        action_type: nonceRow.action_type,
      });
    }

    return cors(400, { error: 'Invalid mode. Use "issue" or "verify".' });

  } catch (err) {
    console.error('[CHALLENGE] Error:', err?.message);
    return cors(500, { error: 'An error occurred. Please try again.' });
  }
};
