/**
 * get-staff-loyalty.js — PIN-authenticated loyalty lookup for POS + Scanner.
 *
 * Replaces direct anon-client queries to the unified customers table
 * (anon role gets deny-all RLS, so this uses service_role via PIN auth).
 *
 * Auth: Staff PIN (via _auth.js)
 * CSRF: Yes (X-BrewHub-Action)
 * Rate: No (already behind OpsGate + PIN)
 *
 * Audit #25
 */
const { createClient } = require('@supabase/supabase-js');
const { authorize, json } = require('./_auth');
const { requireCsrfHeader } = require('./_csrf');
const { sanitizeInput } = require('./_sanitize');

function maskCode(code) {
  if (!code || typeof code !== 'string') return null;
  return '****' + code.slice(-4);
}

function maskEmail(email) {
  if (!email || typeof email !== 'string') return null;
  return String(email).replace(/^(.).+(@.+)$/, '$1***$2');
}

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const ALLOWED_ORIGINS = [
  process.env.URL,
  'https://brewhubphl.com',
  'https://www.brewhubphl.com',
].filter(Boolean);

function getCorsOrigin(event) {
  const origin = event.headers?.origin || '';
  return ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
}

exports.handler = async (event) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': getCorsOrigin(event),
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-BrewHub-Action',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: corsHeaders, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  // CSRF
  const csrfBlock = requireCsrfHeader(event);
  if (csrfBlock) return { ...csrfBlock, headers: { ...csrfBlock.headers, ...corsHeaders } };

  // Require staff PIN
  const auth = await authorize(event, { requirePin: true });
  if (!auth.ok) {
    return { ...auth.response, headers: { ...auth.response.headers, ...corsHeaders } };
  }

  try {
    let body;
    try {
      body = JSON.parse(event.body || '{}');
    } catch {
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'Invalid JSON' }) };
    }

    const rawEmail = typeof body.email === 'string' ? body.email : '';
    const email = sanitizeInput(rawEmail).toLowerCase().trim().slice(0, 254);
    const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (!email || !EMAIL_RE.test(email)) {
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'Valid email required' }) };
    }

    // ── Unified CRM: single customers table lookup ───────────
    const { data: customer, error: cErr } = await supabase
      .from('customers')
      .select('id, auth_id, full_name, loyalty_points, email')
      .eq('email', email)
      .maybeSingle();

    if (cErr) {
      console.error('[GET-STAFF-LOYALTY] customers error:', cErr?.message);
      return { statusCode: 502, headers: corsHeaders, body: JSON.stringify({ error: 'Loyalty lookup failed' }) };
    }

    // ── Fetch unredeemed vouchers (if customer found) ─────────
    let vouchers = [];
    if (customer?.id) {
      const { data: vData } = await supabase
        .from('vouchers')
        .select('id, code')
        .eq('user_id', customer.id)
        .eq('is_redeemed', false);
      vouchers = (vData || []).map(v => ({ id: v.id, masked_code: maskCode(v.code) }));
    }

    // If not found, report not found
    if (!customer) {
      return {
        statusCode: 404,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'No loyalty account found', found: false }),
      };
    }

    const loyaltyPoints = customer.loyalty_points ?? 0;
    const displayName = customer.full_name ?? '';
    const maskedEmail = maskEmail(customer.email ?? email);

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        found: true,
        email_masked: maskedEmail,
        full_name: displayName,
        name: displayName,  // backward compat — prefer full_name
        loyalty_points: loyaltyPoints,
        drinks_toward_free: Math.floor((loyaltyPoints % 500) / 50),
        customer_id: customer.id,
        profile_id: customer.id,  // backward compat — prefer customer_id
        vouchers,
      }),
    };
  } catch (err) {
    console.error('[GET-STAFF-LOYALTY] Error:', err?.message);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Loyalty lookup failed' }),
    };
  }
};
