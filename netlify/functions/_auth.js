const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');
const { redactIP } = require('./_ip-hash');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const json = (code, data) => ({ statusCode: code, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });

function getClientIP(event) {
  return event.headers['x-nf-client-connection-ip'] || event.headers['x-forwarded-for']?.split(',')[0]?.trim() || 'unknown';
}

function isIPAllowed(ip) {
  if (ip === '127.0.0.1' || ip === '::1') return true;
  const allowed = process.env.ALLOWED_IPS;
  if (!allowed) {
    console.error('[IP GATE] ALLOWED_IPS env var is not set — blocking all non-localhost requests. Set ALLOWED_IPS=* to explicitly allow all IPs.');
    return false;
  }
  if (allowed.trim() === '*') return true;
  return allowed.split(',').map(x => x.trim()).includes(ip);
}

function getJwtIat(token) {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString('utf8'));
    return payload.iat || null;
  } catch { return null; }
}

async function authorize(event, options = {}) {
  const { requireManager = false, allowServiceSecret = false, maxTokenAgeMinutes = null, requirePin = false, allowManagerIPBypass = false } = options;

  const clientIP = getClientIP(event);
  const ipAllowed = isIPAllowed(clientIP);

  // If IP is blocked and manager bypass is NOT requested, fail immediately
  if (!ipAllowed && !allowManagerIPBypass) {
    console.error(`[IP BLOCKED] ${redactIP(clientIP)}`);
    return { ok: false, response: json(403, { error: 'Access denied: Unauthorized IP' }) };
  }
  // If IP is blocked but manager bypass IS requested, we defer the check
  // until after token verification so we can inspect the role.
  const ipCheckDeferred = !ipAllowed && allowManagerIPBypass;

  if (allowServiceSecret) {
    const secret = event.headers?.['x-brewhub-secret'];
    const envSecret = process.env.INTERNAL_SYNC_SECRET;
    if (secret && envSecret) {
      const bufA = Buffer.from(secret);
      const bufB = Buffer.from(envSecret);
      if (bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB)) {
        if (requireManager) return { ok: false, response: json(403, { error: 'Service tokens cannot perform manager actions' }) };
        return { ok: true, via: 'secret', role: 'service' };
      }
    }
  }

  const authHeader = event.headers?.authorization || event.headers?.Authorization;
  let token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

  // Fall back to HttpOnly hub_staff_session cookie (set by pin-login.js)
  // when no Authorization header is present — e.g. customer-facing pages
  // where client JS cannot read the HttpOnly cookie to set the header.
  if (!token) {
    const cookieHeader = event.headers?.cookie || '';
    const match = cookieHeader.match(/(?:^|;\s*)hub_staff_session=([^;]+)/);
    if (match) token = decodeURIComponent(match[1]);
  }

  if (!token) return { ok: false, response: json(401, { error: 'Unauthorized' }) };

  const parts = token.split('.');

  if (parts.length === 2) {
    try {
      const [payloadB64, signature] = parts;
      const payloadStr = Buffer.from(payloadB64, 'base64').toString('utf8');
      const secret = process.env.INTERNAL_SYNC_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;
      const expected = crypto.createHmac('sha256', secret).update(payloadStr).digest('hex');
      
      const sigBuf = Buffer.from(signature, 'hex');
      const expBuf = Buffer.from(expected, 'hex');
      if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
        return { ok: false, response: json(401, { error: 'Invalid PIN session' }) };
      }

      const payload = JSON.parse(payloadStr);
      if (!payload.exp || Date.now() > payload.exp) {
        return { ok: false, response: json(401, { error: 'PIN session expired' }) };
      }

      const email = (payload.email || '').toLowerCase();
      const { data: staff, error } = await supabase.from('staff_directory').select('role, version_updated_at').eq('email', email).single();
      if (error || !staff) return { ok: false, response: json(403, { error: 'Staff not found' }) };

      if (staff.version_updated_at && payload.iat) {
        const versionTime = new Date(staff.version_updated_at).getTime();
        if (versionTime > payload.iat) {
          console.warn(`[AUTH BLOCKED] Token version mismatch: ${email}`);
          return { ok: false, response: json(401, { error: 'Session invalidated', code: 'TOKEN_VERSION_MISMATCH' }) };
        }
      }

      const isManager = staff.role === 'manager' || staff.role === 'admin';

      // Deferred IP check: if IP was blocked and bypass was requested, enforce now for non-managers
      if (ipCheckDeferred && !isManager) {
        console.error(`[IP BLOCKED] Non-manager PIN user from unauthorized IP: ${redactIP(clientIP)}`);
        return { ok: false, response: json(403, { error: 'Access denied: Unauthorized IP' }) };
      }

      if (requireManager && !isManager) return { ok: false, response: json(403, { error: 'Manager access required' }) };

      return { ok: true, via: 'pin', user: { email, id: payload.staffId }, role: staff.role };
    } catch (err) {
      console.error('[AUTH] PIN verification failed:', err);
      return { ok: false, response: json(401, { error: 'Invalid PIN session' }) };
    }
  }

  if (parts.length === 3) {
    if (requirePin) {
      console.error('[AUTH BLOCKED] PIN required but JWT provided');
      return { ok: false, response: json(403, { error: 'PIN authentication required' }) };
    }

    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data?.user) return { ok: false, response: json(401, { error: 'Unauthorized' }) };

    const { data: revoked } = await supabase.from('revoked_users').select('revoked_at').eq('user_id', data.user.id).single();
    if (revoked?.revoked_at) {
      const iat = getJwtIat(token);
      const revokedAt = new Date(revoked.revoked_at).getTime();
      if (!iat || revokedAt >= iat * 1000) {
        console.error(`[AUTH BLOCKED] Revoked user: ${data.user.email}`);
        return { ok: false, response: json(403, { error: 'Access revoked' }) };
      }
    }

    if (maxTokenAgeMinutes !== null) {
      const iat = getJwtIat(token);
      if (!iat) return { ok: false, response: json(401, { error: 'Invalid token' }) };
      const ageMs = Date.now() - (iat * 1000);
      if (ageMs > maxTokenAgeMinutes * 60 * 1000) {
        console.error(`[AUTH BLOCKED] Stale token: ${data.user.email}`);
        return { ok: false, response: json(401, { error: 'Session expired' }) };
      }
    }

    const email = (data.user.email || '').toLowerCase();
    const { data: staff, error: staffErr } = await supabase.from('staff_directory').select('role, version_updated_at').eq('email', email).single();
    if (staffErr || !staff) {
      console.error(`[AUTH BLOCKED] Not in staff directory: ${email}`);
      return { ok: false, response: json(403, { error: 'Forbidden' }) };
    }

    if (staff.version_updated_at) {
      const versionTime = new Date(staff.version_updated_at).getTime();
      const iat = getJwtIat(token);
      if (iat && versionTime > iat * 1000) {
        console.warn(`[AUTH BLOCKED] Token version mismatch: ${email}`);
        return { ok: false, response: json(401, { error: 'Session invalidated', code: 'TOKEN_VERSION_MISMATCH' }) };
      }
    }

    const isManager = staff.role === 'manager' || staff.role === 'admin';

    // Deferred IP check: if IP was blocked and bypass was requested, enforce now for non-managers
    if (ipCheckDeferred && !isManager) {
      console.error(`[IP BLOCKED] Non-manager JWT user from unauthorized IP: ${redactIP(clientIP)}`);
      return { ok: false, response: json(403, { error: 'Access denied: Unauthorized IP' }) };
    }

    if (requireManager && !isManager) {
      console.error(`[AUTH BLOCKED] Staff attempted manager action: ${email}`);
      return { ok: false, response: json(403, { error: 'Manager access required' }) };
    }

    return { ok: true, via: 'jwt', user: data.user, role: staff.role };
  }

  return { ok: false, response: json(401, { error: 'Invalid token format' }) };
}

function sanitizedError(error, context = 'Operation') {
  console.error(`[${context}]`, error?.message || error);
  const patterns = [/relation.*does not exist/i, /column.*does not exist/i, /permission denied/i, /violates row-level security/i, /PGRST\d+/i, /42P01|42501|42703/i];
  const msg = String(error?.message || error || '');
  const isSensitive = patterns.some(p => p.test(msg));
  return json(500, { error: isSensitive ? 'An error occurred. Please try again.' : 'Operation failed' });
}

function verifyServiceSecret(event) {
  const secret = event.headers?.['x-brewhub-secret'];
  const envSecret = process.env.INTERNAL_SYNC_SECRET;
  if (!secret || !envSecret) return { valid: false, response: json(401, { error: 'Unauthorized' }) };
  const bufA = Buffer.from(secret);
  const bufB = Buffer.from(envSecret);
  if (bufA.length !== bufB.length || !crypto.timingSafeEqual(bufA, bufB)) {
    return { valid: false, response: json(401, { error: 'Unauthorized' }) };
  }
  return { valid: true };
}

module.exports = { authorize, json, sanitizedError, verifyServiceSecret };