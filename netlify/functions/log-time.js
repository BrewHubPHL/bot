const { createClient } = require('@supabase/supabase-js');
const { authorize, json } = require('./_auth');

// Initialize with Service Role Key (Bypasses RLS)
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const ALLOWED_ORIGIN = process.env.SITE_URL || 'https://brewhubphl.com';

exports.handler = async (event) => {
  // 1. Handle CORS
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
      },
      body: '',
    };
  }

  // 2. Only allow POST
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method Not Allowed' })
    };
  }

  try {
    // 3. Staff auth via centralized _auth.js (includes token versioning, revocation, freshness)
    const auth = await authorize(event);
    if (!auth.ok) return auth.response;

    const user = auth.user;

    // 4. PARSE REQUEST
    const { employee_email, action_type } = JSON.parse(event.body);

    // Validate action_type against allowed values
    const VALID_ACTIONS = ['in', 'out'];
    if (!VALID_ACTIONS.includes(action_type)) {
      return {
        statusCode: 400,
        headers: { 'Access-Control-Allow-Origin': ALLOWED_ORIGIN },
        body: JSON.stringify({ error: 'action_type must be "in" or "out"' })
      };
    }

    // Security: Ensure they are clocking in for THEMSELVES
    if (user.email.toLowerCase() !== employee_email.toLowerCase()) {
       return { 
         statusCode: 403, 
         body: JSON.stringify({ error: "Identity Mismatch: You can only clock in for yourself." }) 
       };
    }

    // 6. LOG THE TIME
    const payload = {
      employee_email: employee_email.toLowerCase(),
      action_type,
      clock_in: action_type === 'in' ? new Date().toISOString() : null,
      clock_out: action_type === 'out' ? new Date().toISOString() : null,
      status: 'Pending'
    };

    const { error: insertError } = await supabase.from('time_logs').insert([payload]);

    if (insertError) throw insertError;

    // 7. UPDATE is_working STATUS
    const { error: updateError } = await supabase
      .from('staff_directory')
      .update({ is_working: action_type === 'in' })
      .ilike('email', employee_email);

    if (updateError) {
      console.error('[LOG-TIME] Failed to update is_working:', updateError);
    }

    return {
      statusCode: 200,
      headers: { 'Access-Control-Allow-Origin': ALLOWED_ORIGIN },
      body: JSON.stringify({ success: true, message: `Clocked ${action_type} successfully` })
    };

  } catch (err) {
    console.error('[LOG-TIME] Critical Error:', err);
    return {
      statusCode: 500,
      headers: { 'Access-Control-Allow-Origin': ALLOWED_ORIGIN },
      body: JSON.stringify({ error: 'System Error' })
    };
  }
};