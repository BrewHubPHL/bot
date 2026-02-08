const { createClient } = require('@supabase/supabase-js');
const { authorize, json } = require('./_auth');

const supabaseUrl = process.env.SUPABASE_URL;
const supabase = createClient(supabaseUrl, process.env.SUPABASE_SERVICE_ROLE_KEY);

exports.handler = async (event) => {
  // 1. Handle CORS Preflight
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
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
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: 'Method Not Allowed' })
    };
  }

  // 3. Secure Auth (Staff Only)
  const auth = await authorize(event);
  if (!auth.ok) {
    // Add CORS headers to error response
    const response = auth.response;
    response.headers = { ...response.headers, 'Access-Control-Allow-Origin': '*' };
    console.error('[LOG-TIME] Auth failed:', JSON.parse(response.body));
    return response;
  }

  try {
    const { employee_email, action_type } = JSON.parse(event.body);

    if (!employee_email || !action_type) {
      return json(400, { error: 'Missing email or action' });
    }

    // Strict mode: Only allow users to clock THEMSELVES in/out.
    if (auth.via === 'jwt' && auth.user.email.toLowerCase() !== employee_email.toLowerCase()) {
       console.warn(`[AUTH MISMATCH] Token: ${auth.user.email} -> Claiming: ${employee_email}`);
       return json(403, { error: "You can only clock in for yourself." });
    }

    // Use correct columns for time_logs table
    const payload = {
      employee_email,
      action_type,
      clock_in: action_type === 'in' ? new Date().toISOString() : null,
      clock_out: action_type === 'out' ? new Date().toISOString() : null,
      status: 'Pending'
    };

    const { error } = await supabase.from('time_logs').insert([payload]);

    if (error) {
      console.error('[LOG-TIME] DB Error:', error);
      return json(500, { error: 'Logging failed', details: error.message || error });
    }

    return json(200, { success: true, message: `Clocked ${action_type} successfully` });

  } catch (err) {
    console.error('[LOG-TIME] Error:', err);
    return json(500, { error: 'Logging failed', details: err.message || err });
  }
};