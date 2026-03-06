const { createClient } = require('@supabase/supabase-js');
const { authorize, json } = require('./_auth');
const { requireCsrfHeader } = require('./_csrf');
const { redactIP } = require('./_ip-hash');
const { staffBucket } = require('./_token-bucket');

function withSourceComment(query, tag) {
  if (typeof query?.comment === 'function') {
    return query.comment(`source: ${tag}`);
  }
  return query;
}

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

/**
 * PIN Verify — Lightweight session check for OpsGate
 * Verifies the PIN token is still valid, enforces role-based IP gating,
 * and returns current is_working status.
 */
exports.handler = async (event) => {
  const ALLOWED_ORIGIN = process.env.SITE_URL || 'https://brewhubphl.com';
  const corsHeaders = {
    'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-BrewHub-Action',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Credentials': 'true',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: corsHeaders, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  // CSRF protection
  const csrfBlock = requireCsrfHeader(event);
  if (csrfBlock) return { ...csrfBlock, headers: { ...csrfBlock.headers, ...corsHeaders } };

  // Rate limiting — prevent session-check abuse
  const clientIp =
    event.headers['x-nf-client-connection-ip'] ||
    event.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
    '127.0.0.1';
  const rl = staffBucket.consume('pin-verify:' + clientIp);
  if (!rl.allowed) {
    console.warn(`[PIN-VERIFY] Rate limit hit from IP: ${redactIP(clientIp)}`);
    return { statusCode: 429, headers: corsHeaders, body: JSON.stringify({ error: 'Too many requests. Please wait.' }) };
  }

  // Authenticate (requires PIN token, not JWT)
  // Fast-path: if there's no session material at all, return 401 immediately
  // without calling authorize() — this is the normal case when OpsGate mounts
  // before the user has logged in, not an error worth logging.
  const hasCookie = /hub_staff_session=/.test(event.headers?.cookie || '');
  const hasAuth = !!(event.headers?.authorization || event.headers?.Authorization);
  if (!hasCookie && !hasAuth) {
    return { statusCode: 401, headers: corsHeaders, body: JSON.stringify({ error: 'No session' }) };
  }
  const auth = await authorize(event, { requirePin: true, allowManagerIPBypass: true });
  if (!auth.ok) {
    return { ...auth.response, headers: { ...auth.response.headers, ...corsHeaders } };
  }


  // DB-backed shop_ip_address check for manager/barista
  const sessionRole = (auth.role || '').toLowerCase();

  if (sessionRole === 'manager' || sessionRole === 'barista') {
    const { data: settings, error: settingsError } = await supabase
      .from('store_settings')
      .select('shop_ip_address')
      .limit(1)
      .single();
    if (settingsError || !settings) {
      return { statusCode: 503, headers: corsHeaders, body: JSON.stringify({ error: 'Shop IP unavailable' }) };
    }
    const shopIp = (settings.shop_ip_address || '').trim();
    if (clientIp !== shopIp) {
      if (sessionRole === 'barista') {
        return { statusCode: 403, headers: corsHeaders, body: JSON.stringify({ error: 'Off-site access denied. Connect to shop Wi-Fi.' }) };
      }
      if (sessionRole === 'manager') {
        return { statusCode: 403, headers: corsHeaders, body: JSON.stringify({ error: 'TOTP_REQUIRED', message: 'Unrecognized network. Enter Manager Authenticator code.' }) };
      }
    }
  }

  try {
    // Fetch full staff record so OpsGate can hydrate the session on reload
    // Schema 77: read from v_staff_status which computes is_working from time_logs
    const staffLookupQuery = withSourceComment(
      supabase
      .from('v_staff_status')
      .select('id, name, full_name, email, role, is_working, is_active, contract_signed, onboarding_complete')
      .eq('email', auth.user.email),
      'auth-staff-status-lookup'
    );
    const { data: staffRow, error } = await staffLookupQuery.single();

    if (error || !staffRow) {
      return {
        statusCode: 403,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Staff record not found' })
      };
    }

    // Re-read the raw session token from the HttpOnly cookie so OpsGate
    // can restore the full { staff, token } session contract.
    const cookieHeader = event.headers?.cookie || '';
    const tokenMatch = cookieHeader.match(/(?:^|;\s*)hub_staff_session=([^;]+)/);
    const sessionToken = tokenMatch ? decodeURIComponent(tokenMatch[1]) : null;

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        valid: true,
        token: sessionToken,
        staff: {
          id: staffRow.id,
          name: staffRow.full_name,
          email: staffRow.email,
          role: staffRow.role,
          is_working: staffRow.is_working ?? false,
          contract_signed: staffRow.contract_signed ?? false,
          onboarding_complete: staffRow.onboarding_complete ?? false,
        },
      })
    };
  } catch (err) {
    console.error('[PIN-VERIFY] Error:', err?.message);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Verification failed' })
    };
  }
};
