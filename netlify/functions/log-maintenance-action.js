/**
 * log-maintenance-action.js
 * ─────────────────────────
 * Logs a completed maintenance task against an equipment asset.
 *
 * Inserts a row into maintenance_logs. The existing trigger
 * (trg_update_last_maint_date) atomically updates equipment.last_maint_date
 * within the same transaction, so both writes are guaranteed consistent.
 *
 * Auth:   Manager PIN (HMAC cookie)
 * Method: POST
 * CSRF:   X-BrewHub-Action: true
 * RLS:    is_brewhub_manager() on maintenance_logs + equipment
 */
const { createClient } = require('@supabase/supabase-js');
const { authorize, json } = require('./_auth');
const { requireCsrfHeader } = require('./_csrf');
const { sanitizeInput } = require('./_sanitize');
const { staffBucket } = require('./_token-bucket');
const { hashIP } = require('./_ip-hash');
const { logSystemError } = require('./_system-errors');

const supabaseUrl = process.env.SUPABASE_URL;
const supabase = createClient(supabaseUrl, process.env.SUPABASE_SERVICE_ROLE_KEY);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_COST = 999999.99;
const MAX_NOTES_LEN = 2000;

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
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };
  const cors = (code, data) => ({
    statusCode: code,
    headers: corsHeaders,
    body: JSON.stringify(data),
  });

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: corsHeaders, body: '' };
  if (event.httpMethod !== 'POST') return cors(405, { error: 'Method Not Allowed' });

  /* ── CSRF protection ──────────────────────────────────── */
  const csrfBlock = requireCsrfHeader(event);
  if (csrfBlock) return csrfBlock;

  /* ── Rate limiting ────────────────────────────────────── */
  const clientIP = event.headers['x-nf-client-connection-ip']
    || event.headers['x-forwarded-for']?.split(',')[0]?.trim()
    || 'unknown';
  const rlKey = `log-maint:${hashIP(clientIP)}`;
  const bucket = staffBucket.consume(rlKey);
  if (!bucket.allowed) {
    return cors(429, { error: 'Rate limit exceeded', retryAfterMs: bucket.retryAfterMs });
  }

  /* ── Auth (Manager only) ──────────────────────────────── */
  const auth = await authorize(event, { requireManager: true, requirePin: true });
  if (!auth.ok) return auth.response;

  /* ── Parse & validate body ────────────────────────────── */
  let parsed;
  try { parsed = JSON.parse(event.body || '{}'); }
  catch { return cors(400, { error: 'Invalid JSON body' }); }

  const { equipment_id, performed_at, cost, notes } = parsed;

  // equipment_id — required UUID
  if (!equipment_id || !UUID_RE.test(String(equipment_id))) {
    return cors(400, { error: 'Invalid or missing equipment_id (UUID)' });
  }

  // performed_at — required YYYY-MM-DD, must not be in the future
  if (!performed_at || !DATE_RE.test(String(performed_at))) {
    return cors(400, { error: 'Invalid or missing performed_at (YYYY-MM-DD)' });
  }
  const perfDate = new Date(performed_at + 'T00:00:00Z');
  if (isNaN(perfDate.getTime())) {
    return cors(400, { error: 'Invalid date' });
  }
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  if (perfDate > today) {
    return cors(400, { error: 'performed_at cannot be in the future' });
  }

  // cost — required numeric >= 0
  const costNum = Number(cost);
  if (isNaN(costNum) || costNum < 0 || costNum > MAX_COST) {
    return cors(400, { error: `cost must be 0–${MAX_COST}` });
  }

  // notes — optional, sanitize + truncate
  const safeNotes = notes ? sanitizeInput(String(notes)).slice(0, MAX_NOTES_LEN) : null;

  /* ── Verify equipment exists ──────────────────────────── */
  const { data: equipRow, error: lookupErr } = await supabase
    .from('equipment')
    .select('id, is_active')
    .eq('id', equipment_id)
    .single();

  if (lookupErr || !equipRow) {
    return cors(404, { error: 'Equipment not found' });
  }
  if (!equipRow.is_active) {
    return cors(400, { error: 'Cannot log maintenance for deactivated equipment' });
  }

  /* ── Insert maintenance log ───────────────────────────── *
   * The AFTER INSERT trigger (trg_update_last_maint_date)
   * atomically updates equipment.last_maint_date in the
   * same transaction, satisfying the single-transaction req.
   * ─────────────────────────────────────────────────────── */
  try {
    const { data: logRow, error: insertErr } = await supabase
      .from('maintenance_logs')
      .insert({
        equipment_id,
        performed_at,
        cost: costNum,
        notes: safeNotes,
        performed_by: auth.user?.id || null,
      })
      .select('id, equipment_id, performed_at, cost, notes, created_at')
      .single();

    if (insertErr) {
      console.error('[LOG-MAINT] Insert error:', insertErr.message);
      await logSystemError(supabase, {
        error_type: 'db_insert_failed',
        severity: 'warning',
        source_function: 'log-maintenance-action',
        error_message: insertErr.message,
        context: { equipment_id, performed_at },
      });
      return cors(500, { error: 'Failed to log maintenance' });
    }

    return cors(200, { success: true, maintenance_log: logRow });
  } catch (err) {
    console.error('[LOG-MAINT] Unexpected error:', err?.message);
    return cors(500, { error: 'Internal server error' });
  }
};
