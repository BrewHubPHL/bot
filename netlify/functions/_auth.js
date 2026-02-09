const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAdmin = createClient(supabaseUrl, process.env.SUPABASE_SERVICE_ROLE_KEY);

const json = (statusCode, payload) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(payload),
});

function getJwtIat(token) {
  try {
    const payloadPart = token.split('.')[1];
    if (!payloadPart) return null;
    const payloadJson = Buffer.from(payloadPart, 'base64').toString('utf8');
    const payload = JSON.parse(payloadJson);
    return typeof payload.iat === 'number' ? payload.iat : null;
  } catch (err) {
    return null;
  }
}

/**
 * Authorize a request. Returns user info + role.
 * @param {object} event - Netlify function event
 * @param {object} options - { requireManager: boolean, allowServiceSecret: boolean, maxTokenAgeMinutes: number }
 */
async function authorize(event, options = {}) {
  const { requireManager = false, allowServiceSecret = false, maxTokenAgeMinutes = null } = options;

  // Internal service-to-service calls - ONLY allowed if explicitly enabled
  // This prevents INTERNAL_SYNC_SECRET from being a "god mode" bypass
  if (allowServiceSecret) {
    const secret = event.headers?.['x-brewhub-secret'];
    if (secret && secret === process.env.INTERNAL_SYNC_SECRET) {
      return { ok: true, via: 'secret', role: 'service' };
    }
  }

  const authHeader = event.headers?.authorization || event.headers?.Authorization;
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return { ok: false, response: json(401, { error: 'Unauthorized' }) };

  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data?.user) {
    return { ok: false, response: json(401, { error: 'Unauthorized' }) };
  }

  // Revocation check: deny if user was revoked after token issuance
  try {
    const { data: revoked, error: revokedError } = await supabaseAdmin
      .from('revoked_users')
      .select('revoked_at')
      .eq('user_id', data.user.id)
      .single();

    if (revokedError && revokedError.code !== 'PGRST116') {
      console.error('[AUTH] Revocation check failed:', revokedError);
      return { ok: false, response: json(500, { error: 'Authorization failed' }) };
    }

    if (revoked?.revoked_at) {
      const iat = getJwtIat(token);
      const revokedAt = new Date(revoked.revoked_at).getTime();
      const issuedAt = iat ? iat * 1000 : 0;

      if (!iat || revokedAt >= issuedAt) {
        console.error(`[AUTH BLOCKED] Revoked user token: ${data.user.email}`);
        return { ok: false, response: json(403, { error: 'Access revoked' }) };
      }
    }
  } catch (err) {
    console.error('[AUTH] Revocation crash:', err);
    return { ok: false, response: json(500, { error: 'Authorization failed' }) };
  }

  // ═══════════════════════════════════════════════════════════
  // TOKEN FRESHNESS CHECK (Stateless-to-Stateful Hybrid)
  // ═══════════════════════════════════════════════════════════
  // For high-sensitivity endpoints, reject tokens older than maxTokenAgeMinutes.
  // This forces re-authentication for financial/PII operations.
  if (maxTokenAgeMinutes !== null) {
    const iat = getJwtIat(token);
    if (!iat) {
      return { ok: false, response: json(401, { error: 'Invalid token: missing iat' }) };
    }
    const tokenAgeMs = Date.now() - (iat * 1000);
    const maxAgeMs = maxTokenAgeMinutes * 60 * 1000;
    if (tokenAgeMs > maxAgeMs) {
      console.error(`[AUTH BLOCKED] Stale token (${Math.round(tokenAgeMs/60000)}min old): ${data.user.email}`);
      return { ok: false, response: json(401, { error: 'Session expired. Please re-authenticate.' }) };
    }
  }

  const email = (data.user.email || '').toLowerCase();
  
  // SSoT CHECK: Query staff_directory instead of env var
  // Also fetch token versioning fields for immediate invalidation detection
  const { data: staffRecord, error: staffError } = await supabaseAdmin
      .from('staff_directory')
      .select('role, token_version, version_updated_at')
      .eq('email', email)
      .single();

  if (staffError || !staffRecord) {
     console.error(`[AUTH BLOCKED] Access denied (Not in Staff Directory): ${email}`);
     return { ok: false, response: json(403, { error: 'Forbidden' }) };
  }

  // ═══════════════════════════════════════════════════════════
  // TOKEN VERSIONING: Immediate Session Invalidation
  // ═══════════════════════════════════════════════════════════
  // If the staff member's role was changed (or sessions were manually invalidated),
  // version_updated_at will be newer than the token's issued-at time.
  // This forces immediate re-authentication despite a valid JWT.
  if (staffRecord.version_updated_at) {
    const versionUpdatedAt = new Date(staffRecord.version_updated_at).getTime();
    const iat = getJwtIat(token);
    const tokenIssuedAt = iat ? iat * 1000 : 0;

    if (versionUpdatedAt > tokenIssuedAt) {
      console.warn(`[AUTH BLOCKED] Token invalidated by version bump: ${email} (v${staffRecord.token_version})`);
      return { 
        ok: false, 
        response: json(401, { 
          error: 'Session invalidated. Please sign in again.',
          code: 'TOKEN_VERSION_MISMATCH'
        }) 
      };
    }
  }

  const role = staffRecord.role;
  const isManager = (role === 'manager' || role === 'admin');

  // If endpoint requires manager role, enforce it
  if (requireManager && !isManager) {
    console.error(`[AUTH BLOCKED] Staff attempted manager action: ${email}`);
    return { ok: false, response: json(403, { error: 'Forbidden: Manager access required' }) };
  }

  return { 
    ok: true, 
    via: 'jwt', 
    user: data.user,
    role: role
  };
}

/**
 * Sanitize error responses to prevent schema snooping.
 * Logs the real error server-side but returns a generic message to clients.
 * @param {Error|object} error - The actual error object
 * @param {string} context - Where the error occurred (for logging)
 * @returns {object} - Netlify response object with sanitized error
 */
function sanitizedError(error, context = 'Operation') {
  // Log the real error server-side for debugging
  console.error(`[${context}] Internal error:`, error?.message || error);
  
  // Never expose these patterns to clients
  const sensitivePatterns = [
    /relation ".*" does not exist/i,
    /column ".*" does not exist/i,
    /permission denied/i,
    /violates row-level security/i,
    /PGRST\d+/i,
    /42P01|42501|42703/i // PostgreSQL error codes
  ];

  const errorMsg = String(error?.message || error || '');
  const isSensitive = sensitivePatterns.some(p => p.test(errorMsg));

  return json(500, { 
    error: isSensitive ? 'An error occurred. Please try again.' : 'Operation failed'
  });
}

module.exports = { authorize, json, sanitizedError };