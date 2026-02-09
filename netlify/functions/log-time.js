const { createClient } = require('@supabase/supabase-js');

// Initialize with Service Role Key (Bypasses RLS)
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

exports.handler = async (event) => {
  // 1. Handle CORS (Allow browser access)
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
      body: JSON.stringify({ error: 'Method Not Allowed' })
    };
  }

  try {
    // 3. MANUAL AUTH CHECK (Replaces the broken authorize function)
    const token = event.headers.authorization?.split(' ')[1];
    if (!token) {
      return { statusCode: 401, body: JSON.stringify({ error: 'No token provided' }) };
    }

    // Verify the user exists using Supabase Auth
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    
    if (authError || !user) {
      console.warn("Auth Token Invalid:", authError);
      return { statusCode: 401, body: JSON.stringify({ error: 'Invalid Token' }) };
    }

    // 4. CHECK STAFF DIRECTORY (Using Master Key - Cannot be blocked)
    const { data: staffMember } = await supabase
      .from('staff_directory')
      .select('*')
      .eq('email', user.email.toLowerCase()) // Force lowercase match
      .maybeSingle();

    if (!staffMember) {
      console.error(`[AUTH] User ${user.email} not found in staff_directory`);
      return { statusCode: 403, body: JSON.stringify({ error: 'Access denied: Not in staff directory.' }) };
    }

    // 5. PARSE REQUEST
    const { employee_email, action_type } = JSON.parse(event.body);

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

    return {
      statusCode: 200,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ success: true, message: `Clocked ${action_type} successfully` })
    };

  } catch (err) {
    console.error('[LOG-TIME] Critical Error:', err);
    return {
      statusCode: 500,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: 'System Error', details: err.message })
    };
  }
};