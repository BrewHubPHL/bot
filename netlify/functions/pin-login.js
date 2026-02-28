const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');
const { authenticator } = require('otplib');
const { signToken } = require('./_auth.js');
const { requireCsrfHeader } = require('./_csrf');
const { sanitizeInput } = require('./_sanitize');
const { staffBucket } = require('./_token-bucket');
const { redactIP } = require('./_ip-hash');

// Device fingerprint derivation — must match _auth.js and middleware.ts:
//   sha256(user-agent + '|' + accept-language + '|' + clientIP).slice(0, 16)
function deriveDeviceFingerprint(event) {
  const ua = event.headers?.['user-agent'] || '';
  const accept = event.headers?.['accept-language'] || '';
  const xff = event.headers?.['x-forwarded-for'];
  const clientIp =
    event.headers?.['x-nf-client-connection-ip']
    || (xff ? xff.split(',')[0].trim() : null)
    || 'unknown';
  const raw = `${ua}|${accept}|${clientIp}`;
  return crypto.createHash('sha256').update(raw).digest('hex').slice(0, 16);
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

  // ── CSRF protection ──────────────────────────────────────────
  const csrfBlock = requireCsrfHeader(event);
  if (csrfBlock) return csrfBlock;

  // ── Client IP ────────────────────────────────────────────────
  const clientIp =
    event.headers['x-nf-client-connection-ip'] ||
    event.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
    event.headers['client-ip'] ||
    '127.0.0.1';

  // ── Rate limiting — prevent PIN brute-force ──────────────────
  const rl = staffBucket.consume('pin-login:' + clientIp);
  if (!rl.allowed) {
    console.warn(`[PIN-LOGIN] Rate limit hit from IP: ${redactIP(clientIp)}`);
    return { statusCode: 429, body: JSON.stringify({ error: 'Too many login attempts. Please wait.' }) };
  }

  try {
    const body = JSON.parse(event.body || '{}');

    // ── Input sanitization ──────────────────────────────────────
    const pin = sanitizeInput(String(body.pin || ''));
    const totpCode = body.totpCode ? sanitizeInput(String(body.totpCode)) : null;

    if (!pin || !/^\d{6}$/.test(pin)) {
      return { statusCode: 400, body: JSON.stringify({ error: 'PIN must be exactly 6 digits.' }) };
    }

    // ── Device fingerprint (bound to issued token) ──────────────
    const dfp = deriveDeviceFingerprint(event);

    // 🔑 1. THE ADMIN BYPASS (The Master Key)
    // Checks the Netlify env var directly — bypasses IP and TOTP checks.
    // ADMIN_EMAIL must match the admin's entry in staff_directory so that
    // _auth.js can re-validate the token on subsequent requests.
    if (pin === process.env.ADMIN_PIN) {
      console.log('[PIN-LOGIN] Admin login detected. Bypassing network security.');
      const adminEmail = process.env.ADMIN_EMAIL || '';
      const token = signToken({ role: 'admin', email: adminEmail, status: 'active', dfp });

      // Set HttpOnly session cookie so middleware recognizes the session
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
        headers: { 'Content-Type': 'application/json', 'Set-Cookie': cookieFlags },
        body: JSON.stringify({
          token,
          role: 'admin',
          staff: { id: null, name: 'Admin', email: adminEmail, role: 'admin', is_working: false },
        }),
      };
    }

    // ---------------------------------------------------------
    // Regular staff / manager flow
    // ---------------------------------------------------------

    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

    // 🕵️ 2. Verify PIN via bcrypt RPC (schema 47/66)
    // Uses verify_staff_pin() which does bcrypt comparison on pin_hash,
    // rejects inactive staff, and returns rotation status.
    const { data: rpcRows, error: rpcError } = await supabase.rpc('verify_staff_pin', { p_pin: pin });

    if (rpcError) {
      console.error('[PIN-LOGIN] verify_staff_pin RPC error:', rpcError.message);
      return { statusCode: 500, body: JSON.stringify({ error: 'Server error. Please try again.' }) };
    }

    const staff = rpcRows?.[0] || null;
    if (!staff) {
      return { statusCode: 401, body: JSON.stringify({ error: 'Invalid PIN.' }) };
    }

    // Map RPC column names to the shape the rest of the function expects
    const staffId = staff.staff_id;
    const staffName = staff.staff_name || staff.full_name || 'Staff';
    const staffEmail = staff.staff_email;
    const staffRole = staff.staff_role;
    const isWorking = staff.is_working ?? false;
    const needsPinRotation = staff.needs_pin_rotation ?? false;

    // 🌐 3. Network Check for Staff
    const { data: settings, error: settingsError } = await supabase
      .from('store_settings')
      .select('shop_ip_address')
      .single();

    if (settingsError) {
      console.error('[PIN-LOGIN] store_settings lookup failed:', settingsError.message);
      return { statusCode: 500, body: JSON.stringify({ error: 'Server error. Please try again.' }) };
    }

    const isNetworkValid = (clientIp === settings?.shop_ip_address || clientIp === '127.0.0.1');

    if (!isNetworkValid) {
      // Baristas are strictly gated to the shop network
      if (staffRole === 'barista') {
        return { statusCode: 403, body: JSON.stringify({ error: 'OFFSITE', message: 'Please connect to BrewHub Wi-Fi.' }) };
      }

      // Managers can bypass with a TOTP code
      if (staffRole === 'manager') {
        if (!totpCode) {
          return { statusCode: 403, body: JSON.stringify({ error: 'TOTP_REQUIRED' }) };
        }
        const isValid = authenticator.verify({ token: totpCode, secret: process.env.MANAGER_TOTP_SECRET });
        if (!isValid) {
          return { statusCode: 401, body: JSON.stringify({ error: 'INVALID_TOTP' }) };
        }
      }
    }

    // ✅ 4. Issue Staff Token (with device fingerprint for session binding)
    const token = signToken({
      role: staffRole,
      staffId,
      name: staffName,
      email: staffEmail,
      status: 'active',
      dfp,
    });

    // Set HttpOnly session cookie so middleware recognizes the session
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
      headers: { 'Content-Type': 'application/json', 'Set-Cookie': cookieFlags },
      body: JSON.stringify({
        token,
        role: staffRole,
        needsPinRotation,
        staff: {
          id: staffId,
          name: staffName,
          email: staffEmail,
          role: staffRole,
          is_working: isWorking,
        },
      }),
    };

  } catch (error) {
    console.error('[PIN-LOGIN] Fatal error:', error?.message);
    return { statusCode: 500, body: JSON.stringify({ error: 'Server Error' }) };
  }
};
