/**
 * get-projected-maintenance.js
 * ────────────────────────────
 * Returns projected maintenance spend for the manager finance card:
 *   • total_projected_cost for equipment due within N months
 *   • flagged_equipment list with per-asset average recent cost
 *
 * Query param: ?months=3 (default 3, range 1–24)
 *
 * Auth:   Manager PIN (HMAC cookie)
 * Method: GET
 * CSRF:   Not required (GET is idempotent)
 * RLS:    SECURITY DEFINER RPC — manager auth enforced at this layer
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
  const rlKey = `projected-maint:${hashIP(clientIP)}`;
  const bucket = staffBucket.consume(rlKey);
  if (!bucket.allowed) {
    return cors(429, { error: 'Rate limit exceeded', retryAfterMs: bucket.retryAfterMs });
  }

  /* ── Auth (Manager only) ──────────────────────────────── */
  const auth = await authorize(event, { requireManager: true, requirePin: true });
  if (!auth.ok) return auth.response;

  /* ── Parse & validate months param ────────────────────── */
  const qs = event.queryStringParameters || {};
  const monthsRaw = parseInt(qs.months ?? '3', 10);
  const months = Number.isFinite(monthsRaw) && monthsRaw >= 1 && monthsRaw <= 24
    ? monthsRaw
    : 3;

  /* ── Fetch projection via Postgres RPC ────────────────── */
  try {
    const { data, error } = await supabase.rpc('calculate_projected_asset_spend', {
      months_ahead: months,
    });

    if (error) {
      console.error('[PROJECTED-MAINT] RPC error:', error.message);
      await logSystemError(supabase, {
        error_type: 'db_query_failed',
        severity: 'warning',
        source_function: 'get-projected-maintenance',
        error_message: error.message,
        context: { rpc: 'calculate_projected_asset_spend', months },
      });
      return cors(500, { error: 'Failed to fetch projected maintenance spend' });
    }

    return cors(200, {
      months,
      total_projected_cost: data?.total_projected_cost ?? 0,
      flagged_equipment: data?.flagged_equipment ?? [],
      flagged_count: (data?.flagged_equipment ?? []).length,
    });
  } catch (err) {
    console.error('[PROJECTED-MAINT] Unexpected error:', err?.message);
    return cors(500, { error: 'Internal server error' });
  }
};
