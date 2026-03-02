// manage-schedule.js — Server-side proxy for AdminCalendar shift CRUD.
// Handles POST (create), PATCH (update/move), DELETE on scheduled_shifts.
// GET returns shifts via the v_scheduled_shifts_with_staff view.
// All writes require manager-level PIN-HMAC auth; reads require staff auth.

const { createClient } = require('@supabase/supabase-js');
const { authorize, json, sanitizedError } = require('./_auth');
const { requireCsrfHeader } = require('./_csrf');
const { sanitizeInput } = require('./_sanitize');
const { staffBucket } = require('./_token-bucket');

const MISSING_ENV = !process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VALID_STATUSES = ['scheduled', 'confirmed', 'cancelled'];

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
    // ─── GET: list shifts ────────────────────────────────────────────────
    if (event.httpMethod === 'GET') {
      const { data, error } = await supabase
        .from('v_scheduled_shifts_with_staff')
        .select('id, user_id, start_time, end_time, role_id, status, updated_at, employee_name');

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

    // ─── POST: create shift ──────────────────────────────────────────────
    if (event.httpMethod === 'POST') {
      const { user_id, start_time, end_time, role_id, location_id } = body;

      if (!user_id || typeof user_id !== 'string' || !UUID_RE.test(user_id)) {
        return corsJson(422, { error: 'Missing or invalid user_id (UUID)' });
      }
      if (!start_time || !end_time) {
        return corsJson(422, { error: 'start_time and end_time are required' });
      }
      const startDt = new Date(start_time);
      const endDt = new Date(end_time);
      if (Number.isNaN(startDt.getTime()) || Number.isNaN(endDt.getTime())) {
        return corsJson(422, { error: 'Invalid datetime format' });
      }
      if (endDt <= startDt) {
        return corsJson(422, { error: 'end_time must be after start_time' });
      }

      const safeRoleId = role_id ? sanitizeInput(String(role_id)).slice(0, 100) : null;
      const safeLocationId = location_id ? sanitizeInput(String(location_id)).slice(0, 100) : 'brewhub_main';

      const { data, error } = await supabase
        .from('scheduled_shifts')
        .insert({
          user_id,
          start_time: startDt.toISOString(),
          end_time: endDt.toISOString(),
          role_id: safeRoleId,
          location_id: safeLocationId,
          status: 'scheduled',
        })
        .select('id, user_id, start_time, end_time, role_id, status, updated_at')
        .single();

      if (error) throw error;

      // Audit log
      await supabase.from('shift_audit_log').insert({
        shift_id: data.id,
        action: 'created',
        actor_id: auth.user?.id || null,
        actor_name: auth.user?.name || auth.user?.email || 'unknown',
        new_data: data,
      }).then(({ error: auditErr }) => {
        if (auditErr) console.warn('[manage-schedule] Audit log insert failed:', auditErr.message);
      });

      return corsJson(201, { shift: data });
    }

    // ─── PATCH: update/move shift ────────────────────────────────────────
    if (event.httpMethod === 'PATCH') {
      const { id, start_time, end_time, updated_at } = body;

      if (!id || typeof id !== 'string' || !UUID_RE.test(id)) {
        return corsJson(422, { error: 'Missing or invalid shift id (UUID)' });
      }
      if (!start_time || !end_time) {
        return corsJson(422, { error: 'start_time and end_time are required' });
      }
      const startDt = new Date(start_time);
      const endDt = new Date(end_time);
      if (Number.isNaN(startDt.getTime()) || Number.isNaN(endDt.getTime())) {
        return corsJson(422, { error: 'Invalid datetime format' });
      }
      if (endDt <= startDt) {
        return corsJson(422, { error: 'end_time must be after start_time' });
      }

      // Optimistic concurrency: only update if updated_at still matches
      let query = supabase
        .from('scheduled_shifts')
        .update({ start_time: startDt.toISOString(), end_time: endDt.toISOString() })
        .eq('id', id);

      if (updated_at) {
        query = query.eq('updated_at', updated_at);
      }

      const { data, error } = await query
        .select('id, user_id, start_time, end_time, role_id, status, updated_at')
        .maybeSingle();

      if (error) throw error;
      if (!data) {
        return corsJson(409, { error: 'Conflict — shift was modified by another manager. Please refresh.' });
      }

      // Audit log
      await supabase.from('shift_audit_log').insert({
        shift_id: id,
        action: 'updated',
        actor_id: auth.user?.id || null,
        actor_name: auth.user?.name || auth.user?.email || 'unknown',
        new_data: data,
        changed_cols: ['start_time', 'end_time'],
      }).then(({ error: auditErr }) => {
        if (auditErr) console.warn('[manage-schedule] Audit log insert failed:', auditErr.message);
      });

      return corsJson(200, { shift: data });
    }

    // ─── DELETE: remove shift ────────────────────────────────────────────
    if (event.httpMethod === 'DELETE') {
      const { id } = body;

      if (!id || typeof id !== 'string' || !UUID_RE.test(id)) {
        return corsJson(422, { error: 'Missing or invalid shift id (UUID)' });
      }

      // Fetch old data for audit trail before deleting
      const { data: oldShift } = await supabase
        .from('scheduled_shifts')
        .select('id, user_id, start_time, end_time, role_id, status')
        .eq('id', id)
        .maybeSingle();

      const { error } = await supabase
        .from('scheduled_shifts')
        .delete()
        .eq('id', id);

      if (error) throw error;

      // Audit log
      if (oldShift) {
        await supabase.from('shift_audit_log').insert({
          shift_id: id,
          action: 'deleted',
          actor_id: auth.user?.id || null,
          actor_name: auth.user?.name || auth.user?.email || 'unknown',
          old_data: oldShift,
        }).then(({ error: auditErr }) => {
          if (auditErr) console.warn('[manage-schedule] Audit log insert failed:', auditErr.message);
        });
      }

      return corsJson(200, { ok: true });
    }

    return corsJson(405, { error: 'Method not allowed' });
  } catch (err) {
    return sanitizedError(err, 'manage-schedule');
  }
};
