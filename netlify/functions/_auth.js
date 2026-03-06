const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');
const { redactIP } = require('./_ip-hash');

function withSourceComment(query, tag) {
  if (typeof query?.comment === 'function') {
    return query.comment(`source: ${tag}`);
  }
  return query;
}

// Lazy-initialized Supabase client — avoids module-scope crash when env vars
// are missing (which turns every function that imports _auth into a 502).
let _supabase = null;
function getSupabase() {
  if (_supabase) return _supabase;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('[_auth] SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not set');
  }
  _supabase = createClient(url, key);
  return _supabase;
}

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

/**
 * Derive device fingerprint from request headers.
 * MUST match the derivation in pin-login.js AND middleware.ts:
 *   sha256(user-agent + '|' + accept-language + '|' + clientIP).slice(0, 16)
 *
 * When x-forwarded-for contains multiple IPs we use only the first
 * (left-most) entry to keep the hash deterministic.
 */
function deriveDeviceFingerprint(event, { log = false } = {}) {
  const ua = event.headers?.['user-agent'] || '';
  const accept = event.headers?.['accept-language'] || '';
  const xff = event.headers?.['x-forwarded-for'];
  const clientIp =
    event.headers?.['x-nf-client-connection-ip']
    || (xff ? xff.split(',')[0].trim() : null)
    || '127.0.0.1';
  const raw = `${ua}|${accept}|${clientIp}`;
  const hash = crypto.createHash('sha256').update(raw).digest('hex').slice(0, 16);
  if (log) {
    console.log(`[DFP] hash=${hash} ip=${clientIp} accept-lang=${accept.substring(0, 40)} ua=${ua.substring(0, 60)}`);
  }
  return hash;
}

async function authorize(event, options = {}) {
  const {
    requireManager = false,
    requireOnboarded = false,
    allowServiceSecret = false,
    maxTokenAgeMinutes = null,
    requirePin = false,
    allowManagerIPBypass = false,
    requireManagerChallenge = false,  // Schema 47: require TOTP challenge nonce
    challengeActionType = null,       // e.g. 'adjust_hours', 'fix_clock', 'comp_order'
    allowCustomer = false,            // When true, valid customer JWTs pass without a staff_directory record
  } = options;

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
      // Hash both to fixed-length digests to eliminate length side-channel
      const hashA = crypto.createHash('sha256').update(secret).digest();
      const hashB = crypto.createHash('sha256').update(envSecret).digest();
      if (crypto.timingSafeEqual(hashA, hashB)) {
        if (requireManager) return { ok: false, response: json(403, { error: 'Service tokens cannot perform manager actions' }) };
        return { ok: true, via: 'secret', role: 'service' };
      }
    }
  }

  // ── Session signing uses a dedicated key, separate from service-to-service auth
  const sessionSigningKey = process.env.SESSION_SIGNING_KEY || process.env.INTERNAL_SYNC_SECRET;

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

  if (!token) {
    console.warn('[AUTH] No token found — checked Authorization header and hub_staff_session cookie');
    return { ok: false, response: json(401, { error: 'Unauthorized' }) };
  }

  const parts = token.split('.');

  if (parts.length === 2) {
    try {
      const [payloadB64, signature] = parts;
      const payloadStr = Buffer.from(payloadB64, 'base64').toString('utf8');
      if (!sessionSigningKey) {
        console.error('[AUTH] SESSION_SIGNING_KEY / INTERNAL_SYNC_SECRET not configured — cannot verify PIN tokens');
        return { ok: false, response: json(500, { error: 'Server misconfiguration' }) };
      }
      const expected = crypto.createHmac('sha256', sessionSigningKey).update(payloadStr).digest('hex');
      
      const sigBuf = Buffer.from(signature, 'hex');
      const expBuf = Buffer.from(expected, 'hex');
      if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
        console.warn('[AUTH] HMAC signature mismatch on PIN token');
        return { ok: false, response: json(401, { error: 'Invalid PIN session' }) };
      }

      const payload = JSON.parse(payloadStr);
      if (!payload.exp || Date.now() > payload.exp) {
        console.warn(`[AUTH] PIN token expired: exp=${payload.exp} now=${Date.now()}`);
        return { ok: false, response: json(401, { error: 'PIN session expired' }) };
      }

      const email = (payload.email || '').toLowerCase();

      // ═══════════════════════════════════════════════════════════
      // Admin god mode — tokens issued with role:'admin' via the
      // ADMIN_PIN env-var bypass skip the staff_directory lookup
      // entirely.  The admin may or may not have a row in
      // staff_directory; we don't gate on that.
      //
      // Device fingerprint is still enforced to prevent token
      // theft/replay from a different device.
      // Token version is checked when the admin has a staff_directory row.
      // ═══════════════════════════════════════════════════════════
      if (payload.role === 'admin') {
        if (payload.dfp) {
          const currentFp = deriveDeviceFingerprint(event, { log: true });
          if (payload.dfp !== currentFp) {
            // Soft warning — cookie is HttpOnly+Secure+SameSite=Lax+HMAC-signed,
            // so DFP is defense-in-depth. Header drift between requests on Netlify
            // (edge vs serverless, accept-language presence) causes false positives.
            console.warn(`[AUTH DFP WARN] Admin fingerprint drift: token=${payload.dfp} current=${currentFp}`);
          }
        }
        // If the admin token carries a token_version, verify it against the DB
        if (typeof payload.token_version === 'number' && email) {
          const { data: adminRow } = await getSupabase()
            .from('staff_directory')
            .select('token_version')
            .eq('email', email)
            .single();
          if (adminRow && adminRow.token_version !== payload.token_version) {
            console.warn(`[AUTH BLOCKED] Admin token_version mismatch: token=${payload.token_version} db=${adminRow.token_version}`);
            return { ok: false, response: json(401, { error: 'Session invalidated', code: 'TOKEN_VERSION_MISMATCH' }) };
          }
        }
        return {
          ok: true,
          via: 'pin',
          user: { email, id: payload.staffId || null },
          role: 'admin',
          deviceFingerprint: payload.dfp,
        };
      }

      const staffLookupQuery = withSourceComment(
        getSupabase().from('staff_directory').select('role, token_version, version_updated_at, onboarding_complete').eq('email', email),
        'auth-authorize-guard'
      );
      const { data: staff, error } = await staffLookupQuery.single();
      if (error || !staff) return { ok: false, response: json(403, { error: 'Staff not found' }) };

      // Primary defense: integer token_version comparison (O(1), no clock skew)
      if (typeof payload.token_version === 'number' && staff.token_version !== payload.token_version) {
        console.warn(`[AUTH BLOCKED] token_version mismatch for ${email}: token=${payload.token_version} db=${staff.token_version}`);
        return { ok: false, response: json(401, { error: 'Session invalidated', code: 'TOKEN_VERSION_MISMATCH' }) };
      }
      // Fallback for legacy tokens minted before token_version was embedded
      if (typeof payload.token_version !== 'number' && staff.version_updated_at && payload.iat) {
        const versionTime = new Date(staff.version_updated_at).getTime();
        if (versionTime > payload.iat) {
          console.warn(`[AUTH BLOCKED] Legacy token version mismatch (timestamp): ${email}`);
          return { ok: false, response: json(401, { error: 'Session invalidated', code: 'TOKEN_VERSION_MISMATCH' }) };
        }
      }

      // ═══════════════════════════════════════════════════════════
      // Onboarding gate: if requireOnboarded is true, block staff
      // who have not completed onboarding (contract unsigned).
      // ═══════════════════════════════════════════════════════════
      if (requireOnboarded && !staff.onboarding_complete) {
        console.warn(`[AUTH BLOCKED] Onboarding incomplete for ${email}`);
        return { ok: false, response: json(403, { error: 'ONBOARDING_REQUIRED' }) };
      }

      const isManager = staff.role === 'manager' || staff.role === 'admin';

      // Deferred IP check: if IP was blocked and bypass was requested, enforce now for non-managers
      if (ipCheckDeferred && !isManager) {
        console.error(`[IP BLOCKED] Non-manager PIN user from unauthorized IP: ${redactIP(clientIP)}`);
        return { ok: false, response: json(403, { error: 'Access denied: Unauthorized IP' }) };
      }

      if (requireManager && !isManager) return { ok: false, response: json(403, { error: 'Manager access required' }) };

      // ═══════════════════════════════════════════════════════════
      // Schema 47: Device fingerprint binding
      // If the token contains a device fingerprint (dfp), verify it
      // matches the current request. Prevents token theft/reuse.
      // ═══════════════════════════════════════════════════════════
      if (payload.dfp) {
        const currentFp = deriveDeviceFingerprint(event, { log: true });
        if (payload.dfp !== currentFp) {
          // Soft warning — see admin block comment above.
          console.warn(`[AUTH DFP WARN] Staff fingerprint drift for ${email}: token=${payload.dfp} current=${currentFp}`);
        }
      }

      // ═══════════════════════════════════════════════════════════
      // Schema 47: Manager challenge nonce verification
      // For sensitive operations, require a one-time TOTP challenge
      // nonce in addition to the session token.
      // ═══════════════════════════════════════════════════════════
      if (requireManagerChallenge && isManager) {
        let body;
        try { body = JSON.parse(event.body || '{}'); } catch { body = {}; }
        const challengeNonce = body._challenge_nonce || event.headers?.['x-brewhub-challenge'];
        if (!challengeNonce) {
          return { ok: false, response: json(403, { error: 'Manager challenge required', code: 'CHALLENGE_REQUIRED' }) };
        }
        // Verify + consume the nonce atomically
        try {
          const { data: nonceResult, error: nonceError } = await getSupabase().rpc('consume_challenge_nonce', {
            p_nonce: challengeNonce,
            p_staff_email: email,
          });
          if (nonceError) {
            console.error('[AUTH] consume_challenge_nonce RPC failed:', nonceError.message);
            return { ok: false, response: json(500, { error: 'Challenge verification failed' }) };
          }
          const row = nonceResult?.[0] || nonceResult;
          if (!row?.valid) {
            console.warn(`[AUTH BLOCKED] Invalid/expired challenge nonce for ${email}`);
            return { ok: false, response: json(403, { error: 'Invalid or expired challenge code', code: 'CHALLENGE_INVALID' }) };
          }
          // Optionally verify the nonce was issued for the right action type
          if (challengeActionType && row.action_type !== challengeActionType) {
            console.warn(`[AUTH BLOCKED] Challenge action mismatch: expected=${challengeActionType} got=${row.action_type}`);
            return { ok: false, response: json(403, { error: 'Challenge code was issued for a different action', code: 'CHALLENGE_ACTION_MISMATCH' }) };
          }
        } catch (nonceErr) {
          console.error('[AUTH] Challenge nonce verification failed:', nonceErr.message);
          return { ok: false, response: json(500, { error: 'Challenge verification failed' }) };
        }
      }

      return { ok: true, via: 'pin', user: { email, id: payload.staffId }, role: staff.role, onboarding_complete: staff.onboarding_complete, deviceFingerprint: payload.dfp };
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

    const { data, error } = await getSupabase().auth.getUser(token);
    if (error || !data?.user) return { ok: false, response: json(401, { error: 'Unauthorized' }) };

    const { data: revoked, error: revokedErr } = await getSupabase().from('revoked_users').select('revoked_at').eq('user_id', data.user.id).single();
    // Fail closed: if the revocation check itself errors (network/DB), deny access.
    // PGRST116 ("not found") is expected when the user is NOT revoked — allow through.
    if (revokedErr && revokedErr.code !== 'PGRST116') {
      console.error(`[AUTH] Revocation check failed for ${data.user.email}: ${revokedErr.message}`);
      return { ok: false, response: json(500, { error: 'Unable to verify account status' }) };
    }
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

    // Customer JWT fast-path: skip staff_directory lookup entirely
    if (options.allowCustomer) {
      return { ok: true, via: 'jwt', user: data.user, role: 'customer' };
    }

    const email = (data.user.email || '').toLowerCase();
    const staffLookupQuery = withSourceComment(
      getSupabase().from('staff_directory').select('role, token_version, version_updated_at, onboarding_complete').eq('email', email),
      'auth-authorize-guard'
    );
    const { data: staff, error: staffErr } = await staffLookupQuery.single();
    if (staffErr || !staff) {
      console.error(`[AUTH BLOCKED] Not in staff directory: ${email}`);
      return { ok: false, response: json(403, { error: 'Forbidden' }) };
    }

    // Supabase JWTs don't carry token_version, so fall back to timestamp check
    if (staff.version_updated_at) {
      const versionTime = new Date(staff.version_updated_at).getTime();
      const iat = getJwtIat(token);
      if (iat && versionTime > iat * 1000) {
        console.warn(`[AUTH BLOCKED] Token version mismatch (timestamp): ${email}`);
        return { ok: false, response: json(401, { error: 'Session invalidated', code: 'TOKEN_VERSION_MISMATCH' }) };
      }
    }

    // Onboarding gate for Supabase JWT path
    if (requireOnboarded && !staff.onboarding_complete) {
      console.warn(`[AUTH BLOCKED] Onboarding incomplete for JWT user: ${email}`);
      return { ok: false, response: json(403, { error: 'ONBOARDING_REQUIRED' }) };
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
  // Hash both to fixed-length digests to eliminate length side-channel
  const hashA = crypto.createHash('sha256').update(secret).digest();
  const hashB = crypto.createHash('sha256').update(envSecret).digest();
  if (!crypto.timingSafeEqual(hashA, hashB)) {
    return { valid: false, response: json(401, { error: 'Unauthorized' }) };
  }
  return { valid: true };
}

/**
 * Create a signed PIN session token (HMAC, not JWT)
 * @param {Object} payload - Staff/session info
 * @returns {string} token
 */
function signToken(payload) {
  const secret = process.env.SESSION_SIGNING_KEY || process.env.INTERNAL_SYNC_SECRET;
  if (!secret) throw new Error('SESSION_SIGNING_KEY or INTERNAL_SYNC_SECRET not configured');
  // Add expiration and issued-at
  const now = Date.now();
  const exp = now + 8 * 60 * 60 * 1000; // 8 hours
  const fullPayload = { ...payload, iat: now, exp };
  const payloadStr = JSON.stringify(fullPayload);
  const payloadB64 = Buffer.from(payloadStr, 'utf8').toString('base64');
  const signature = crypto.createHmac('sha256', secret).update(payloadStr).digest('hex');
  return `${payloadB64}.${signature}`;
}

module.exports = { authorize, json, sanitizedError, verifyServiceSecret, signToken };