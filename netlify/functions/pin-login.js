const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// In-memory rate limiting (per-instance, resets on cold start)
const attempts = new Map();
const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 60_000; // 1 minute lockout after 5 failures

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
 */
function safeCompare(a, b) {
  if (!a || !b) return false;
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
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
  if (allowedIPs.length > 0 && !allowedIPs.includes(ip)) {
    console.warn(`[PIN-LOGIN] Blocked IP: ${ip}`);
    return json(403, { error: 'PIN login is only available from the shop network' });
  }

  // Rate limit by IP
  const rateCheck = checkRateLimit(ip);
  if (!rateCheck.allowed) {
    return json(429, { error: 'Too many attempts. Try again shortly.', retryAfter: rateCheck.retryAfter });
  }

  try {
    const { pin } = JSON.parse(event.body || '{}');

    // Validate PIN format: exactly 6 digits
    if (!pin || typeof pin !== 'string' || !/^\d{6}$/.test(pin)) {
      return json(400, { error: 'PIN must be exactly 6 digits' });
    }

    // Fetch all staff PINs (small table — typically < 20 rows)
    const { data: staff, error } = await supabase
      .from('staff_directory')
      .select('id, name, full_name, email, role, pin, is_working')
      .not('pin', 'is', null);

    if (error) {
      console.error('[PIN-LOGIN] DB error:', error);
      return json(500, { error: 'Login failed' });
    }

    // Find matching staff member using constant-time comparison
    // We check ALL records to prevent timing-based enumeration
    let matchedStaff = null;
    for (const s of (staff || [])) {
      if (safeCompare(pin, s.pin)) {
        matchedStaff = s;
      }
    }

    if (!matchedStaff) {
      recordAttempt(ip, false);
      console.warn(`[PIN-LOGIN] Failed attempt from ${ip}`);
      return json(401, { error: 'Invalid PIN' });
    }

    recordAttempt(ip, true);

    // Generate a session token (signed, short-lived)
    // This is NOT a Supabase JWT — it's a simple HMAC token for ops pages
    const sessionId = crypto.randomBytes(24).toString('hex');
    const expiresAt = Date.now() + (8 * 60 * 60 * 1000); // 8-hour shift
    const payload = JSON.stringify({
      sid: sessionId,
      staffId: matchedStaff.id,
      email: matchedStaff.email,
      exp: expiresAt,
    });
    const secret = process.env.INTERNAL_SYNC_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;
    const signature = crypto.createHmac('sha256', secret).update(payload).digest('hex');
    const token = Buffer.from(payload).toString('base64') + '.' + signature;

    console.log(`[PIN-LOGIN] ${matchedStaff.name || matchedStaff.email} logged in via PIN`);

    return json(200, {
      success: true,
      token,
      staff: {
        id: matchedStaff.id,
        name: matchedStaff.full_name || matchedStaff.name,
        email: matchedStaff.email,
        role: matchedStaff.role,
        is_working: matchedStaff.is_working,
      },
    });
  } catch (err) {
    console.error('[PIN-LOGIN] Error:', err);
    return json(500, { error: 'Login failed' });
  }
};
