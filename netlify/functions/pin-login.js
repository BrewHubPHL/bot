const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');
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

/**
 * RFC 6238 TOTP verification using Node.js built-in crypto.
 * Replaces otplib (whose v13 API broke the authenticator export).
 * Accepts a ±1 time-step window to tolerate clock drift.
 */
function verifyTOTP(token, secret, window = 1) {
  if (!token || !secret) return false;
  // Decode base32 secret
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const c of secret.toUpperCase().replace(/[\s=]+/g, '')) {
    const val = alphabet.indexOf(c);
    if (val === -1) return false;
    bits += val.toString(2).padStart(5, '0');
  }
  const keyBytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    keyBytes.push(parseInt(bits.substring(i, i + 8), 2));
  }
  const key = Buffer.from(keyBytes);

  const counter = Math.floor(Date.now() / 30000);
  for (let i = -window; i <= window; i++) {
    const time = counter + i;
    const buf = Buffer.alloc(8);
    buf.writeUInt32BE(Math.floor(time / 0x100000000), 0);
    buf.writeUInt32BE(time >>> 0, 4);
    const hmac = crypto.createHmac('sha1', key).update(buf).digest();
    const offset = hmac[hmac.length - 1] & 0x0f;
    const code = ((hmac[offset] & 0x7f) << 24 | hmac[offset + 1] << 16 | hmac[offset + 2] << 8 | hmac[offset + 3]) % 1000000;
    if (String(code).padStart(6, '0') === token) return true;
  }
  return false;
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
      const adminEmail = (process.env.ADMIN_EMAIL || '').toLowerCase();

      // Resolve admin's staff_directory row so the token carries a real staffId.
      // Without this, clock-in/out and any RPC keyed on staff_directory.id fails.
      const adminSupabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
      const { data: adminRow, error: adminLookupErr } = await adminSupabase
        .from('staff_directory')
        .select('id, name, full_name, is_working')
        .eq('email', adminEmail)
        .single();

      if (adminLookupErr || !adminRow) {
        console.error('[PIN-LOGIN] Admin email not found in staff_directory:', adminLookupErr?.message);
        // Graceful degradation: proceed with null staffId (clock won't work but login will)
      }

      const adminStaffId = adminRow?.id || null;
      const adminName = adminRow?.full_name || adminRow?.name || 'Admin';
      const adminIsWorking = adminRow?.is_working ?? false;

      const token = signToken({ role: 'admin', email: adminEmail, staffId: adminStaffId, status: 'active', dfp });

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
          staff: { id: adminStaffId, name: adminName, email: adminEmail, role: 'admin', is_working: adminIsWorking },
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
        const isValid = verifyTOTP(totpCode, process.env.MANAGER_TOTP_SECRET);
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
