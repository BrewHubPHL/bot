const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');
const { redactIP } = require('./_ip-hash');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// In-memory rate limiting (fast first-line defense; DB lockout below is authoritative)
const attempts = new Map();
const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 60_000; // 1 minute lockout after 5 failures
const LOCKOUT_SECONDS = 60;

function checkRateLimit(ip) {
  const now = Date.now();
  const record = attempts.get(ip);

  if (!record) return { allowed: true };

  // Clear expired entries
  if (now - record.windowStart > LOCKOUT_MS) {
    attempts.delete(ip);
    return { allowed: true };
  }

  if (record.count >= MAX_ATTEMPTS) {
    const retryAfter = Math.ceil((record.windowStart + LOCKOUT_MS - now) / 1000);
    return { allowed: false, retryAfter };
  }

  return { allowed: true };
}

function recordAttempt(ip, success) {
  if (success) {
    attempts.delete(ip);
    return;
  }
  const now = Date.now();
  const record = attempts.get(ip) || { count: 0, windowStart: now };
  record.count += 1;
  attempts.set(ip, record);
}

/**
 * Constant-time PIN comparison to prevent timing attacks
 * LEGACY: Kept as fallback during bcrypt migration. Once all PINs are hashed,
 * this function is only used if verify_staff_pin RPC is unavailable.
 */
function safeCompare(a, b) {
  if (!a || !b) return false;
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Derive a device fingerprint from request headers.
 * This binds the session to the originating device AND network,
 * making stolen tokens harder to reuse from a different machine or IP.
 *
 * Must stay in sync with deriveDeviceFingerprint() in src/middleware.ts:
 *   sha256(user-agent + '|' + accept-language + '|' + clientIP).slice(0, 16)
 *
 * When x-forwarded-for contains multiple IPs (proxy chains) we use only
 * the first (left-most) entry to keep the hash deterministic.
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

const json = (statusCode, data) => ({
  statusCode,
  headers: {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': process.env.SITE_URL || 'https://brewhubphl.com',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  },
  body: JSON.stringify(data),
});

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return json(200, {});
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method Not Allowed' });

  // Resolve client IP
  const ip = event.headers['x-nf-client-connection-ip']
    || event.headers['x-forwarded-for']?.split(',')[0]?.trim()
    || 'unknown';

  // IP allowlist — only permit PIN login from trusted networks
  // Set ALLOWED_IPS env var in Netlify as a comma-separated list
  const allowedRaw = process.env.ALLOWED_IPS || '';
  const allowedIPs = allowedRaw.split(',').map(s => s.trim()).filter(Boolean);
  // Always allow localhost for local development
  const LOCAL_IPS = ['127.0.0.1', '::1', 'localhost', '::ffff:127.0.0.1'];
  const isLocal = LOCAL_IPS.includes(ip);
  if (allowedIPs.length > 0 && !isLocal && !allowedIPs.includes(ip)) {
    console.warn(`[PIN-LOGIN] Blocked IP: ${redactIP(ip)}`);
    return json(403, { error: 'PIN login is only available from the shop network' });
  }

  // Rate limit by IP (in-memory first, then DB check)
  const rateCheck = checkRateLimit(ip);
  if (!rateCheck.allowed) {
    return json(429, { error: 'Too many attempts. Try again shortly.', retryAfter: rateCheck.retryAfter });
  }

  // DB-backed lockout check (survives cold starts + scales across instances)
  try {
    const { data: lockCheck } = await supabase.rpc('check_pin_lockout', { p_ip: ip });
    const lockRow = lockCheck?.[0] || lockCheck;
    if (lockRow?.locked) {
      return json(429, { error: 'Too many attempts. Try again shortly.', retryAfter: lockRow.retry_after_seconds });
    }
  } catch (dbErr) {
    // FAIL CLOSED: If DB is unreachable, deny access — never grant access on error
    console.error('[PIN-LOGIN] DB lockout check failed — failing secure (deny):', dbErr.message);
    return json(503, { error: 'Authentication service unavailable. Try again shortly.' });
  }

  try {
    const { pin } = JSON.parse(event.body || '{}');

    // Validate PIN format: exactly 6 digits
    if (!pin || typeof pin !== 'string' || !/^\d{6}$/.test(pin)) {
      return json(400, { error: 'PIN must be exactly 6 digits' });
    }

    // ═══════════════════════════════════════════════════════════
    // BCRYPT PIN VERIFICATION (Schema 47)
    // Uses the verify_staff_pin RPC which does bcrypt comparison
    // server-side in PostgreSQL via pgcrypto. Falls back to legacy
    // plaintext comparison only during migration period.
    // ═══════════════════════════════════════════════════════════
    let matchedStaff = null;
    let needsPinRotation = false;

    // Try bcrypt-based verification first (post-migration)
    try {
      const { data: bcryptResult, error: bcryptErr } = await supabase.rpc('verify_staff_pin', { p_pin: pin });
      if (!bcryptErr && bcryptResult && bcryptResult.length > 0) {
        const row = bcryptResult[0];
        matchedStaff = {
          id: row.staff_id,
          name: row.staff_name,
          full_name: row.full_name,
          email: row.staff_email,
          role: row.staff_role,
          is_working: row.is_working,
        };
        needsPinRotation = row.needs_pin_rotation;
      } else if (bcryptErr) {
        // RPC doesn't exist yet (pre-migration) — fall back to legacy
        console.warn('[PIN-LOGIN] verify_staff_pin RPC unavailable, falling back to legacy:', bcryptErr.message);
      }
    } catch (rpcErr) {
      console.warn('[PIN-LOGIN] bcrypt RPC failed, falling back to legacy:', rpcErr.message);
    }

    // Legacy fallback: plaintext comparison (remove after full migration)
    if (!matchedStaff) {
      const { data: staff, error } = await supabase
        .from('staff_directory')
        .select('id, name, full_name, email, role, pin, is_working, is_active')
        .not('pin', 'is', null)
        .eq('is_active', true);  // Block deactivated / fired staff

      if (error) {
        console.error('[PIN-LOGIN] DB error:', error);
        return json(500, { error: 'Login failed' });
      }

      // Find matching staff member using constant-time comparison
      // We check ALL records to prevent timing-based enumeration
      for (const s of (staff || [])) {
        if (safeCompare(pin, s.pin)) {
          matchedStaff = s;
        }
      }
    }

    if (!matchedStaff) {
      recordAttempt(ip, false);
      // Record failure in DB (atomic, survives cold starts)
      try {
        const { data: failResult } = await supabase.rpc('record_pin_failure', {
          p_ip: ip,
          p_max_attempts: MAX_ATTEMPTS,
          p_lockout_seconds: LOCKOUT_SECONDS,
        });
        const failRow = failResult?.[0] || failResult;
        if (failRow?.locked) {
          console.warn(`[PIN-LOGIN] IP ${redactIP(ip)} locked out for ${failRow.retry_after_seconds}s (DB)`);
          return json(429, { error: 'Too many attempts. Try again shortly.', retryAfter: failRow.retry_after_seconds });
        }
      } catch (dbErr) {
        console.warn('[PIN-LOGIN] DB failure record failed:', dbErr.message);
      }
      console.warn(`[PIN-LOGIN] Failed attempt from ${redactIP(ip)}`);
      return json(401, { error: 'Invalid PIN' });
    }

    recordAttempt(ip, true);

    // Clear DB lockout on successful login
    await supabase.rpc('clear_pin_lockout', { p_ip: ip });

    // Generate a session token (signed, short-lived)
    // This is NOT a Supabase JWT — it's a simple HMAC token for ops pages
    const sessionId = crypto.randomBytes(24).toString('hex');
    const deviceFp = deriveDeviceFingerprint(event);
    const expiresAt = Date.now() + (8 * 60 * 60 * 1000); // 8-hour shift
    const payload = JSON.stringify({
      sid: sessionId,
      staffId: matchedStaff.id,
      email: matchedStaff.email,
      role: matchedStaff.role,         // middleware enforces route-level RBAC
      dfp: deviceFp,                  // device fingerprint binding
      iat: Date.now(),
      exp: expiresAt,
      needsPinRotation,               // client shows rotation prompt
    });
    const secret = process.env.INTERNAL_SYNC_SECRET;
    if (!secret) {
      console.error('[PIN-LOGIN] INTERNAL_SYNC_SECRET not configured — cannot sign PIN tokens');
      return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ error: 'Server misconfiguration' }) };
    }
    const signature = crypto.createHmac('sha256', secret).update(payload).digest('hex');
    const token = Buffer.from(payload).toString('base64') + '.' + signature;

    console.log(`[PIN-LOGIN] ${matchedStaff.name || matchedStaff.email} logged in via PIN`);

    // ═══════════════════════════════════════════════════════════
    // SECURE SESSION COOKIE: HttpOnly + Secure + SameSite=Strict
    // Client-side JS cannot read or forge this cookie.
    // The Next.js middleware verifies it on every ops page load.
    // ═══════════════════════════════════════════════════════════
    const isProduction = !['localhost', '127.0.0.1'].includes(
      (event.headers?.host || '').split(':')[0]
    );
    const cookieFlags = [
      `hub_staff_session=${token}`,
      'HttpOnly',
      `SameSite=Strict`,
      'Path=/',
      `Max-Age=${8 * 60 * 60}`, // 8-hour shift
      isProduction ? 'Secure' : '',
    ].filter(Boolean).join('; ');

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': process.env.SITE_URL || 'https://brewhubphl.com',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Credentials': 'true',
        'Set-Cookie': cookieFlags,
      },
      body: JSON.stringify({
        success: true,
        token,
        needsPinRotation,  // Schema 47: client shows rotation prompt
        staff: {
          id: matchedStaff.id,
          name: matchedStaff.full_name || matchedStaff.name,
          email: matchedStaff.email,
          role: matchedStaff.role,
          // DECOUPLED: Login never implies clock-in. Everyone starts Off-Duty.
          // The real is_working flag is set ONLY by an explicit clock-in action
          // via pin-clock.js → atomic_staff_clock RPC.
          is_working: false,
        },
      }),
    };
  } catch (err) {
    console.error('[PIN-LOGIN] Error:', err);
    return json(500, { error: 'Login failed' });
  }
};
