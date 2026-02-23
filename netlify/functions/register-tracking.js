// PRO WAY: Customer pre-registers their tracking number
const { createClient } = require('@supabase/supabase-js');
const { authorize, json } = require('./_auth');
const { requireCsrfHeader } = require('./_csrf');
const { sanitizeInput } = require('./_sanitize');

const supabaseUrl = process.env.SUPABASE_URL;
const supabase = createClient(supabaseUrl, process.env.SUPABASE_SERVICE_ROLE_KEY);

// Auto-detect carrier from tracking number format
function identifyCarrier(tracking) {
  if (/^1Z[A-Z0-9]{16}$/i.test(tracking)) return 'UPS';
  if (/^\d{12}$|^\d{15}$/i.test(tracking)) return 'FedEx';
  if (/^94\d{20}$/i.test(tracking)) return 'USPS';
  if (/^[A-Z]{2}\d{9}[A-Z]{2}$/i.test(tracking)) return 'DHL';
  if (/^TBA\d+$/i.test(tracking)) return 'Amazon';
  return 'Unknown';
}

exports.handler = async (event) => {
  const ALLOWED_ORIGIN = process.env.SITE_URL || 'https://brewhubphl.com';

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: { 'Access-Control-Allow-Origin': ALLOWED_ORIGIN, 'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-BrewHub-Action' }, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: { 'Access-Control-Allow-Origin': ALLOWED_ORIGIN }, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  // CSRF protection (was missing — fixes CSRF vulnerability)
  const csrfBlock = requireCsrfHeader(event);
  if (csrfBlock) return csrfBlock;

  // Require authenticated user (customer or staff)
  const auth = await authorize(event);
  if (!auth.ok) return auth.response;

  try {
    const { tracking_number, customer_name, customer_phone, customer_email, unit_number } = JSON.parse(event.body);

    if (!tracking_number || !customer_name) {
      return { 
        statusCode: 400, 
        headers: { 'Access-Control-Allow-Origin': ALLOWED_ORIGIN },
        body: JSON.stringify({ error: 'tracking_number and customer_name required' }) 
      };
    }

    // Input length validation (RT-2: cap all fields, not just tracking_number)
    const LIMITS = { tracking_number: 64, customer_name: 120, customer_phone: 20, customer_email: 254, unit_number: 20 };
    for (const [field, max] of Object.entries(LIMITS)) {
      const val = { tracking_number, customer_name, customer_phone, customer_email, unit_number }[field];
      if (val && String(val).length > max) {
        return {
          statusCode: 400,
          headers: { 'Access-Control-Allow-Origin': ALLOWED_ORIGIN },
          body: JSON.stringify({ error: `${field} too long (max ${max} chars)` })
        };
      }
    }

    // Sanitize all inputs
    const safeTrackingNumber = sanitizeInput(tracking_number.trim());
    const safeName = sanitizeInput(customer_name);
    const safePhone = sanitizeInput(customer_phone);
    const safeEmail = sanitizeInput(customer_email);
    const safeUnit = sanitizeInput(unit_number);

    const carrier = identifyCarrier(safeTrackingNumber);

    // RT-1 fix: Atomic INSERT with conflict handling on UNIQUE tracking_number.
    // Replaces TOCTOU SELECT-then-INSERT race condition.
    // Requires schema-50 UNIQUE constraint on expected_parcels.tracking_number.
    const { data, error } = await supabase
      .from('expected_parcels')
      .upsert({
        tracking_number: safeTrackingNumber,
        carrier,
        customer_name: safeName,
        customer_phone: safePhone,
        customer_email: safeEmail,
        unit_number: safeUnit,
        status: 'pending',
        registered_at: new Date().toISOString()
      }, { onConflict: 'tracking_number', ignoreDuplicates: true })
      .select()
      .single();

    // upsert with ignoreDuplicates returns null data when row already exists
    if (!data && !error) {
      return {
        statusCode: 409,
        headers: { 'Access-Control-Allow-Origin': ALLOWED_ORIGIN },
        body: JSON.stringify({ error: 'Tracking number already registered', carrier })
      };
    }

    if (error) throw error;

    console.log(`[PRE-REG] ${safeName} expecting ${carrier} package ${safeTrackingNumber}`);

    return {
      statusCode: 200,
      headers: { 'Access-Control-Allow-Origin': ALLOWED_ORIGIN },
      body: JSON.stringify({ 
        success: true, 
        message: `Package registered! We'll notify you when ${carrier} delivers it.`,
        carrier,
        tracking_number: safeTrackingNumber
      })
    };

  } catch (err) {
    console.error('[REGISTER-TRACKING ERROR]', err);
    return { 
      statusCode: 500, 
      headers: { 'Access-Control-Allow-Origin': ALLOWED_ORIGIN },
      body: JSON.stringify({ error: 'Registration failed' }) 
    };
  }
};
