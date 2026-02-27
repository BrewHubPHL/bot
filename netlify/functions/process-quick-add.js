/**
 * process-quick-add.js — UPSERT a ghost/quick-add resident into the residents table.
 *
 * Called from the POS Parcel Scanner when a "Ghost Resident" is quick-added.
 * Uses UPSERT (ON CONFLICT phone DO UPDATE unit_number) to prevent duplicate
 * resident records when the same phone number is scanned on multiple packages.
 *
 * Auth: Staff PIN session (requirePin: true)
 * Method: POST
 */
const { createClient } = require('@supabase/supabase-js');
const { authorize, json } = require('./_auth');
const { requireCsrfHeader } = require('./_csrf');
const { sanitizeInput } = require('./_sanitize');
const { staffBucket } = require('./_token-bucket');
const { hashIP } = require('./_ip-hash');

const supabaseUrl = process.env.SUPABASE_URL;
const supabase = createClient(supabaseUrl, process.env.SUPABASE_SERVICE_ROLE_KEY);

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
  const corsOrigin = getCorsOrigin(event);
  const corsHeaders = {
    'Access-Control-Allow-Origin': corsOrigin,
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-BrewHub-Action',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };

  // CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: corsHeaders, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  // CSRF guard
  const csrfErr = requireCsrfHeader(event);
  if (csrfErr) return csrfErr;

  // Rate limit
  const clientIp = hashIP(event);
  if (!staffBucket.consume(clientIp)) {
    return { statusCode: 429, headers: corsHeaders, body: JSON.stringify({ error: 'Too many requests' }) };
  }

  // Staff auth (POS-only endpoint)
  const auth = await authorize(event, { requirePin: true });
  if (!auth.ok) {
    return { statusCode: auth.response.statusCode, headers: corsHeaders, body: auth.response.body };
  }

  try {
    let body;
    try {
      body = JSON.parse(event.body || '{}');
    } catch {
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'Invalid JSON body' }) };
    }

    const name = sanitizeInput((body.name || '').trim().slice(0, 100));
    const phone = sanitizeInput((body.phone || '').replace(/\D/g, '').slice(0, 15));
    const unit_number = sanitizeInput((body.unit_number || '').trim().slice(0, 20));

    if (!name) {
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'name is required' }) };
    }
    if (!phone) {
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'phone is required for upsert identity' }) };
    }

    // ══════════════════════════════════════════════════════════════
    // IDENTITY HIJACK GUARD: Prevent cross-unit phone reassignment
    // If this phone already belongs to a resident in a DIFFERENT unit,
    // block the upsert to prevent identity overwrite attacks.
    // ══════════════════════════════════════════════════════════════
    const { data: existing, error: lookupErr } = await supabase
      .from('residents')
      .select('id, name, unit_number, email, phone')
      .eq('phone', phone)
      .limit(1)
      .maybeSingle();

    if (lookupErr) {
      console.error('[QUICK-ADD] Phone lookup error:', lookupErr.message);
      return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ error: 'Phone lookup failed' }) };
    }

    if (existing && existing.unit_number && unit_number && existing.unit_number !== unit_number) {
      // Phone belongs to a different unit — check if they are a registered user
      const isRegistered = !!(existing.email);

      if (isRegistered) {
        // Hard block: registered residents cannot be silently reassigned
        console.warn(`[QUICK-ADD] BLOCKED cross-unit move for registered resident id=${existing.id} phone=***${phone.slice(-4)} from unit=${existing.unit_number} to unit=${unit_number}`);
        return {
          statusCode: 409,
          headers: corsHeaders,
          body: JSON.stringify({
            error: 'Phone number already registered to another unit. Manager authorization required.',
            code: 'CROSS_UNIT_REGISTERED',
            existing_unit: existing.unit_number,
          }),
        };
      }

      // Unregistered ghost resident — allow move ONLY if caller is a manager
      const isManager = auth.role === 'manager' || auth.role === 'admin';
      if (!isManager) {
        console.warn(`[QUICK-ADD] BLOCKED cross-unit ghost move by non-manager: id=${existing.id} phone=***${phone.slice(-4)} from unit=${existing.unit_number} to unit=${unit_number}`);
        return {
          statusCode: 409,
          headers: corsHeaders,
          body: JSON.stringify({
            error: 'This phone number is already assigned to a different unit. A manager must approve the reassignment.',
            code: 'CROSS_UNIT_GHOST',
            existing_unit: existing.unit_number,
          }),
        };
      }

      // Manager approved — log the override and allow the upsert to proceed
      console.warn(`[QUICK-ADD] MANAGER OVERRIDE: Reassigning ghost id=${existing.id} phone=***${phone.slice(-4)} from unit=${existing.unit_number} to unit=${unit_number} by ${auth.user?.email || 'unknown'}`);
    }

    // ── UPSERT: ON CONFLICT (phone) DO UPDATE SET unit_number ──
    // If a resident with this phone already exists, just update their unit.
    // This prevents duplicate rows when the same ghost is quick-added repeatedly.
    const { data, error } = await supabase
      .from('residents')
      .upsert(
        { name, phone, unit_number },
        { onConflict: 'phone', ignoreDuplicates: false }
      )
      .select('id, name, phone, unit_number')
      .single();

    if (error) {
      console.error('[QUICK-ADD] Upsert error:', error.message);
      return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ error: 'Failed to upsert resident' }) };
    }

    console.log(`[QUICK-ADD] Upserted resident id=${data.id} phone=***${phone.slice(-4)} unit=${unit_number}`);

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        success: true,
        resident_id: data.id,
        name: data.name,
        unit_number: data.unit_number,
        message: `Resident "${data.name}" saved (Unit ${data.unit_number || 'N/A'}).`,
      }),
    };
  } catch (err) {
    console.error('[QUICK-ADD] Unexpected error:', err?.message);
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ error: 'Quick-add failed' }) };
  }
};
