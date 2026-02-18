const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const VALID_ACTIONS = ['in', 'out'];

/**
 * Verify the HMAC ops-session token created by pin-login.js
 */
function verifyToken(token) {
  if (!token) return null;

  try {
    const [payloadB64, signature] = token.split('.');
    if (!payloadB64 || !signature) return null;

    const payloadStr = Buffer.from(payloadB64, 'base64').toString('utf-8');
    const secret = process.env.INTERNAL_SYNC_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;
    const expected = crypto.createHmac('sha256', secret).update(payloadStr).digest('hex');

    // Constant-time comparison for signature
    const sigBuf = Buffer.from(signature, 'hex');
    const expBuf = Buffer.from(expected, 'hex');
    if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
      return null;
    }

    const payload = JSON.parse(payloadStr);
    if (!payload.exp || Date.now() > payload.exp) return null; // expired

    return payload;
  } catch {
    return null;
  }
}

const json = (statusCode, data) => ({
  statusCode,
  headers: {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': process.env.SITE_URL || 'https://brewhubphl.com',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  },
  body: JSON.stringify(data),
});

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return json(200, {});
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method Not Allowed' });

  try {
    // Auth: require ops token from pin-login
    const authHeader = event.headers.authorization || '';
    const token = authHeader.replace(/^Bearer\s+/i, '');
    const session = verifyToken(token);

    if (!session) {
      return json(401, { error: 'Unauthorized — PIN session expired or invalid' });
    }

    const { action } = JSON.parse(event.body || '{}');

    if (!action || !VALID_ACTIONS.includes(action)) {
      return json(400, { error: `Invalid action. Must be one of: ${VALID_ACTIONS.join(', ')}` });
    }

    const staffEmail = session.email;
    const staffId = session.staffId;

    if (!staffEmail) {
      return json(400, { error: 'Invalid session — missing email' });
    }

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
        return json(409, { error: 'Already clocked in. Clock out first.' });
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
        return json(500, { error: 'Failed to clock in' });
      }

      // Update is_working flag
      await supabase
        .from('staff_directory')
        .update({ is_working: true })
        .eq('email', staffEmail);

      console.log(`[PIN-CLOCK] ${staffEmail} clocked IN`);
      return json(200, { success: true, action: 'in', time: now });
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
        return json(500, { error: 'Failed to find active shift' });
      }

      if (!activeLog || activeLog.length === 0) {
        return json(409, { error: 'Not currently clocked in.' });
      }

      // Update with clock_out time
      const { error: updateErr } = await supabase
        .from('time_logs')
        .update({ clock_out: now, status: 'completed', action_type: 'out' })
        .eq('id', activeLog[0].id);

      if (updateErr) {
        console.error('[PIN-CLOCK] Update error:', updateErr);
        return json(500, { error: 'Failed to clock out' });
      }

      // Update is_working flag
      await supabase
        .from('staff_directory')
        .update({ is_working: false })
        .eq('email', staffEmail);

      console.log(`[PIN-CLOCK] ${staffEmail} clocked OUT`);
      return json(200, { success: true, action: 'out', time: now });
    }
  } catch (err) {
    console.error('[PIN-CLOCK] Error:', err);
    return json(500, { error: 'Clock operation failed' });
  }
};
