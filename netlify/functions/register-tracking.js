// PRO WAY: Customer pre-registers their tracking number
const { createClient } = require('@supabase/supabase-js');
const { authorize, json } = require('./_auth');

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
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, Authorization' }, body: '' };
  }

  // Require authenticated user (customer or staff)
  const auth = await authorize(event);
  if (!auth.ok) return auth.response;

  try {
    const { tracking_number, customer_name, customer_phone, customer_email, unit_number } = JSON.parse(event.body);

    if (!tracking_number || !customer_name) {
      return { 
        statusCode: 400, 
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ error: 'tracking_number and customer_name required' }) 
      };
    }

    const carrier = identifyCarrier(tracking_number);

    // Check if already registered
    const { data: existing } = await supabase
      .from('expected_parcels')
      .select('id')
      .eq('tracking_number', tracking_number)
      .single();

    if (existing) {
      return { 
        statusCode: 409, 
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ error: 'Tracking number already registered', carrier }) 
      };
    }

    // Register the expected parcel
    const { data, error } = await supabase
      .from('expected_parcels')
      .insert([{
        tracking_number,
        carrier,
        customer_name,
        customer_phone,
        customer_email,
        unit_number,
        status: 'pending',
        registered_at: new Date().toISOString()
      }])
      .select()
      .single();

    if (error) throw error;

    console.log(`[PRE-REG] ${customer_name} expecting ${carrier} package ${tracking_number}`);

    return {
      statusCode: 200,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ 
        success: true, 
        message: `Package registered! We'll notify you when ${carrier} delivers it.`,
        carrier,
        tracking_number
      })
    };

  } catch (err) {
    console.error('[REGISTER-TRACKING ERROR]', err);
    return { 
      statusCode: 500, 
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: 'Registration failed' }) 
    };
  }
};
