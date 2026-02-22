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

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const ALLOWED_ORIGIN = process.env.SITE_URL || 'https://brewhubphl.com';

const cors = (code, data) => ({
  statusCode: code,
  headers: {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-BrewHub-Action',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
  },
  body: JSON.stringify(data),
});

// ── Diagnostic queries ──────────────────────────────────────────

/**
 * Orders in non-normal states: abandoned, cancelled (by cron), amount_mismatch,
 * or orders stuck in pending for > 20 minutes.
 */
async function getProblematicOrders(since) {
  const { data, error } = await supabase
    .from('orders')
    .select('id, status, payment_id, total_amount_cents, customer_name, customer_email, created_at, updated_at')
    .or(`status.in.(abandoned,amount_mismatch),and(status.eq.pending,created_at.lt.${new Date(Date.now() - 20 * 60_000).toISOString()})`)
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) return { error: error.message };
  return (data || []).map(o => ({
    id: o.id,
    status: o.status,
    payment_id: o.payment_id || null,
    total_cents: o.total_amount_cents,
    customer: o.customer_name || o.customer_email || '(anonymous)',
    created: o.created_at,
    updated: o.updated_at,
    age_min: Math.round((Date.now() - new Date(o.created_at).getTime()) / 60_000),
  }));
}

/**
 * Recent orders that were completed/preparing/paid but have NO matching
 * receipt_queue row — i.e., the receipt was never generated.
 */
async function getReceiptGaps(since) {
  // Get recent orders that should have receipts
  const { data: orders, error: oErr } = await supabase
    .from('orders')
    .select('id, status, payment_id, created_at, customer_name')
    .in('status', ['preparing', 'ready', 'completed', 'paid'])
    .not('payment_id', 'is', null)
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(50);

  if (oErr) return { error: oErr.message };
  if (!orders || orders.length === 0) return [];

  // Check which ones have receipts
  const orderIds = orders.map(o => o.id);
  const { data: receipts, error: rErr } = await supabase
    .from('receipt_queue')
    .select('order_id')
    .in('order_id', orderIds);

  if (rErr) return { error: rErr.message };

  const receiptSet = new Set((receipts || []).map(r => r.order_id));
  return orders
    .filter(o => !receiptSet.has(o.id))
    .map(o => ({
      order_id: o.id,
      status: o.status,
      payment_id: o.payment_id,
      customer: o.customer_name || '(anonymous)',
      created: o.created_at,
      receipt_missing: true,
    }));
}

/**
 * Abandoned orders — specifically those moved from pending → abandoned by the cron.
 */
async function getAbandonedOrders(since) {
  const { data, error } = await supabase
    .from('orders')
    .select('id, status, payment_id, total_amount_cents, customer_name, customer_email, created_at, updated_at')
    .eq('status', 'abandoned')
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) return { error: error.message };
  return (data || []).map(o => ({
    id: o.id,
    total_cents: o.total_amount_cents,
    customer: o.customer_name || o.customer_email || '(anonymous)',
    created: o.created_at,
    abandoned_at: o.updated_at,
    was_pending_for_min: o.updated_at
      ? Math.round((new Date(o.updated_at).getTime() - new Date(o.created_at).getTime()) / 60_000)
      : null,
  }));
}

/**
 * Loyalty sync errors from system_sync_logs.
 */
async function getSyncErrors(since) {
  const { data, error } = await supabase
    .from('system_sync_logs')
    .select('id, ts, source, profile_id, email, detail, sql_state, severity')
    .gte('ts', since)
    .order('ts', { ascending: false })
    .limit(50);

  if (error) {
    // Table might not exist yet
    if (/does not exist/i.test(error.message)) {
      return { note: 'system_sync_logs table not found — run schema-40 to create it' };
    }
    return { error: error.message };
  }
  return data || [];
}

/**
 * Recent order status transitions — last N orders with their current state,
 * useful for spotting race conditions (e.g., pending→abandoned→cash attempt).
 */
async function getRecentOrderAudit(since) {
  const { data, error } = await supabase
    .from('orders')
    .select('id, status, payment_id, total_amount_cents, customer_name, created_at, updated_at, completed_at')
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(30);

  if (error) return { error: error.message };
  return (data || []).map(o => {
    const created = new Date(o.created_at).getTime();
    const updated = o.updated_at ? new Date(o.updated_at).getTime() : null;
    const completed = o.completed_at ? new Date(o.completed_at).getTime() : null;

    return {
      id: o.id,
      status: o.status,
      payment: o.payment_id || '(none)',
      total_cents: o.total_amount_cents,
      customer: o.customer_name || '(anonymous)',
      created: o.created_at,
      updated: o.updated_at,
      time_to_update_min: updated ? Math.round((updated - created) / 60_000) : null,
      time_to_complete_min: completed ? Math.round((completed - created) / 60_000) : null,
    };
  });
}

// ── Main handler ────────────────────────────────────────────────

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return cors(204, '');
  }

  if (event.httpMethod !== 'GET') {
    return cors(405, { error: 'Method not allowed' });
  }

  // Manager-only
  const auth = await authorize(event, { requireManager: true });
  if (!auth.ok) return auth.response;

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

    // Run requested diagnostics in parallel
    const jobs = {};
    if (scopes.includes('orders'))    jobs.problematic_orders = getProblematicOrders(since);
    if (scopes.includes('receipts'))  jobs.receipt_gaps = getReceiptGaps(since);
    if (scopes.includes('abandoned')) jobs.abandoned_orders = getAbandonedOrders(since);
    if (scopes.includes('sync'))      jobs.sync_errors = getSyncErrors(since);
    if (scopes.includes('audit'))     jobs.recent_audit = getRecentOrderAudit(since);

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

    console.log(`[OPS-DIAG] Manager ${auth.user?.email} ran diagnostics: scope=${scope}, hours=${hours}`);

    return cors(200, result);
  } catch (err) {
    console.error('[OPS-DIAG] Error:', err?.message || err);
    return cors(500, { error: 'Diagnostics query failed' });
  }
};
