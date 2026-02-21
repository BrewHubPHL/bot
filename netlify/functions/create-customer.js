const { createClient } = require('@supabase/supabase-js');
const { json } = require('./_auth');
const { requireCsrfHeader } = require('./_csrf');
const { sanitizeInput } = require('./_sanitize');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

exports.handler = async (event) => {
  const ALLOWED_ORIGIN = process.env.SITE_URL || 'https://brewhubphl.com';
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: { 'Access-Control-Allow-Origin': ALLOWED_ORIGIN, 'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-BrewHub-Action' },
      body: ''
    };
  }

  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Method Not Allowed' });
  }

  // CSRF protection
  const csrfBlock = requireCsrfHeader(event);
  if (csrfBlock) return csrfBlock;

  const authHeader = event.headers?.authorization || event.headers?.Authorization;
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    return json(401, { error: 'Unauthorized' });
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (err) {
    return json(400, { error: 'Invalid JSON body' });
  }

  const email = (body.email || '').trim().toLowerCase();
  const fullName = sanitizeInput(body.name || body.full_name);
  const addressStreet = sanitizeInput(body.address || body.address_street);
  const phone = sanitizeInput(body.phone) || null;
  const smsOptIn = Boolean(body.sms_opt_in);

  if (!email || !fullName || !addressStreet) {
    return json(400, { error: 'Missing required fields' });
  }

  try {
    const { data: authData, error: authError } = await supabase.auth.getUser(token);
    if (authError || !authData?.user) {
      return json(401, { error: 'Unauthorized' });
    }

    const authedEmail = (authData.user.email || '').trim().toLowerCase();
    if (!authedEmail || authedEmail !== email) {
      return json(403, { error: 'Email mismatch' });
    }

    const { data: existing, error: existingError } = await supabase
      .from('customers')
      .select('id')
      .eq('email', email)
      .single();

    if (existingError && existingError.code !== 'PGRST116') {
      console.error('[CREATE-CUSTOMER] Lookup error:', existingError);
      return json(500, { error: 'Customer lookup failed' });
    }

    if (existing) {
      return json(200, { success: true, alreadyExists: true });
    }

    const { error } = await supabase
      .from('customers')
      .insert({
        email,
        full_name: fullName,
        address_street: addressStreet,
        phone,
        sms_opt_in: smsOptIn,
        loyalty_points: 0
      });

    if (error) {
      console.error('[CREATE-CUSTOMER] Insert error:', error);
      return json(500, { error: 'Customer creation failed' });
    }

    return json(200, { success: true });
  } catch (err) {
    console.error('[CREATE-CUSTOMER] Error:', err);
    return json(500, { error: 'Customer creation failed' });
  }
};
