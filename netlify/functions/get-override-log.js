const { authorize, json } = require('./_auth');
const { staffBucket } = require('./_token-bucket');
const { hashIP } = require('./_ip-hash');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const MISSING_ENV = !process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY;

/**
 * GET-OVERRIDE-LOG
 * Returns the most recent manager override log entries.
 * Manager-only endpoint — used by the ManagerOverrideLog data table.
 *
 * Query params:
 *   limit  – number of rows (default 100, max 500)
 *   offset – pagination offset (default 0)
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

  // ── Rate limit ──
  const ip = event.headers['x-nf-client-connection-ip']
    || event.headers['x-forwarded-for']?.split(',')[0]?.trim()
    || 'unknown';
  try {
    const rlKey = `override-log:${hashIP(ip)}`;
    const take = staffBucket.consume(rlKey);
    if (!take.allowed) {
      return {
        statusCode: 429,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Too many requests', retryAfterMs: take.retryAfterMs }),
      };
    }
  } catch (rlErr) {
    console.error('[GET-OVERRIDE-LOG] Rate limit check failed (continuing):', rlErr?.message || 'unknown');
  }

  // ── Auth — manager only ──
  const auth = await authorize(event, { requireManager: true, requirePin: true });
  if (!auth.ok) {
    return { ...auth.response, headers: { ...auth.response.headers, ...corsHeaders } };
  }

  try {
    const params = event.queryStringParameters || {};
    const limit = Math.min(Math.max(parseInt(params.limit, 10) || 100, 1), 500);
    const offset = Math.max(parseInt(params.offset, 10) || 0, 0);

    const { data, error } = await supabase
      .from('manager_override_log')
      .select('id, action_type, manager_email, target_entity, target_id, target_employee, details, challenge_method, ip_address, created_at')
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      console.error('[GET-OVERRIDE-LOG] DB error:', error.message);
      return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ error: 'Failed to fetch override log' }) };
    }

    // Redact full IP addresses — only expose first 12 chars for security
    const rows = (data || []).map(row => ({
      ...row,
      ip_address: row.ip_address ? row.ip_address.slice(0, 12) + '…' : null,
    }));

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({ rows, limit, offset }),
    };
  } catch (err) {
    console.error('[GET-OVERRIDE-LOG] Critical error:', err?.message || 'unknown');
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ error: 'System error' }) };
  }
};
