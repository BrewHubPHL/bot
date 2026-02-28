const { createClient } = require('@supabase/supabase-js');
const { authorize, json } = require('./_auth');
const { requireCsrfHeader } = require('./_csrf');
const { redactIP } = require('./_ip-hash');

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
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
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

  // Authenticate (requires PIN token, not JWT)
  const auth = await authorize(event, { requirePin: true });
  if (!auth.ok) {
    return { ...auth.response, headers: { ...auth.response.headers, ...corsHeaders } };
  }


  // DB-backed shop_ip_address check for manager/barista
  const clientIp = event.headers['x-nf-client-connection-ip']
    || event.headers['x-forwarded-for']?.split(',')[0]?.trim()
    || 'unknown';
  const sessionRole = (auth.user.role || '').toLowerCase();

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
    // Fetch current is_working status from staff_directory
    const { data: staff, error } = await supabase
      .from('staff_directory')
      .select('is_working')
      .eq('email', auth.user.email)
      .single();

    if (error || !staff) {
      return {
        statusCode: 403,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Staff record not found' })
      };
    }

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        valid: true,
        is_working: staff.is_working ?? false
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
