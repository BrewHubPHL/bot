/**
 * RESOLVE NO-SHOW — Manager Override endpoint
 * Path: netlify/functions/resolve-no-show.js
 *
 * Allows a manager to excuse a no-show shift:
 *   1. Validates Manager PIN auth (requirePin: true) + CSRF header
 *   2. Updates scheduled_shifts status from 'no_show' → 'cancelled'
 *      (with optimistic concurrency guard + double-submit protection)
 *   3. Inserts manager_override_log record (IRS/audit trail)
 *   Note: shift_audit_log is handled by the DB trigger `log_shift_change`.
 */

const { createClient } = require('@supabase/supabase-js');
const { authorize, sanitizedError } = require('./_auth');
const { requireCsrfHeader } = require('./_csrf');
const { sanitizeInput } = require('./_sanitize');
const { staffBucket } = require('./_token-bucket');

const MISSING_ENV = !process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY;

const ALLOWED_ORIGINS = new Set([
  process.env.SITE_URL,
  'https://brewhubphl.com',
  'https://www.brewhubphl.com',
].filter(Boolean));

function validateOrigin(headers) {
  const origin = headers['origin'] || headers['Origin'] || '';
  if (ALLOWED_ORIGINS.has(origin)) return origin;
  if (origin === '' && process.env.SITE_URL) return process.env.SITE_URL;
  return null;
}

const makeHeaders = (origin) => Object.assign({
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store',
  'Vary': 'Origin',
}, origin ? {
  'Access-Control-Allow-Origin': origin,
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-BrewHub-Action',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
} : {});

const json = (code, data, headers) => ({
  statusCode: code,
  headers,
  body: JSON.stringify(data),
});

// ── UUID v4 regex for input validation ──
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

exports.handler = async (event) => {
  if (MISSING_ENV) return { statusCode: 500, headers: makeHeaders(null), body: JSON.stringify({ error: 'Server misconfiguration' }) };

  const origin = validateOrigin(event.headers || {});
  const headers = makeHeaders(origin);

  // ── CORS preflight ──
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' }, headers);

  // ── CSRF guard ──
  const csrfBlock = requireCsrfHeader(event);
  if (csrfBlock) return Object.assign({}, csrfBlock, { headers: Object.assign({}, csrfBlock.headers || {}, headers) });

  // ── Manager auth ──
  const auth = await authorize(event, { requireManager: true, requirePin: true });
  if (!auth.ok) return Object.assign({}, auth.response, { headers: Object.assign({}, auth.response.headers || {}, headers) });

  // ── Rate limiting ──
  const clientIp = event.headers['x-nf-client-connection-ip'] || event.headers['x-forwarded-for']?.split(',')[0]?.trim() || 'unknown';
  const managerEmail = auth.user?.email || auth.user?.user?.email || 'unknown_manager';
  const key = `resolve-noshow:${managerEmail}:${clientIp}`;
  const rl = staffBucket.consume(key);
  if (!rl.allowed) {
    return json(429, { error: 'Too many requests' }, Object.assign({}, headers, { 'Retry-After': String(Math.ceil(rl.retryAfterMs / 1000)) }));
  }

  // ── Parse & validate body ──
  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return json(400, { error: 'Invalid JSON' }, headers); }

  const shiftId = body.shiftId;
  const reason = sanitizeInput(String(body.reason || '')).slice(0, 500);

  if (!shiftId || !UUID_RE.test(shiftId)) {
    return json(400, { error: 'Missing or invalid shiftId' }, headers);
  }
  if (!reason || reason.length < 3) {
    return json(400, { error: 'A reason is required (min 3 characters)' }, headers);
  }

  try {
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

    // ── Verify the shift exists and is currently 'no_show' ──
    const { data: shift, error: shiftErr } = await supabase
      .from('scheduled_shifts')
      .select('id, user_id, status, start_time')
      .eq('id', shiftId)
      .single();

    if (shiftErr || !shift) {
      return json(404, { error: 'Shift not found' }, headers);
    }
    if (shift.status !== 'no_show') {
      return json(409, { error: `Shift status is '${shift.status}', expected 'no_show'` }, headers);
    }

    // ── Update shift to 'cancelled' (with row-level concurrency guard) ──
    const { data: updatedRow, error: updateErr } = await supabase
      .from('scheduled_shifts')
      .update({ status: 'cancelled' })
      .eq('id', shiftId)
      .eq('status', 'no_show') // optimistic concurrency guard
      .select('id')
      .single();

    if (updateErr || !updatedRow) {
      // Another request already resolved this shift (double-submit) or a concurrent change occurred
      console.warn(`[RESOLVE-NO-SHOW] Update returned no rows for shift ${shiftId} — likely double-submit or concurrent change`);
      return json(409, { error: 'Shift was already resolved or modified by another request' }, headers);
    }

    // ── Resolve manager identity for audit records ──
    const mgrEmail = String(managerEmail).toLowerCase();
    const { data: mgrRow } = await supabase
      .from('staff_directory')
      .select('id, full_name, name')
      .eq('email', mgrEmail)
      .single();

    const mgrStaffId = mgrRow?.id || null;
    const mgrName = mgrRow?.full_name || mgrRow?.name || mgrEmail;

    // ── Insert manager_override_log (IRS/audit trail) ──
    // Note: shift_audit_log is NOT inserted manually — the DB trigger
    // `log_shift_change` on scheduled_shifts handles it automatically.
    const { error: overrideErr } = await supabase.from('manager_override_log').insert([{
      action_type: 'schedule_edit',
      manager_email: mgrEmail,
      manager_staff_id: mgrStaffId,
      target_entity: 'scheduled_shifts',
      target_id: shiftId,
      target_employee: shift.user_id,
      details: {
        action: 'excuse_no_show',
        reason,
        previous_status: 'no_show',
        new_status: 'cancelled',
        shift_start_time: shift.start_time,
      },
      ip_address: clientIp,
    }]);

    if (overrideErr) {
      // The shift status was already updated, so log the failure but don't roll back
      console.error(`[RESOLVE-NO-SHOW] manager_override_log insert failed: ${overrideErr.message}`);
      // Return success with a warning so the caller knows the override log wasn't persisted
      return json(200, { ok: true, shiftId, newStatus: 'cancelled', warning: 'Override audit record failed to persist' }, headers);
    }

    console.log(`[RESOLVE-NO-SHOW] Manager ${mgrEmail} excused shift ${shiftId}: ${reason}`);

    return json(200, { ok: true, shiftId, newStatus: 'cancelled' }, headers);
  } catch (err) {
    console.error('[RESOLVE-NO-SHOW] CRASH:', err.message);
    const res = sanitizedError(err, 'resolve-no-show');
    res.headers = Object.assign({}, res.headers || {}, headers);
    return res;
  }
};
