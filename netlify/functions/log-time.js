const { createClient } = require('@supabase/supabase-js');
const { authorize, json } = require('./_auth');

const supabaseUrl = process.env.SUPABASE_URL;
const supabase = createClient(supabaseUrl, process.env.SUPABASE_SERVICE_ROLE_KEY);

exports.handler = async (event) => {
  // 1. Secure Auth (Staff Only)
  const auth = await authorize(event);
  if (!auth.ok) return auth.response;

  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Method Not Allowed' });
  }

  try {
    const { employee_email, action_type } = JSON.parse(event.body);

    if (!employee_email || !action_type) {
      return json(400, { error: 'Missing email or action' });
    }

    console.log(`[PAYROLL] Logging ${action_type} for ${employee_email}`);

    // Validate that the auth user matches the email being clocked?
    // auth.user.email vs employee_email. 
    // Strict mode: Only allow users to clock THEMSELVES in/out.
    if (auth.via === 'jwt' && auth.user.email !== employee_email) {
       console.warn(`[AUTH MISMATCH] Token: ${auth.user.email} -> Claiming: ${employee_email}`);
       return json(403, { error: "You can only clock in for yourself." });
    }

    const payload = {
      employee_email,
      action_type,
      clock_in: action_type === 'in' ? new Date().toISOString() : null,
      clock_out: action_type === 'out' ? new Date().toISOString() : null
    };

    const { error } = await supabase.from('time_logs').insert([payload]);

    if (error) throw error;

    return json(200, { success: true });

  } catch (err) {
    console.error('Time Log Error:', err);
    return json(500, { error: 'Logging failed' });
  }
};
