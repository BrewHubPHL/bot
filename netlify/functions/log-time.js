const { createClient } = require('@supabase/supabase-js');
const { authorize, json } = require('./_auth');
const { requireCsrfHeader } = require('./_csrf');

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
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-BrewHub-Action',
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

  // CSRF protection
  const csrfBlock = requireCsrfHeader(event);
  if (csrfBlock) return csrfBlock;

  try {
    // 3. Staff auth via centralized _auth.js (includes token versioning, revocation, freshness)
    const auth = await authorize(event, { requirePin: true });
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

    // ─── PAYROLL SANITY GUARDS ─────────────────────────────
    const now = new Date();

    if (action_type === 'out') {
      // Guard 1: Reject clock-out when there is no open clock-in
      const { data: openShift, error: shiftErr } = await supabase
        .from('time_logs')
        .select('id, clock_in, created_at')
        .eq('employee_email', employee_email.toLowerCase())
        .eq('action_type', 'in')
        .is('clock_out', null)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (shiftErr) {
        console.error('[LOG-TIME] Shift lookup failed:', shiftErr);
        return {
          statusCode: 500,
          headers: { 'Access-Control-Allow-Origin': ALLOWED_ORIGIN },
          body: JSON.stringify({ error: 'Failed to verify open shift' })
        };
      }

      if (!openShift) {
        return {
          statusCode: 409,
          headers: { 'Access-Control-Allow-Origin': ALLOWED_ORIGIN },
          body: JSON.stringify({ error: 'No active shift found. You must clock in before clocking out.' })
        };
      }

      // Guard 2: Flag abnormally long shifts (>16 h) for manager review
      const shiftStart = new Date(openShift.clock_in || openShift.created_at);
      const shiftHours = (now - shiftStart) / 3600000;
      const MAX_AUTO_HOURS = 16;

      if (shiftHours > MAX_AUTO_HOURS) {
        console.warn(`[LOG-TIME] Shift for ${employee_email} is ${shiftHours.toFixed(1)}h — flagging for review.`);

        // Update the existing shift row — flag for manager review
        const { error: flagErr } = await supabase.from('time_logs')
          .update({
            action_type: 'out',
            clock_out: now.toISOString(),
            status: 'Pending',
            needs_manager_review: true
          })
          .eq('id', openShift.id);
        if (flagErr) throw flagErr;

        // Still update is_working
        await supabase
          .from('staff_directory')
          .update({ is_working: false })
          .ilike('email', employee_email);

        return {
          statusCode: 200,
          headers: { 'Access-Control-Allow-Origin': ALLOWED_ORIGIN },
          body: JSON.stringify({
            success: true,
            warning: `Shift exceeds ${MAX_AUTO_HOURS} hours (${shiftHours.toFixed(1)}h). Entry flagged for manager review.`
          })
        };
      }
    }

    // 6. LOG THE TIME
    if (action_type === 'out' && openShift) {
      // Clock-out: UPDATE the existing open shift row (not INSERT)
      const { error: updateErr } = await supabase.from('time_logs')
        .update({
          action_type: 'out',
          clock_out: now.toISOString(),
          status: 'Pending'
        })
        .eq('id', openShift.id);

      if (updateErr) throw updateErr;
    } else {
      // Clock-in: INSERT a new shift row
      const payload = {
        employee_email: employee_email.toLowerCase(),
        action_type,
        clock_in: now.toISOString(),
        clock_out: null,
        status: 'Pending'
      };

      const { error: insertError } = await supabase.from('time_logs').insert([payload]);

      if (insertError) throw insertError;
    }

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