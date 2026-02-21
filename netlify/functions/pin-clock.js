const { createClient } = require('@supabase/supabase-js');
const { authorize, json } = require('./_auth');
const { requireCsrfHeader } = require('./_csrf');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const VALID_ACTIONS = ['in', 'out'];

exports.handler = async (event) => {
  const ALLOWED_ORIGIN = process.env.SITE_URL || 'https://brewhubphl.com';
  const corsHeaders = {
    'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-BrewHub-Action',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: corsHeaders, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  // CSRF protection
  const csrfBlock = requireCsrfHeader(event);
  if (csrfBlock) return { ...csrfBlock, headers: { ...csrfBlock.headers, ...corsHeaders } };

  // Authenticate using centralized authorize() — requires PIN token
  const auth = await authorize(event, { requirePin: true });
  if (!auth.ok) {
    return { ...auth.response, headers: { ...auth.response.headers, ...corsHeaders } };
  }

  try {
    const { action } = JSON.parse(event.body || '{}');

    if (!action || !VALID_ACTIONS.includes(action)) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: `Invalid action. Must be one of: ${VALID_ACTIONS.join(', ')}` })
      };
    }

    const staffEmail = auth.user.email;
    const now = new Date().toISOString();

    if (action === 'in') {
      // Check if already clocked in
      const { data: openLog } = await supabase
        .from('time_logs')
        .select('id')
        .eq('employee_email', staffEmail)
        .eq('status', 'active')
        .is('clock_out', null)
        .limit(1);

      if (openLog && openLog.length > 0) {
        return {
          statusCode: 409,
          headers: corsHeaders,
          body: JSON.stringify({ error: 'Already clocked in. Clock out first.' })
        };
      }

      // Insert clock-in record
      const { error: insertErr } = await supabase
        .from('time_logs')
        .insert({
          employee_email: staffEmail,
          action_type: 'in',
          clock_in: now,
          status: 'active',
        });

      if (insertErr) {
        console.error('[PIN-CLOCK] Insert error:', insertErr);
        return {
          statusCode: 500,
          headers: corsHeaders,
          body: JSON.stringify({ error: 'Failed to clock in' })
        };
      }

      // Update is_working flag
      await supabase
        .from('staff_directory')
        .update({ is_working: true })
        .eq('email', staffEmail);

      console.log(`[PIN-CLOCK] ${staffEmail} clocked IN`);
      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({ success: true, action: 'in', time: now })
      };
    }

    if (action === 'out') {
      // Find the active clock-in entry
      const { data: activeLog, error: findErr } = await supabase
        .from('time_logs')
        .select('id, clock_in')
        .eq('employee_email', staffEmail)
        .eq('status', 'active')
        .is('clock_out', null)
        .order('clock_in', { ascending: false })
        .limit(1);

      if (findErr) {
        console.error('[PIN-CLOCK] Find error:', findErr);
        return {
          statusCode: 500,
          headers: corsHeaders,
          body: JSON.stringify({ error: 'Failed to find active shift' })
        };
      }

      if (!activeLog || activeLog.length === 0) {
        return {
          statusCode: 409,
          headers: corsHeaders,
          body: JSON.stringify({ error: 'Not currently clocked in.' })
        };
      }

      // Update with clock_out time
      const { error: updateErr } = await supabase
        .from('time_logs')
        .update({ clock_out: now, status: 'completed', action_type: 'out' })
        .eq('id', activeLog[0].id);

      if (updateErr) {
        console.error('[PIN-CLOCK] Update error:', updateErr);
        return {
          statusCode: 500,
          headers: corsHeaders,
          body: JSON.stringify({ error: 'Failed to clock out' })
        };
      }

      // Update is_working flag
      await supabase
        .from('staff_directory')
        .update({ is_working: false })
        .eq('email', staffEmail);

      console.log(`[PIN-CLOCK] ${staffEmail} clocked OUT`);
      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({ success: true, action: 'out', time: now })
      };
    }
  } catch (err) {
    console.error('[PIN-CLOCK] Error:', err);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Clock operation failed' })
    };
  }
};
