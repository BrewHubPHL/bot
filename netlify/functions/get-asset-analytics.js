/**
 * get-asset-analytics.js
 * ──────────────────────
 * Returns equipment asset analytics for the manager dashboard:
 *   • Total Cost to Date (purchase price + sum of maintenance costs)
 *   • Health Status (overdue when current date > last_maint_date + maint_frequency_days)
 *   • Daily Operating Cost (total cost / days since install)
 *
 * Auth:   Manager PIN (HMAC cookie)
 * Method: GET
 * CSRF:   Not required (GET is idempotent)
 * RLS:    is_brewhub_manager() on underlying tables + SECURITY DEFINER RPC
 */
const { createClient } = require('@supabase/supabase-js');
const { authorize, json } = require('./_auth');
const { staffBucket } = require('./_token-bucket');
const { hashIP } = require('./_ip-hash');
const { logSystemError } = require('./_system-errors');

const supabaseUrl = process.env.SUPABASE_URL;
const supabase = createClient(supabaseUrl, process.env.SUPABASE_SERVICE_ROLE_KEY);

exports.handler = async (event) => {
  /* ── CORS boilerplate ─────────────────────────────────── */
  const ALLOWED_ORIGINS = [
    process.env.URL,
    'https://brewhubphl.com',
    'https://www.brewhubphl.com',
  ].filter(Boolean);
  const origin = event.headers?.origin || '';
  const CORS_ORIGIN = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  const corsHeaders = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': CORS_ORIGIN,
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-BrewHub-Action',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
  };
  const cors = (code, data) => ({
    statusCode: code,
    headers: corsHeaders,
    body: JSON.stringify(data),
  });

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: corsHeaders, body: '' };
  if (event.httpMethod !== 'GET') return cors(405, { error: 'Method Not Allowed' });

  /* ── Rate limiting ────────────────────────────────────── */
  const clientIP = event.headers['x-nf-client-connection-ip']
    || event.headers['x-forwarded-for']?.split(',')[0]?.trim()
    || 'unknown';
  const rlKey = `asset-analytics:${hashIP(clientIP)}`;
  const bucket = staffBucket.consume(rlKey);
  if (!bucket.allowed) {
    return cors(429, { error: 'Rate limit exceeded', retryAfterMs: bucket.retryAfterMs });
  }

  /* ── Auth (Manager only) ──────────────────────────────── */
  const auth = await authorize(event, { requireManager: true, requirePin: true });
  if (!auth.ok) return auth.response;

  /* ── Fetch analytics via Postgres RPC ─────────────────── */
  try {
    const { data, error } = await supabase.rpc('get_asset_analytics');
    if (error) {
      console.error('[ASSET-ANALYTICS] RPC error:', error.message);
      await logSystemError(supabase, {
        error_type: 'db_query_failed',
        severity: 'warning',
        source_function: 'get-asset-analytics',
        error_message: error.message,
        context: { rpc: 'get_asset_analytics' },
      });
      return cors(500, { error: 'Failed to fetch asset analytics' });
    }

    const hasOverdue = (data || []).some((a) => a.is_overdue);

    return cors(200, {
      assets: data || [],
      summary: {
        total_assets: (data || []).length,
        total_tco: (data || []).reduce((sum, a) => sum + Number(a.total_cost || 0), 0),
        overdue_count: (data || []).filter((a) => a.is_overdue).length,
        has_overdue: hasOverdue,
      },
    });
  } catch (err) {
    console.error('[ASSET-ANALYTICS] Unexpected error:', err?.message);
    return cors(500, { error: 'Internal server error' });
  }
};
