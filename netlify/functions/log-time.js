const { createClient } = require('@supabase/supabase-js');
const { authorize, json } = require('./_auth');
const { requireCsrfHeader } = require('./_csrf');
const { hashIP } = require('./_ip-hash');
const { staffBucket } = require('./_token-bucket');

// Initialize with Service Role Key (Bypasses RLS)
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const MISSING_ENV = !process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY;

const ALLOWED_ORIGINS = new Set([
  process.env.SITE_URL,
  'https://brewhubphl.com',
  'https://www.brewhubphl.com',
].filter(Boolean));

function validateOrigin(headers) {
  const origin = headers['origin'] || headers['Origin'] || '';
  if (ALLOWED_ORIGINS.has(origin)) return origin;
  if (origin === '' && process.env.SITE_URL) return process.env.SITE_URL;
  return null;
}

const cors = (code, data, headers = {}) => ({
  statusCode: code,
  headers: Object.assign({
    'Content-Type': 'application/json',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-BrewHub-Action',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  }, headers),
  body: JSON.stringify(data),
});

function corsWithOrigin(code, data, origin) {
  const hdrs = {};
  if (origin) hdrs['Access-Control-Allow-Origin'] = origin;
  return cors(code, data, hdrs);
}

exports.handler = async (event) => {
  if (MISSING_ENV) return cors(500, { error: 'Server misconfiguration' });

  // 1. Handle CORS
  if (event.httpMethod === 'OPTIONS') {
    const origin = validateOrigin(event.headers || {});
    return {
      statusCode: 200,
      headers: Object.assign({ 'Vary': 'Origin' }, origin ? { 'Access-Control-Allow-Origin': origin } : {}, {
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-BrewHub-Action',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
      }),
      body: '',
    };
  }

  // 2. Only allow POST
  if (event.httpMethod !== 'POST') {
    const origin = validateOrigin(event.headers || {});
    return corsWithOrigin(405, { error: 'Method Not Allowed' }, origin);
  }

  // CSRF protection
  const csrfBlock = requireCsrfHeader(event);
  if (csrfBlock) return csrfBlock;

  try {
    // 3. Staff auth via centralized _auth.js (includes token versioning, revocation, freshness)
    const auth = await authorize(event, { requirePin: true });
    if (!auth.ok) return auth.response;

    const user = auth.user;

    // pre-parse body size cap (defense-in-depth)
    const bodyBytes = Buffer.byteLength(event.body || '', 'utf8');
    const MAX_BYTES = 8 * 1024; // 8KB
    if (bodyBytes > MAX_BYTES) {
      const origin = validateOrigin(event.headers || {});
      return corsWithOrigin(413, { error: 'Request body too large' }, origin);
    }

    // 4. PARSE REQUEST
    let payload;
    try {
      payload = JSON.parse(event.body || '{}');
    } catch (e) {
      const origin = validateOrigin(event.headers || {});
      return corsWithOrigin(422, { error: 'Request body must be valid JSON' }, origin);
    }
    const { action_type } = payload;

    // Validate action_type against allowed values
    const VALID_ACTIONS = ['in', 'out'];
    if (!VALID_ACTIONS.includes(action_type)) {
      const origin = validateOrigin(event.headers || {});
      return corsWithOrigin(400, { error: 'action_type must be "in" or "out"' }, origin);
    }

    // ─── DELEGATE TO ATOMIC RPC (audit-safe path) ──────────
    // atomic_staff_clock() handles: idempotency, advisory locks,
    // 16h shift flag, is_working toggle, and immutable audit trail.
    const ip = event.headers['x-nf-client-connection-ip']
      || event.headers['x-forwarded-for']?.split(',')[0]?.trim()
      || 'unknown';

    // Rate limit per-user+ip
    try {
      const rlKey = `clock:${user.id}:${ip}`;
      const take = staffBucket.consume(rlKey);
      if (!take.allowed) {
        const origin = validateOrigin(event.headers || {});
        return corsWithOrigin(429, { error: 'Too many requests. Please slow down.', retryAfterMs: take.retryAfterMs }, origin);
      }
    } catch (rlErr) {
      console.error('[LOG-TIME] Rate limit check failed (continuing):', rlErr?.message || 'unknown');
    }

    const { data: result, error: rpcError } = await supabase.rpc(
      'atomic_staff_clock',
      {
        p_staff_id: user.id,
        p_action:   action_type,
        p_ip:       hashIP(ip),
      }
    );

    if (rpcError) {
      console.error('[LOG-TIME] RPC error:', rpcError?.message || 'unknown');
      const origin = validateOrigin(event.headers || {});
      return corsWithOrigin(500, { error: 'Clock operation failed' }, origin);
    }

    // RPC returns { success, action, time, error, warning, is_working }
    if (!result || !result.success) {
      const errCode = result?.error_code;
      const httpStatus = errCode === 'IP_BLOCKED' ? 403
        : errCode === 'ALREADY_CLOCKED_IN' || errCode === 'NOT_CLOCKED_IN' ? 409
        : 422;
      const origin = validateOrigin(event.headers || {});
      return corsWithOrigin(httpStatus, { error: result?.error || 'Clock operation failed' }, origin);
    }
    const origin = validateOrigin(event.headers || {});
    return corsWithOrigin(200, {
      success: true,
      message: `Clocked ${action_type} successfully`,
      ...(result.warning ? { warning: result.warning } : {}),
    }, origin);

  } catch (err) {
    console.error('[LOG-TIME] Critical Error:', err?.message || 'unknown');
    const origin = validateOrigin(event.headers || {});
    return corsWithOrigin(500, { error: 'System Error' }, origin);
  }
};