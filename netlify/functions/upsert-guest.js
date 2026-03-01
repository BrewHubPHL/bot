// PHILLY WAY: Upsert a guest resident for parcel check-in
// Creates a row in the residents table (is_guest = true) so
// parcels can be linked to a real resident_id and the guest
// shows up in future searches.  If the phone already exists
// we update the name/unit instead of creating a duplicate.
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

    const name = sanitizeInput((body.name || '').trim().slice(0, 120));
    const phone = body.phone
      ? sanitizeInput(String(body.phone).replace(/\D/g, '').slice(0, 15))
      : null;
    const unit_number = body.unit_number
      ? sanitizeInput(String(body.unit_number).trim().slice(0, 10))
      : null;

    if (!name) {
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'name is required' }) };
    }

    let resident;

    if (phone) {
      // Upsert by phone (unique constraint from schema-73)
      const { data, error } = await supabase
        .from('residents')
        .upsert(
          { name, phone, unit_number, is_guest: true },
          { onConflict: 'phone' },
        )
        .select('id, name, unit_number, phone, email, is_guest')
        .single();
      if (error) throw error;
      resident = data;
    } else {
      // No phone — plain insert (can't dedupe without phone)
      const { data, error } = await supabase
        .from('residents')
        .insert({ name, unit_number, is_guest: true })
        .select('id, name, unit_number, phone, email, is_guest')
        .single();
      if (error) throw error;
      resident = data;
    }

    console.log(`[GUEST] Upserted guest resident id=${resident.id} name_len=${name.length}`);

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({ success: true, resident }),
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
