const { createClient } = require('@supabase/supabase-js');
const { authorize } = require('./_auth');
const { requireCsrfHeader } = require('./_csrf');
const { staffBucket } = require('./_token-bucket');
const { hashIP } = require('./_ip-hash');

function withSourceComment(query, tag) {
  if (typeof query?.comment === 'function') {
    return query.comment(`source: ${tag}`);
  }
  return query;
}

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

    // Schema 79: use v_staff_status as the single source of truth for is_working
    const { data: staffRow, error: viewError } = await withSourceComment(
      supabase
        .from('v_staff_status')
        .select('is_working')
        .eq('email', staffEmail)
        .single(),
      'polling-staff-shift-status'
    );

    if (viewError) {
      console.error('[GET-SHIFT-STATUS] DB error:', viewError.message);
      return {
        statusCode: 500,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Failed to fetch shift status' }),
      };
    }

    const isClockedIn = staffRow?.is_working ?? false;
    let shiftId = null;
    let clockIn = null;

    // If clocked in, fetch active shift details for the response contract
    if (isClockedIn) {
      const { data: shiftData } = await withSourceComment(
        supabase
          .from('time_logs')
          .select('id, clock_in')
          .eq('employee_email', staffEmail)
          .is('clock_out', null)
          .eq('action_type', 'in')
          .order('clock_in', { ascending: false })
          .limit(1),
        'polling-staff-shift-detail'
      );
      if (shiftData?.[0]) {
        shiftId = shiftData[0].id;
        clockIn = shiftData[0].clock_in;
      }
    }

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        isClockedIn,
        shiftId,
        clockIn,
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
