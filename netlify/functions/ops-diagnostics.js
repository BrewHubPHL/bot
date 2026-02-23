// ops-diagnostics.js — Manager-only log scraper and order diagnostics endpoint.
// Surfaces recent order failures, abandoned orders, receipt gaps, and sync errors
// so ops can diagnose issues like 500s and missing receipts from the dashboard.
//
// GET /.netlify/functions/ops-diagnostics?scope=all         (default: everything)
// GET /.netlify/functions/ops-diagnostics?scope=orders      (recent problem orders)
// GET /.netlify/functions/ops-diagnostics?scope=receipts    (orders missing receipts)
// GET /.netlify/functions/ops-diagnostics?scope=sync        (loyalty sync errors)
// GET /.netlify/functions/ops-diagnostics?scope=abandoned   (abandoned/cancelled by cron)
// GET /.netlify/functions/ops-diagnostics?hours=4           (lookback window, default 4)

const { createClient } = require('@supabase/supabase-js');
const { authorize, json } = require('./_auth');

function sanitizeString(s, max = 200) {
  if (!s && s !== 0) return '';
  const str = String(s).replace(/<[^>]*>?/g, '').trim();
  return str.length > max ? str.slice(0, max) : str;
}

function maskEmail(e) {
  if (!e) return '';
  const parts = String(e).split('@');
  if (parts.length !== 2) return 'redacted';
  return parts[0][0] + '***@' + parts[1];
}

function maskName(n) {
  if (!n) return '';
  const parts = String(n).trim().split(/\s+/);
  if (parts.length === 1) return parts[0][0] + '.'.toUpperCase();
  return parts[0] + ' ' + (parts[1][0] || '') + '.';
}

function jsonResponse(code, data, origin) {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-BrewHub-Action',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Cache-Control': 'no-store',
  };
  const allowlist = [process.env.SITE_URL, 'https://brewhubphl.com', 'https://www.brewhubphl.com'].filter(Boolean);
  if (origin && allowlist.includes(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Vary'] = 'Origin';
  }
  return { statusCode: code, headers, body: JSON.stringify(data) };
}

// ── Diagnostic queries ──────────────────────────────────────────

/**
 * Orders in non-normal states: abandoned, cancelled (by cron), amount_mismatch,
 * or orders stuck in pending for > 20 minutes.
 */
async function getProblematicOrders(since, supabase) {
  const { data, error } = await supabase
    .from('orders')
    .select('id, status, payment_id, total_amount_cents, customer_name, customer_email, created_at, updated_at')
    .or(`status.in.(abandoned,amount_mismatch),and(status.eq.pending,created_at.lt.${new Date(Date.now() - 20 * 60_000).toISOString()})`)
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) return { error: sanitizeString(error.message || String(error), 200) };
  return (data || []).map(o => ({
    id: o.id,
    status: o.status,
    payment_id: o.payment_id || null,
    total_cents: o.total_amount_cents,
    customer: o.customer_name ? maskName(o.customer_name) : maskEmail(o.customer_email) || '(anonymous)',
    created: o.created_at,
    updated: o.updated_at,
    age_min: o.created_at ? Math.round((Date.now() - new Date(o.created_at).getTime()) / 60_000) : null,
  }));
}

/**
 * Recent orders that were completed/preparing/paid but have NO matching
 * receipt_queue row — i.e., the receipt was never generated.
 */
async function getReceiptGaps(since, supabase) {
  // Get recent orders that should have receipts
  const { data: orders, error: oErr } = await supabase
    .from('orders')
    .select('id, status, payment_id, created_at, customer_name')
    .in('status', ['preparing', 'ready', 'completed', 'paid'])
    .not('payment_id', 'is', null)
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(50);

  if (oErr) return { error: sanitizeString(oErr.message || String(oErr), 200) };
  if (!orders || orders.length === 0) return [];

  // Check which ones have receipts
  const orderIds = orders.map(o => o.id);
  const { data: receipts, error: rErr } = await supabase
    .from('receipt_queue')
    .select('order_id')
    .in('order_id', orderIds);

  if (rErr) return { error: sanitizeString(rErr.message || String(rErr), 200) };

  const receiptSet = new Set((receipts || []).map(r => r.order_id));
  return orders
    .filter(o => !receiptSet.has(o.id))
    .map(o => ({
      order_id: o.id,
      status: o.status,
      payment_id: o.payment_id,
      customer: o.customer_name ? maskName(o.customer_name) : '(anonymous)',
      created: o.created_at,
      receipt_missing: true,
    }));
}

/**
 * Abandoned orders — specifically those moved from pending → abandoned by the cron.
 */
async function getAbandonedOrders(since, supabase) {
  const { data, error } = await supabase
    .from('orders')
    .select('id, status, payment_id, total_amount_cents, customer_name, customer_email, created_at, updated_at')
    .eq('status', 'abandoned')
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) return { error: sanitizeString(error.message || String(error), 200) };
  return (data || []).map(o => ({
    id: o.id,
    total_cents: o.total_amount_cents,
    customer: o.customer_name ? maskName(o.customer_name) : maskEmail(o.customer_email) || '(anonymous)',
    created: o.created_at,
    abandoned_at: o.updated_at,
    was_pending_for_min: o.updated_at && o.created_at
      ? Math.round((new Date(o.updated_at).getTime() - new Date(o.created_at).getTime()) / 60_000)
      : null,
  }));
}

/**
 * Loyalty sync errors from system_sync_logs.
 */
async function getSyncErrors(since, supabase) {
  const { data, error } = await supabase
    .from('system_sync_logs')
    .select('id, ts, source, profile_id, email, detail, sql_state, severity')
    .gte('ts', since)
    .order('ts', { ascending: false })
    .limit(50);

  if (error) {
    // Table might not exist yet
    if (/does not exist/i.test(String(error.message || ''))) {
      return { note: 'system_sync_logs table not found — run schema-40 to create it' };
    }
    return { error: sanitizeString(error.message || String(error), 200) };
  }
  return data || [];
}

/**
 * Recent order status transitions — last N orders with their current state,
 * useful for spotting race conditions (e.g., pending→abandoned→cash attempt).
 */
async function getRecentOrderAudit(since, supabase) {
  const { data, error } = await supabase
    .from('orders')
    .select('id, status, payment_id, total_amount_cents, customer_name, created_at, updated_at, completed_at')
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(30);

  if (error) return { error: sanitizeString(error.message || String(error), 200) };
  return (data || []).map(o => {
    const created = o.created_at ? new Date(o.created_at).getTime() : null;
    const updated = o.updated_at ? new Date(o.updated_at).getTime() : null;
    const completed = o.completed_at ? new Date(o.completed_at).getTime() : null;

    return {
      id: o.id,
      status: o.status,
      payment: o.payment_id || '(none)',
      total_cents: o.total_amount_cents,
      customer: o.customer_name ? maskName(o.customer_name) : '(anonymous)',
      created: o.created_at,
      updated: o.updated_at,
      time_to_update_min: updated && created ? Math.round((updated - created) / 60_000) : null,
      time_to_complete_min: completed && created ? Math.round((completed - created) / 60_000) : null,
    };
  });
}

// ── Main handler ────────────────────────────────────────────────

exports.handler = async (event) => {
  const hdrs = Object.keys(event.headers || {}).reduce((m, k) => (m[k.toLowerCase()] = event.headers[k], m), {});
  const origin = hdrs.origin;

  if (event.httpMethod === 'OPTIONS') {
    return jsonResponse(204, '', origin);
  }

  if (event.httpMethod !== 'GET') {
    return jsonResponse(405, { error: 'Method not allowed' }, origin);
  }

  // Manager-only
  const auth = await authorize(event, { requireManager: true });
  if (!auth.ok) return auth.response;

  // Fail-closed env guard
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('[OPS-DIAG] Missing Supabase configuration');
    return jsonResponse(500, { error: 'Server misconfiguration' }, origin);
  }

  // Per-request Supabase client
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

  try {
    const params = event.queryStringParameters || {};
    const scope = (params.scope || 'all').toLowerCase();
    const hours = Math.min(Math.max(parseInt(params.hours, 10) || 4, 1), 72); // 1–72 hours
    const since = new Date(Date.now() - hours * 3_600_000).toISOString();

    const result = {
      generated_at: new Date().toISOString(),
      lookback_hours: hours,
      scope,
    };

    const scopes = scope === 'all'
      ? ['orders', 'receipts', 'abandoned', 'sync', 'audit']
      : [scope];

    // Run requested diagnostics in parallel (pass supabase)
    const jobs = {};
    if (scopes.includes('orders'))    jobs.problematic_orders = getProblematicOrders(since, supabase);
    if (scopes.includes('receipts'))  jobs.receipt_gaps = getReceiptGaps(since, supabase);
    if (scopes.includes('abandoned')) jobs.abandoned_orders = getAbandonedOrders(since, supabase);
    if (scopes.includes('sync'))      jobs.sync_errors = getSyncErrors(since, supabase);
    if (scopes.includes('audit'))     jobs.recent_audit = getRecentOrderAudit(since, supabase);

    const keys = Object.keys(jobs);
    const values = await Promise.all(Object.values(jobs));
    for (let i = 0; i < keys.length; i++) {
      result[keys[i]] = values[i];
    }

    // Add summary counts
    result.summary = {};
    if (result.problematic_orders && Array.isArray(result.problematic_orders)) {
      result.summary.problematic = result.problematic_orders.length;
    }
    if (result.receipt_gaps && Array.isArray(result.receipt_gaps)) {
      result.summary.missing_receipts = result.receipt_gaps.length;
    }
    if (result.abandoned_orders && Array.isArray(result.abandoned_orders)) {
      result.summary.abandoned = result.abandoned_orders.length;
    }
    if (result.sync_errors && Array.isArray(result.sync_errors)) {
      result.summary.sync_errors = result.sync_errors.length;
    }

    console.log(`[OPS-DIAG] Manager ${maskEmail(auth.user?.email)} ran diagnostics: scope=${scope}, hours=${hours}`);

    return jsonResponse(200, result, origin);
  } catch (err) {
    console.error('[OPS-DIAG] Error:', String(err?.message || err).slice(0, 200));
    return jsonResponse(500, { error: 'Diagnostics query failed' }, origin);
  }
};
