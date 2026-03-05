// manage-schedule.js — Server-side proxy for AdminCalendar shift CRUD.
// Handles POST (create), PATCH (update/move), DELETE on scheduled_shifts.
// GET returns shifts via the v_scheduled_shifts_with_staff view.
// All writes require manager-level PIN-HMAC auth; reads require staff auth.

const { createClient } = require('@supabase/supabase-js');
const { authorize, json, sanitizedError } = require('./_auth');
const { requireCsrfHeader } = require('./_csrf');
const { sanitizeInput } = require('./_sanitize');
const { staffBucket } = require('./_token-bucket');
const { logSystemError } = require('./_system-errors');

const MISSING_ENV = !process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VALID_STATUSES = ['scheduled', 'confirmed', 'cancelled'];

/**
 * Parse a datetime string into a proper Date, treating bare (no-offset)
 * strings as America/New_York.  If the string already contains 'Z' or an
 * explicit ±HH:MM offset it is parsed as-is.  This prevents ±5h drift when
 * the server runs in UTC but the calendar UI sends bare ET datetimes.
 */
function parseET(str) {
  if (!str) return new Date(NaN);
  // Already has an offset → parse normally
  if (/Z$/i.test(str) || /[+-]\d{2}:\d{2}$/.test(str)) return new Date(str);
  // Bare string — assume EST (-05:00) for a rough parse, then compute
  // the real ET offset (handles DST) using Intl.
  const rough = new Date(`${str}-05:00`);
  if (Number.isNaN(rough.getTime())) return rough; // propagate NaN
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    timeZoneName: 'shortOffset',
  }).formatToParts(rough);
  const tzPart = (parts.find((p) => p.type === 'timeZoneName') || {}).value || 'GMT-5';
  const m = tzPart.match(/GMT([+-])(\d+)/);
  const offset = m ? `${m[1]}${m[2].padStart(2, '0')}:00` : '-05:00';
  return new Date(`${str}${offset}`);
}

function getSupabase() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
}

exports.handler = async (event) => {
  // ─── CORS ────────────────────────────────────────────────────────────────
  const ALLOWED_ORIGINS = [process.env.URL, 'https://brewhubphl.com', 'https://www.brewhubphl.com'].filter(Boolean);
  const origin = event.headers?.origin || '';
  const CORS_ORIGIN = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  const corsHeaders = {
    'Access-Control-Allow-Origin': CORS_ORIGIN,
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-BrewHub-Action',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
  };
  const corsJson = (code, data) => ({
    statusCode: code,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
    body: JSON.stringify(data),
  });

  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: corsHeaders, body: '' };
  if (MISSING_ENV) return corsJson(500, { error: 'Server misconfiguration' });

  // ─── Auth: reads = staff, writes = manager ───────────────────────────────
  const isRead = event.httpMethod === 'GET';
  const auth = await authorize(event, { requirePin: true, requireManager: !isRead });
  if (!auth.ok) return { ...auth.response, headers: { ...(auth.response.headers || {}), ...corsHeaders } };

  // ─── Rate limiting ───────────────────────────────────────────────────────
  const clientIp = event.headers['x-nf-client-connection-ip'] || event.headers['x-forwarded-for']?.split(',')[0]?.trim() || 'unknown';
  const staffEmail = auth.user?.email || 'unknown';
  const rlKey = `schedule:${staffEmail}:${clientIp}`;
  const rl = staffBucket.consume(rlKey);
  if (!rl.allowed) {
    return corsJson(429, { error: 'Too many requests', retryAfterMs: rl.retryAfterMs });
  }

  const supabase = getSupabase();

  try {
    // ─── GET: list shifts (date-windowed, defaults to now → +30 days) ────
    if (event.httpMethod === 'GET') {
      const params = event.queryStringParameters || {};

      // Staff directory listing (for calendar dropdown)
      if (params.type === 'staff') {
        const { data, error } = await supabase
          .from('staff_directory_safe')
          .select('id, name, full_name, role');

        if (error) throw error;
        return corsJson(200, { staff: data || [] });
      }

      const startDate = params.start_date || new Date().toISOString();
      const endDefault = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
      const endDate = params.end_date || endDefault;

      const { data, error } = await supabase
        .from('v_scheduled_shifts_with_staff')
        .select('id, user_id, start_time, end_time, role_id, status, updated_at, employee_name')
        .gte('start_time', startDate)
        .lte('end_time', endDate)
        .order('start_time', { ascending: true })
        .limit(500);

      if (error) throw error;
      return corsJson(200, { shifts: data || [] });
    }

    // ─── CSRF for writes ─────────────────────────────────────────────────
    const csrfBlock = requireCsrfHeader(event);
    if (csrfBlock) return csrfBlock;

    // ─── Parse body ──────────────────────────────────────────────────────
    let body;
    try {
      body = JSON.parse(event.body || '{}');
    } catch {
      return corsJson(400, { error: 'Invalid JSON body' });
    }

    // ─── POST: create shift(s) — supports batch user_ids or single user_id ──
    if (event.httpMethod === 'POST') {
      const { user_id, user_ids, start_time, end_time, role_id, location_id } = body;

      // Support batch user_ids (preferred) or single user_id (backward compat)
      const isBatch = Array.isArray(user_ids) && user_ids.length > 0;
      const ids = isBatch ? user_ids : (user_id ? [user_id] : []);

      if (ids.length === 0) {
        return corsJson(422, { error: 'Missing or invalid user_id / user_ids (UUID)' });
      }
      if (ids.length > 20) {
        return corsJson(422, { error: 'Maximum 20 shifts per batch create' });
      }
      for (const uid of ids) {
        if (typeof uid !== 'string' || !UUID_RE.test(uid)) {
          return corsJson(422, { error: `Invalid user_id: ${String(uid).slice(0, 40)}` });
        }
      }
      if (!start_time || !end_time) {
        return corsJson(422, { error: 'start_time and end_time are required' });
      }
      const startDt = parseET(start_time);
      const endDt = parseET(end_time);
      if (Number.isNaN(startDt.getTime()) || Number.isNaN(endDt.getTime())) {
        return corsJson(422, { error: 'Invalid datetime format' });
      }
      if (endDt <= startDt) {
        return corsJson(422, { error: 'end_time must be after start_time' });
      }

      const safeRoleId = role_id ? sanitizeInput(String(role_id)).slice(0, 100) : null;
      const safeLocationId = location_id ? sanitizeInput(String(location_id)).slice(0, 100) : 'brewhub_main';

      const rows = ids.map(uid => ({
        user_id: uid,
        start_time: startDt.toISOString(),
        end_time: endDt.toISOString(),
        role_id: safeRoleId,
        location_id: safeLocationId,
        status: 'scheduled',
      }));

      const { data, error } = await supabase
        .from('scheduled_shifts')
        .insert(rows)
        .select('id, user_id, start_time, end_time, role_id, status, updated_at');

      if (error) throw error;

      // Audit log
      const auditRows = (data || []).map(shift => ({
        shift_id: shift.id,
        action: 'created',
        actor_id: auth.user?.id || null,
        actor_name: auth.user?.name || auth.user?.email || 'unknown',
        new_data: shift,
      }));
      if (auditRows.length > 0) {
        await supabase.from('shift_audit_log').insert(auditRows).then(({ error: auditErr }) => {
          if (auditErr) console.warn('[manage-schedule] Audit log insert failed:', auditErr.message);
        });
      }

      // Return single shift for backward compat when only one was created
      if (!isBatch && data && data.length === 1) {
        return corsJson(201, { shift: data[0] });
      }
      return corsJson(201, { shifts: data || [] });
    }

    // ─── PATCH: update/move shift(s) — supports single id or batch shift_ids ──
    if (event.httpMethod === 'PATCH') {
      const { id, shift_ids, start_time, end_time, updated_at } = body;

      // Support single id (backward compat) or batch shift_ids
      const isBatch = Array.isArray(shift_ids) && shift_ids.length > 0;
      const ids = isBatch ? shift_ids : (id ? [id] : []);

      if (ids.length === 0) {
        return corsJson(422, { error: 'Missing shift id or shift_ids' });
      }
      if (ids.length > 20) {
        return corsJson(422, { error: 'Maximum 20 shifts per batch move' });
      }
      for (const shiftId of ids) {
        if (typeof shiftId !== 'string' || !UUID_RE.test(shiftId)) {
          return corsJson(422, { error: `Invalid shift id: ${String(shiftId).slice(0, 40)}` });
        }
      }
      if (!start_time || !end_time) {
        return corsJson(422, { error: 'start_time and end_time are required' });
      }
      const startDt = parseET(start_time);
      const endDt = parseET(end_time);
      if (Number.isNaN(startDt.getTime()) || Number.isNaN(endDt.getTime())) {
        return corsJson(422, { error: 'Invalid datetime format' });
      }
      if (endDt <= startDt) {
        return corsJson(422, { error: 'end_time must be after start_time' });
      }

      let data;

      if (!isBatch && updated_at) {
        // Single shift with optimistic concurrency (existing behavior)
        const result = await supabase
          .from('scheduled_shifts')
          .update({ start_time: startDt.toISOString(), end_time: endDt.toISOString() })
          .eq('id', ids[0])
          .eq('updated_at', updated_at)
          .select('id, user_id, start_time, end_time, role_id, status, updated_at')
          .maybeSingle();

        if (result.error) throw result.error;
        if (!result.data) {
          return corsJson(409, { error: 'Conflict — shift was modified by another manager. Please refresh.' });
        }
        data = [result.data];
      } else {
        // Batch update (or single without optimistic concurrency)
        const result = await supabase
          .from('scheduled_shifts')
          .update({ start_time: startDt.toISOString(), end_time: endDt.toISOString() })
          .in('id', ids)
          .select('id, user_id, start_time, end_time, role_id, status, updated_at');

        if (result.error) throw result.error;
        if (!result.data || result.data.length === 0) {
          return corsJson(409, { error: 'Conflict — shifts were modified. Please refresh.' });
        }
        data = result.data;
      }

      // Audit log
      const auditRows = data.map(shift => ({
        shift_id: shift.id,
        action: 'updated',
        actor_id: auth.user?.id || null,
        actor_name: auth.user?.name || auth.user?.email || 'unknown',
        new_data: shift,
        changed_cols: ['start_time', 'end_time'],
      }));
      await supabase.from('shift_audit_log').insert(auditRows).then(({ error: auditErr }) => {
        if (auditErr) console.warn('[manage-schedule] Audit log insert failed:', auditErr.message);
      });

      return corsJson(200, { shifts: data });
    }

    // ─── DELETE: remove shift(s) — supports single id or batch ids ────────
    if (event.httpMethod === 'DELETE') {
      const deleteIds = Array.isArray(body.ids)
        ? body.ids
        : body.id
          ? [body.id]
          : [];

      if (deleteIds.length === 0) {
        return corsJson(422, { error: 'Missing shift id or ids' });
      }
      if (deleteIds.length > 20) {
        return corsJson(422, { error: 'Maximum 20 shifts per batch delete' });
      }
      for (const shiftId of deleteIds) {
        if (typeof shiftId !== 'string' || !UUID_RE.test(shiftId)) {
          return corsJson(422, { error: `Invalid shift id: ${String(shiftId).slice(0, 40)}` });
        }
      }

      // Fetch old data for audit trail before deleting
      const { data: oldShifts, error: oldShiftsErr } = await supabase
        .from('scheduled_shifts')
        .select('id, user_id, start_time, end_time, role_id, status')
        .in('id', deleteIds);

      if (oldShiftsErr) throw oldShiftsErr;

      const { error } = await supabase
        .from('scheduled_shifts')
        .delete()
        .in('id', deleteIds);

      if (error) throw error;

      // Audit log
      if (oldShifts && oldShifts.length > 0) {
        const auditRows = oldShifts.map(shift => ({
          shift_id: shift.id,
          action: 'deleted',
          actor_id: auth.user?.id || null,
          actor_name: auth.user?.name || auth.user?.email || 'unknown',
          old_data: shift,
        }));
        await supabase.from('shift_audit_log').insert(auditRows).then(({ error: auditErr }) => {
          if (auditErr) console.warn('[manage-schedule] Audit log insert failed:', auditErr.message);
        });
      }

      return corsJson(200, { ok: true, deleted: deleteIds.length });
    }

    return corsJson(405, { error: 'Method not allowed' });
  } catch (err) {
    await logSystemError(supabase, {
      error_type: 'unhandled_exception',
      severity: 'critical',
      source_function: 'manage-schedule',
      error_message: err?.message || 'Unknown error',
      context: { stack: err?.stack },
    });
    return sanitizedError(err, 'manage-schedule');
  }
};
