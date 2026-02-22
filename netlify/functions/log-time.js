const { createClient } = require('@supabase/supabase-js');
const { authorize, json } = require('./_auth');
const { requireCsrfHeader } = require('./_csrf');

// Initialize with Service Role Key (Bypasses RLS)
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const ALLOWED_ORIGIN = process.env.SITE_URL || 'https://brewhubphl.com';

exports.handler = async (event) => {
  // 1. Handle CORS
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-BrewHub-Action',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
      },
      body: '',
    };
  }

  // 2. Only allow POST
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method Not Allowed' })
    };
  }

  // CSRF protection
  const csrfBlock = requireCsrfHeader(event);
  if (csrfBlock) return csrfBlock;

  try {
    // 3. Staff auth via centralized _auth.js (includes token versioning, revocation, freshness)
    const auth = await authorize(event, { requirePin: true });
    if (!auth.ok) return auth.response;

    const user = auth.user;

    // 4. PARSE REQUEST
    const { employee_email, action_type } = JSON.parse(event.body);

    // Validate action_type against allowed values
    const VALID_ACTIONS = ['in', 'out'];
    if (!VALID_ACTIONS.includes(action_type)) {
      return {
        statusCode: 400,
        headers: { 'Access-Control-Allow-Origin': ALLOWED_ORIGIN },
        body: JSON.stringify({ error: 'action_type must be "in" or "out"' })
      };
    }

    // Security: Ensure they are clocking in for THEMSELVES
    if (user.email.toLowerCase() !== employee_email.toLowerCase()) {
       return { 
         statusCode: 403, 
         headers: { 'Access-Control-Allow-Origin': ALLOWED_ORIGIN },
         body: JSON.stringify({ error: "Identity Mismatch: You can only clock in for yourself." }) 
       };
    }

    // ─── DELEGATE TO ATOMIC RPC (audit-safe path) ──────────
    // atomic_staff_clock() handles: idempotency, advisory locks,
    // 16h shift flag, is_working toggle, and immutable audit trail.
    const ip = event.headers['x-nf-client-connection-ip']
      || event.headers['x-forwarded-for']?.split(',')[0]?.trim()
      || 'unknown';

    const { data: result, error: rpcError } = await supabase.rpc(
      'atomic_staff_clock',
      {
        p_staff_id: user.id,
        p_action:   action_type,
        p_ip:       ip,
      }
    );

    if (rpcError) {
      console.error('[LOG-TIME] RPC error:', rpcError);
      return {
        statusCode: 500,
        headers: { 'Access-Control-Allow-Origin': ALLOWED_ORIGIN },
        body: JSON.stringify({ error: 'Clock operation failed' })
      };
    }

    // RPC returns { success, action, time, error, warning, is_working }
    if (!result || !result.success) {
      const errCode = result?.error_code;
      const httpStatus = errCode === 'IP_BLOCKED' ? 403
        : errCode === 'ALREADY_CLOCKED_IN' || errCode === 'NOT_CLOCKED_IN' ? 409
        : 422;
      return {
        statusCode: httpStatus,
        headers: { 'Access-Control-Allow-Origin': ALLOWED_ORIGIN },
        body: JSON.stringify({ error: result?.error || 'Clock operation failed' })
      };
    }

    return {
      statusCode: 200,
      headers: { 'Access-Control-Allow-Origin': ALLOWED_ORIGIN },
      body: JSON.stringify({
        success: true,
        message: `Clocked ${action_type} successfully`,
        ...(result.warning ? { warning: result.warning } : {}),
      })
    };

  } catch (err) {
    console.error('[LOG-TIME] Critical Error:', err);
    return {
      statusCode: 500,
      headers: { 'Access-Control-Allow-Origin': ALLOWED_ORIGIN },
      body: JSON.stringify({ error: 'System Error' })
    };
  }
};