// PHILLY WAY: Upsert a walk-in customer for parcel check-in
// Creates a row in the unified customers table (auth_id = NULL) so
// parcels can be linked to a real customer id and the walk-in
// shows up in future searches.  If the phone already exists
// we update the full_name/unit instead of creating a duplicate.
const { createClient } = require('@supabase/supabase-js');
const { authorize, json } = require('./_auth');
const { requireCsrfHeader } = require('./_csrf');
const { sanitizeInput } = require('./_sanitize');
const { staffBucket } = require('./_token-bucket');
const { hashIP } = require('./_ip-hash');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
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
  const corsOrigin = getCorsOrigin(event);
  const corsHeaders = {
    'Access-Control-Allow-Origin': corsOrigin,
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-BrewHub-Action',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: '' };
  }

  // Staff auth
  const auth = await authorize(event, { requirePin: true });
  if (!auth.ok) return auth.response;

  // CSRF
  const csrfBlock = requireCsrfHeader(event);
  if (csrfBlock) return csrfBlock;

  // Rate limit
  const ip = hashIP(event);
  if (!staffBucket.consume(ip)) {
    return { statusCode: 429, headers: corsHeaders, body: JSON.stringify({ error: 'Too many requests' }) };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: corsHeaders, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const body = JSON.parse(event.body || '{}');

    const full_name = sanitizeInput((body.name || body.full_name || '').trim().slice(0, 120));
    const phone = body.phone
      ? sanitizeInput(String(body.phone).replace(/\D/g, '').slice(0, 15))
      : null;
    const unit_number = body.unit_number
      ? sanitizeInput(String(body.unit_number).trim().slice(0, 10))
      : null;

    if (!full_name) {
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'name is required' }) };
    }

    let customer;

    if (phone) {
      // Check if this phone already belongs to an existing customer
      const { data: existing, error: lookupErr } = await supabase
        .from('customers')
        .select('id, auth_id, full_name, unit_number, phone, email')
        .eq('phone', phone)
        .maybeSingle();
      if (lookupErr) throw lookupErr;

      if (existing) {
        // Row exists — safe-merge: never wipe auth_id, only update
        // name if it's a placeholder, always fill in missing unit_number
        const updates = {};
        if (unit_number && !existing.unit_number) updates.unit_number = unit_number;
        if (!existing.auth_id) {
          // Walk-in → safe to overwrite name
          updates.full_name = full_name;
          if (unit_number) updates.unit_number = unit_number;
        } else {
          // App User → only update name if blank/placeholder
          if (!existing.full_name || existing.full_name === 'Guest') {
            updates.full_name = full_name;
          }
        }

        if (Object.keys(updates).length > 0) {
          updates.updated_at = new Date().toISOString();
          const { data, error } = await supabase
            .from('customers')
            .update(updates)
            .eq('id', existing.id)
            .select('id, full_name, unit_number, phone, email')
            .single();
          if (error) throw error;
          customer = data;
        } else {
          customer = existing;
        }
      } else {
        // No existing row — insert a new walk-in (auth_id stays NULL)
        const { data, error } = await supabase
          .from('customers')
          .insert({ full_name, phone, unit_number })
          .select('id, full_name, unit_number, phone, email')
          .single();
        if (error) throw error;
        customer = data;
      }
    } else {
      // No phone — plain insert (can't dedupe without phone)
      const { data, error } = await supabase
        .from('customers')
        .insert({ full_name, unit_number })
        .select('id, full_name, unit_number, phone, email')
        .single();
      if (error) throw error;
      customer = data;
    }

    console.log(`[GUEST] Upserted walk-in customer id=${customer.id} name_len=${full_name.length}`);

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        success: true,
        resident: {
          id: customer.id,
          name: customer.full_name,
          full_name: customer.full_name,
          unit_number: customer.unit_number,
          phone: customer.phone,
          email: customer.email,
        },
      }),
    };
  } catch (err) {
    console.error('[UPSERT-GUEST ERROR]', err?.message);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Failed to save guest' }),
    };
  }
};
