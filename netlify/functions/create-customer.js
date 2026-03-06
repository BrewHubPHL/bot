const { createClient } = require('@supabase/supabase-js');
const { authorize, json } = require('./_auth');
const { requireCsrfHeader } = require('./_csrf');
const { sanitizeInput } = require('./_sanitize');
const { formBucket } = require('./_token-bucket');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// ── CORS allowlist (strict) ──────────────────────────────
const ALLOWED_ORIGINS = [
  process.env.URL,
  'https://brewhubphl.com',
  'https://www.brewhubphl.com',
].filter(Boolean);

function corsHeaders(event) {
  const origin = event.headers?.origin || '';
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-BrewHub-Action',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };
}

function respond(code, data, event) {
  return {
    statusCode: code,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(event) },
    body: JSON.stringify(data),
  };
}

exports.handler = async (event) => {
  // ── Preflight ──────────────────────────────────────────
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders(event), body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return respond(405, { error: 'Method Not Allowed' }, event);
  }

  // Per-IP rate limit
  const clientIp = event.headers['x-nf-client-connection-ip']
    || event.headers['x-forwarded-for']?.split(',')[0]?.trim()
    || 'unknown';
  const ipLimit = formBucket.consume('customer:' + clientIp);
  if (!ipLimit.allowed) {
    return respond(429, { error: 'Too many requests. Please slow down.' }, event);
  }

  // CSRF protection
  const csrfBlock = requireCsrfHeader(event);
  if (csrfBlock) return csrfBlock;

  const auth = await authorize(event, { allowCustomer: true });
  if (!auth.ok) {
    return {
      ...auth.response,
      headers: { ...auth.response.headers, ...corsHeaders(event) },
    };
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (err) {
    return respond(400, { error: 'Invalid JSON body' }, event);
  }

  // ── Input length caps + sanitization ─────────────────
  const email = (body.email || '').trim().toLowerCase().slice(0, 254);
  const fullName = sanitizeInput(body.name || body.full_name).slice(0, 100);
  const addressStreet = sanitizeInput(body.address || body.address_street).slice(0, 200);
  const phone = (sanitizeInput(body.phone) || '').slice(0, 20) || null;
  const smsOptIn = Boolean(body.sms_opt_in);

  if (!email || !fullName || !addressStreet) {
    return respond(400, { error: 'Missing required fields' }, event);
  }

  try {
    const authedEmail = (auth.user?.email || '').trim().toLowerCase();
    if (!authedEmail || authedEmail !== email) {
      return respond(403, { error: 'Email mismatch' }, event);
    }

    // Unified CRM: check for existing customer (walk-in upgrade or duplicate)
    const { data: existing, error: existingError } = await supabase
      .from('customers')
      .select('id, auth_id')
      .eq('email', email)
      .maybeSingle();

    if (existingError) {
      console.error('[CREATE-CUSTOMER] Lookup error:', existingError?.message);
      return respond(500, { error: 'Customer lookup failed' }, event);
    }

    if (existing) {
      // "Account Upgrade" — walk-in now has an auth account. Link it.
      if (!existing.auth_id) {
        const { data: linkedRow, error: linkErr } = await supabase
          .from('customers')
          .update({
            auth_id: auth.user.id,
            full_name: fullName || undefined,
            address_street: addressStreet || undefined,
            phone: phone || undefined,
            sms_opt_in: smsOptIn,
            updated_at: new Date().toISOString(),
          })
          .eq('id', existing.id)
          .is('auth_id', null)
          .select('id')
          .maybeSingle();
        if (linkErr) {
          console.error('[CREATE-CUSTOMER] Account upgrade error:', linkErr?.message);
          return respond(500, { error: 'Account upgrade failed' }, event);
        }
        // Another request may have linked the record first; treat as idempotent success.
        if (!linkedRow) {
          return respond(200, { success: true, alreadyExists: true }, event);
        }
        return respond(200, { success: true, upgraded: true }, event);
      }
      return respond(200, { success: true, alreadyExists: true }, event);
    }

    const { error } = await supabase
      .from('customers')
      .insert({
        auth_id: auth.user.id,
        email,
        full_name: fullName,
        address_street: addressStreet,
        phone,
        sms_opt_in: smsOptIn,
        loyalty_points: 0
      });

    if (error) {
      console.error('[CREATE-CUSTOMER] Insert error:', error?.message);
      return respond(500, { error: 'Customer creation failed' }, event);
    }

    return respond(200, { success: true }, event);
  } catch (err) {
    console.error('[CREATE-CUSTOMER] Error:', err?.message);
    return respond(500, { error: 'Customer creation failed' }, event);
  }
};
