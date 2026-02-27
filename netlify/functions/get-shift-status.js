const { createClient } = require('@supabase/supabase-js');
const { authorize } = require('./_auth');
const { requireCsrfHeader } = require('./_csrf');
const { staffBucket } = require('./_token-bucket');
const { hashIP } = require('./_ip-hash');

// Service-role client — bypasses RLS
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const MISSING_ENV = !process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY;

/**
 * GET-SHIFT-STATUS
 * Returns the current shift status for the authenticated staff member.
 * Called by StaffContext on mount + every 30s for global sync.
 *
 * Response: { isClockedIn: boolean, shiftId: string|null, clockIn: string|null }
 */
exports.handler = async (event) => {
  const ALLOWED_ORIGIN = process.env.SITE_URL || 'https://brewhubphl.com';
  const corsHeaders = {
    'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-BrewHub-Action',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: '' };
  }

  if (MISSING_ENV) {
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ error: 'Server misconfiguration' }) };
  }

  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, headers: corsHeaders, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  // CSRF protection for mutation-only — GET is read-only, but we still
  // validate the auth token. Skip CSRF for GET requests.

  // Rate limit
  const ip = event.headers['x-nf-client-connection-ip']
    || event.headers['x-forwarded-for']?.split(',')[0]?.trim()
    || 'unknown';
  try {
    const rlKey = `shift-status:${hashIP(ip)}`;
    const take = staffBucket.consume(rlKey);
    if (!take.allowed) {
      return {
        statusCode: 429,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Too many requests', retryAfterMs: take.retryAfterMs }),
      };
    }
  } catch (rlErr) {
    console.error('[GET-SHIFT-STATUS] Rate limit check failed (continuing):', rlErr?.message || 'unknown');
  }

  // Authenticate
  const auth = await authorize(event, { requirePin: true });
  if (!auth.ok) {
    return { ...auth.response, headers: { ...auth.response.headers, ...corsHeaders } };
  }

  try {
    const staffEmail = auth.user.email?.toLowerCase();
    if (!staffEmail) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Staff email not available' }),
      };
    }

    // Query for an open shift (clock_out IS NULL, action_type = 'in')
    const { data, error } = await supabase
      .from('time_logs')
      .select('id, clock_in')
      .eq('employee_email', staffEmail)
      .is('clock_out', null)
      .eq('action_type', 'in')
      .order('clock_in', { ascending: false })
      .limit(1);

    if (error) {
      console.error('[GET-SHIFT-STATUS] DB error:', error.message);
      return {
        statusCode: 500,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Failed to fetch shift status' }),
      };
    }

    const activeShift = data && data.length > 0 ? data[0] : null;

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        isClockedIn: !!activeShift,
        shiftId: activeShift?.id ?? null,
        clockIn: activeShift?.clock_in ?? null,
      }),
    };
  } catch (err) {
    console.error('[GET-SHIFT-STATUS] Critical error:', err?.message || 'unknown');
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'System error' }),
    };
  }
};
