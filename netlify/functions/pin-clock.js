const { createClient } = require('@supabase/supabase-js');
const { authorize, json } = require('./_auth');
const { requireCsrfHeader } = require('./_csrf');
const { hashIP } = require('./_ip-hash');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const VALID_ACTIONS = ['in', 'out'];

exports.handler = async (event) => {
  const ALLOWED_ORIGIN = process.env.SITE_URL || 'https://brewhubphl.com';
  const corsHeaders = {
    'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-BrewHub-Action',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: corsHeaders, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  // CSRF protection
  const csrfBlock = requireCsrfHeader(event);
  if (csrfBlock) return { ...csrfBlock, headers: { ...csrfBlock.headers, ...corsHeaders } };

  // Authenticate using centralized authorize() — requires PIN token.
  // allowManagerIPBypass: managers/admins can clock from any network
  // (e.g., checking stats from ThinkPad at home). Non-managers are
  // still IP-gated by authorize() via ALLOWED_IPS.
  const auth = await authorize(event, { requirePin: true, allowManagerIPBypass: true });
  if (!auth.ok) {
    return { ...auth.response, headers: { ...auth.response.headers, ...corsHeaders } };
  }

  try {
    const { action } = JSON.parse(event.body || '{}');

    if (!action || !VALID_ACTIONS.includes(action)) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: `Invalid action. Must be one of: ${VALID_ACTIONS.join(', ')}` })
      };
    }

    // ── IP ENFORCEMENT (with manager bypass) ───────────────────
    // The centralized authorize() already enforces ALLOWED_IPS for
    // all staff. For clock operations specifically, we add an extra
    // layer: managers/admins can clock from ANY IP (off-network stats
    // check from ThinkPad, etc.), but baristas/staff must be on-site.
    const ip = event.headers['x-nf-client-connection-ip']
      || event.headers['x-forwarded-for']?.split(',')[0]?.trim()
      || 'unknown';

    const isManagerRole = auth.role === 'manager' || auth.role === 'admin';

    if (!isManagerRole) {
      // Double-check IP for non-manager clock operations
      const allowedRaw = process.env.ALLOWED_IPS || '';
      const allowedIPs = allowedRaw.split(',').map(s => s.trim()).filter(Boolean);
      const LOCAL_IPS = ['127.0.0.1', '::1', 'localhost', '::ffff:127.0.0.1'];
      const isLocal = LOCAL_IPS.includes(ip);
      const isWildcard = allowedRaw.trim() === '*';

      if (allowedIPs.length > 0 && !isLocal && !isWildcard && !allowedIPs.includes(ip)) {
        console.warn(`[PIN-CLOCK] IP blocked for non-manager clock: ${hashIP(ip)}`);
        return {
          statusCode: 403,
          headers: corsHeaders,
          body: JSON.stringify({ error: 'Clock operations are only available from the shop network.' })
        };
      }
    }

    // ── RESOLVE STAFF ID ───────────────────────────────────────
    // Admin tokens (issued via ADMIN_PIN) may carry a null staffId
    // if the admin row wasn't in staff_directory at login time, or
    // if a legacy session is still active. Resolve by email as fallback.
    let staffId = auth.user.id;
    if (!staffId && auth.user.email) {
      const { data: lookup, error: lookupErr } = await supabase
        .from('staff_directory')
        .select('id')
        .eq('email', auth.user.email.toLowerCase())
        .single();
      if (lookupErr || !lookup) {
        console.error('[PIN-CLOCK] Cannot resolve staff_directory ID for:', auth.user.email);
        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify({ error: 'Staff record not found. Contact a manager.' })
        };
      }
      staffId = lookup.id;
    }

    // ── CALL ATOMIC RPC ────────────────────────────────────────
    // atomic_staff_clock handles:
    //   • IP allowlist enforcement (manager bypass built in)
    //   • Idempotency (already clocked in/out → success, no duplicate row)
    //   • Atomic time_logs INSERT/UPDATE + staff_directory.is_working toggle
    //   • 16h shift flag for manager review
    const { data: result, error: rpcError } = await supabase.rpc(
      'atomic_staff_clock',
      {
        p_staff_id: staffId,
        p_action:   action,
        p_ip:       ip,
      }
    );

    if (rpcError) {
      // Schema 69: detect the DB-level "single active shift" guard
      // The trigger raises SQLSTATE P0409 or the unique index returns code 23505
      const code = rpcError?.code || '';
      const msg = rpcError?.message || '';
      const isShiftGuard =
        code === 'P0409' ||
        (code === '23505' && msg.includes('uq_one_active_shift_per_employee')) ||
        msg.includes('Shift already active');

      if (isShiftGuard) {
        console.warn('[PIN-CLOCK] DB blocked duplicate clock-in for user:', auth.user.id);
        return {
          statusCode: 409,
          headers: corsHeaders,
          body: JSON.stringify({ error: 'Shift already active. Clock out before clocking in again.' })
        };
      }

      console.error('[PIN-CLOCK] RPC error:', rpcError?.message);
      return {
        statusCode: 500,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Clock operation failed' })
      };
    }

    // RPC returns { success, action, time, error, warning, is_working }
    const row = result;
    if (!row || !row.success) {
      // Map specific RPC error codes to HTTP statuses
      const errCode = row?.error_code;
      const httpStatus = errCode === 'IP_BLOCKED' ? 403
        : errCode === 'ALREADY_CLOCKED_IN' || errCode === 'NOT_CLOCKED_IN' ? 409
        : 422;

      return {
        statusCode: httpStatus,
        headers: corsHeaders,
        body: JSON.stringify({ error: row?.error || 'Clock operation failed' })
      };
    }

    console.log(`[PIN-CLOCK] ${auth.user.email} clocked ${action.toUpperCase()}${row.warning ? ` (${row.warning})` : ''}`);

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        success: true,
        action: row.action,
        time: row.time,
        is_working: row.is_working,
        ...(row.warning ? { warning: row.warning } : {}),
      })
    };

  } catch (err) {
    console.error('[PIN-CLOCK] Error:', err?.message);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Clock operation failed' })
    };
  }
};
