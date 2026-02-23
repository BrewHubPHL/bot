// ═══════════════════════════════════════════════════════════════════════════
// offline-session.js — Offline Session Management API
// ═══════════════════════════════════════════════════════════════════════════
//
// Manages offline session lifecycle for the Ghost Revenue defense:
//   POST { action: 'open' }         → opens new offline session
//   POST { action: 'record_sale' }  → records a cash sale against the cap
//   POST { action: 'close' }        → closes session when connectivity restores
//   POST { action: 'override_cap' } → manager extends cap (requires manager auth)
//   POST { action: 'status' }       → get current session + exposure stats
//
// All actions require staff PIN auth (except override which needs manager PIN).
// ═══════════════════════════════════════════════════════════════════════════

const { createClient } = require('@supabase/supabase-js');
const { authorize, json } = require('./_auth');
const { requireCsrfHeader } = require('./_csrf');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Method Not Allowed' });
  }

  // CSRF protection
  const csrfBlock = requireCsrfHeader(event);
  if (csrfBlock) return csrfBlock;

  // Staff auth required
  const auth = await authorize(event);
  if (!auth.ok) return auth.response;

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return json(400, { error: 'Invalid JSON' });
  }

  const { action } = body;

  // ── OPEN: Start a new offline session ───────────────────────
  if (action === 'open') {
    const { data, error } = await supabase.rpc('open_offline_session', {
      p_staff_email: auth.email || null,
      p_staff_name: auth.name || null,
    });

    if (error) {
      console.error('[OFFLINE-SESSION] Open failed:', error.message);
      return json(500, { error: 'Failed to open offline session' });
    }

    const session = Array.isArray(data) ? data[0] : data;
    console.log(`[OFFLINE-SESSION] ${session.already_open ? 'Resumed' : 'Opened'} session ${session.session_id} (cap: $${(session.cap_cents / 100).toFixed(2)})`);

    return json(200, {
      session_id: session.session_id,
      cap_cents: session.cap_cents,
      already_open: session.already_open,
    });
  }

  // ── RECORD SALE: Log a cash order against the cap ──────────
  if (action === 'record_sale') {
    const { session_id, amount_cents, order_id } = body;

    if (!session_id || !amount_cents || amount_cents <= 0) {
      return json(400, { error: 'session_id and amount_cents required' });
    }

    try {
      const { data, error } = await supabase.rpc('record_offline_sale', {
        p_session_id: session_id,
        p_amount_cents: amount_cents,
        p_order_id: order_id || null,
      });

      if (error) {
        console.error('[OFFLINE-SESSION] Record sale failed:', error.message);
        return json(500, { error: error.message });
      }

      const result = Array.isArray(data) ? data[0] : data;

      if (!result.allowed) {
        console.warn(`[OFFLINE-SESSION] Sale BLOCKED — cap reached ($${(result.new_total_cents / 100).toFixed(2)} / $${(result.cap_cents / 100).toFixed(2)})`);
        return json(403, {
          error: 'Offline cash cap reached',
          blocked: true,
          total_cents: result.new_total_cents,
          cap_cents: result.cap_cents,
          remaining_cents: result.remaining_cents,
          pct_used: result.pct_used,
        });
      }

      return json(200, {
        allowed: true,
        total_cents: result.new_total_cents,
        cap_cents: result.cap_cents,
        remaining_cents: result.remaining_cents,
        pct_used: result.pct_used,
      });
    } catch (err) {
      console.error('[OFFLINE-SESSION] Record sale exception:', err.message);
      return json(500, { error: 'Failed to record sale' });
    }
  }

  // ── CLOSE: End offline session on recovery ─────────────────
  if (action === 'close') {
    const { session_id } = body;

    const { data, error } = await supabase.rpc('close_offline_session', {
      p_session_id: session_id || null,
    });

    if (error) {
      console.error('[OFFLINE-SESSION] Close failed:', error.message);
      return json(500, { error: 'Failed to close offline session' });
    }

    const result = Array.isArray(data) ? data[0] : data;

    if (!result) {
      return json(200, { message: 'No active session to close' });
    }

    console.log(`[OFFLINE-SESSION] Closed session ${result.session_id} — ${result.duration_minutes}min, ${result.orders_count} orders, $${(result.cash_total_cents / 100).toFixed(2)} cash`);

    return json(200, {
      session_id: result.session_id,
      duration_minutes: result.duration_minutes,
      cash_total_cents: result.cash_total_cents,
      orders_count: result.orders_count,
    });
  }

  // ── OVERRIDE CAP: Manager extends the cap ──────────────────
  if (action === 'override_cap') {
    const { session_id, new_cap_cents } = body;

    if (!session_id) {
      return json(400, { error: 'session_id required' });
    }

    // Require manager-level auth
    if (auth.role !== 'manager' && auth.role !== 'admin') {
      return json(403, { error: 'Manager authorization required to override cap' });
    }

    const { data, error } = await supabase.rpc('override_offline_cap', {
      p_session_id: session_id,
      p_manager_email: auth.email || 'unknown-manager',
      p_new_cap_cents: new_cap_cents || null,
    });

    if (error) {
      console.error('[OFFLINE-SESSION] Override failed:', error.message);
      return json(500, { error: 'Failed to override cap' });
    }

    const result = Array.isArray(data) ? data[0] : data;

    if (!result?.success) {
      return json(404, { error: 'No active session found' });
    }

    console.log(`[OFFLINE-SESSION] Cap overridden to $${(result.new_cap_cents / 100).toFixed(2)} by ${auth.email}`);

    return json(200, {
      success: true,
      new_cap_cents: result.new_cap_cents,
      overridden_by: auth.email,
    });
  }

  // ── STATUS: Get current offline exposure ──────────────────
  if (action === 'status') {
    const { data, error } = await supabase.rpc('get_offline_exposure_stats');

    if (error) {
      console.error('[OFFLINE-SESSION] Status failed:', error.message);
      return json(500, { error: 'Failed to get offline stats' });
    }

    const stats = Array.isArray(data) ? data[0] : data;

    return json(200, {
      active_session_id: stats?.active_session_id || null,
      is_offline: stats?.is_offline || false,
      current_cash_cents: stats?.current_cash_cents || 0,
      current_cap_cents: stats?.current_cap_cents || 20000,
      current_pct_used: stats?.current_pct_used || 0,
      offline_since: stats?.offline_since || null,
      total_losses_30d_cents: stats?.total_losses_30d_cents || 0,
      total_declines_30d: stats?.total_declines_30d || 0,
      total_sessions_30d: stats?.total_sessions_30d || 0,
    });
  }

  return json(400, { error: `Unknown action: ${action}` });
};
