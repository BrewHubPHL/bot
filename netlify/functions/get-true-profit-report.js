// ═══════════════════════════════════════════════════════════════════════════
// get-true-profit-report.js — True Profitability Report (Manager Dashboard)
//
// Pulls total revenue from the orders table (Square-confirmed payments)
// and subtracts total maintenance costs from maintenance_logs for a given
// month.  Returns a summary suitable for the Manager Dashboard
// "Profitability" card.
//
// GET ?month=YYYY-MM  (defaults to the current month)
//
// Response:
//   { month, revenue_cents, maintenance_cost_cents, net_profit_cents,
//     maintenance_to_revenue_ratio, order_count, maintenance_event_count }
//
// SECURITY:
//   - Manager PIN session required (requireManager + requirePin)
//   - CSRF header checked (no-op on GET but present for defense-in-depth)
//   - Rate limited via staffBucket (per manager + IP)
//   - Input sanitisation on query parameters
//   - Supabase errors explicitly checked (no silent failures)
// ═══════════════════════════════════════════════════════════════════════════

'use strict';

const { createClient } = require('@supabase/supabase-js');
const { authorize, json, sanitizedError } = require('./_auth');
const { requireCsrfHeader } = require('./_csrf');
const { sanitizeInput } = require('./_sanitize');
const { staffBucket } = require('./_token-bucket');
const { logSystemError } = require('./_system-errors');
const { computeProfitReport, MONTH_RE } = require('./_profit-report');

const MISSING_ENV = !process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY;

function getClientIP(event) {
  return (
    event.headers['x-nf-client-connection-ip'] ||
    event.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
    'unknown'
  );
}

exports.handler = async (event) => {
  // ── ENV guard ──────────────────────────────────────────────
  if (MISSING_ENV) {
    return json(500, { error: 'Server misconfiguration' });
  }

  // ── Method gate ────────────────────────────────────────────
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: {
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-BrewHub-Action',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
      },
      body: '',
    };
  }
  if (event.httpMethod !== 'GET') {
    return json(405, { error: 'Method not allowed' });
  }

  // ── CSRF (no-op for GET, but called for parity / defense-in-depth) ──
  const csrfBlock = requireCsrfHeader(event);
  if (csrfBlock) return csrfBlock;

  // ── Auth: manager PIN session required ─────────────────────
  const auth = await authorize(event, { requireManager: true, requirePin: true });
  if (!auth.ok) return auth.response;

  // ── Rate limiting ──────────────────────────────────────────
  const clientIp = getClientIP(event);
  const managerEmail = String(auth.user?.email || 'unknown').toLowerCase();
  const rlKey = `profit-report:${managerEmail}:${clientIp}`;
  const rl = staffBucket.consume(rlKey);
  if (!rl.allowed) {
    return {
      statusCode: 429,
      headers: { 'Content-Type': 'application/json', 'Retry-After': String(Math.ceil(rl.retryAfterMs / 1000)) },
      body: JSON.stringify({ error: 'Too many requests' }),
    };
  }

  // ── Parse & validate month parameter ───────────────────────
  const params = event.queryStringParameters || {};
  const rawMonth = params.month
    ? sanitizeInput(params.month, 7)
    : new Date().toISOString().slice(0, 7); // default: current month

  if (!MONTH_RE.test(rawMonth)) {
    return json(400, { error: 'Invalid month format. Use YYYY-MM.' });
  }

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
  );

  try {
    const report = await computeProfitReport(supabase, rawMonth);
    return json(200, report);
  } catch (err) {
    console.error('[PROFIT-REPORT] Failed:', err.message);
    await logSystemError(supabase, {
      error_type: 'db_query_failed',
      severity: 'warning',
      source_function: 'get-true-profit-report',
      error_message: `Profit report failed: ${err.message}`,
    }).catch(() => {});
    return sanitizedError(err, 'get-true-profit-report');
  }
};
