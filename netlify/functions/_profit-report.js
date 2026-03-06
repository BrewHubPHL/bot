// ═══════════════════════════════════════════════════════════════════════════
// _profit-report.js — Shared profit-computation logic
//
// Consumed by:
//   • get-true-profit-report.js   (HTTP API for the Manager Dashboard)
//   • cron-monthly-financial-summary.js (scheduled email digest)
//
// Keeps the business logic in one place so changes propagate automatically.
// ═══════════════════════════════════════════════════════════════════════════

'use strict';

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/**
 * Convert integer cents to a locale-formatted US-dollar string.
 * This is the single source of truth for server-side display formatting.
 */
function centsToDisplay(cents) {
  return (cents / 100).toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/**
 * Derive UTC start (inclusive) / end (exclusive) bounds for a YYYY-MM string.
 */
function monthBounds(monthStr) {
  const [year, month] = monthStr.split('-').map(Number);
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 1));
  return { start: start.toISOString(), end: end.toISOString() };
}

/**
 * Compute the profitability summary for a given month.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string} monthStr  YYYY-MM
 * @returns {Promise<{
 *   month: string,
 *   revenue_cents: number,
 *   revenue_display: string,
 *   maintenance_cost_cents: number,
 *   maintenance_cost_display: string,
 *   net_profit_cents: number,
 *   net_profit_display: string,
 *   maintenance_to_revenue_ratio: number,
 *   maintenance_to_revenue_pct: string,
 *   order_count: number,
 *   maintenance_event_count: number,
 * }>}
 */
async function computeProfitReport(supabase, monthStr, { productionOnly = true } = {}) {
  if (!MONTH_RE.test(monthStr)) {
    throw new Error(`Invalid month format: "${monthStr}". Use YYYY-MM.`);
  }

  const { start, end } = monthBounds(monthStr);

  // Parallel queries: completed-order revenue + maintenance costs + operating expenses
  //
  // We prefer the `agg_maintenance_costs` RPC which uses
  //   COALESCE(SUM(COALESCE(cost, 0) * 100), 0)::bigint
  // so NULL costs can never silently become NaN in JavaScript.
  // If the RPC is not yet deployed we fall back to the row-level approach
  // with an explicit null guard.
  // Orders query: try with data_integrity_level filter first; if the column
  // hasn't been deployed yet (schema 94), fall back to unfiltered query so
  // the profit report still renders while migrations are pending.
  const ordersQuery = async () => {
    const base = () => supabase
      .from('orders')
      .select('total_amount_cents')
      .eq('status', 'completed')
      .gte('created_at', start)
      .lt('created_at', end);

    if (!productionOnly) return base();

    const result = await base().eq('data_integrity_level', 'production');
    if (result.error && /data_integrity_level|column.*does not exist/i.test(result.error.message || '')) {
      console.warn('[PROFIT-REPORT] data_integrity_level column not found, querying without filter.');
      return base();
    }
    return result;
  };

  const [ordersResult, maintRpcResult, opexResult, cogsRpcResult] = await Promise.all([
    ordersQuery(),

    supabase
      .rpc('agg_maintenance_costs', {
        start_date: start.slice(0, 10),
        end_date:   end.slice(0, 10),
      }),

    // Operating expenses (rent, payroll, COGS, etc.) from property_expenses
    // due within the target month.  Amounts are stored as numeric dollars;
    // we convert to cents in JS after the query.
    supabase
      .from('property_expenses')
      .select('amount, category')
      .gte('due_date', start.slice(0, 10))
      .lt('due_date', end.slice(0, 10)),

    // Automated COGS from inventory consumption (schema 96)
    supabase
      .rpc('agg_inventory_cogs', {
        start_date: start.slice(0, 10),
        end_date:   end.slice(0, 10),
      }),
  ]);

  // Explicit Supabase error checks (non-negotiable)
  if (ordersResult.error) throw ordersResult.error;

  const orders = ordersResult.data || [];

  const revenueCents = orders.reduce(
    (sum, o) => sum + (Number(o.total_amount_cents) || 0),
    0,
  );

  let maintenanceCostCents;
  let maintenanceEventCount;

  if (!maintRpcResult.error && maintRpcResult.data) {
    // RPC returns a single-row TABLE — Supabase JS wraps it in an array
    const row = Array.isArray(maintRpcResult.data)
      ? maintRpcResult.data[0]
      : maintRpcResult.data;
    maintenanceCostCents = Number(row?.total_cost_cents) || 0;
    maintenanceEventCount = Number(row?.event_count) || 0;
  } else {
    // Fallback: row-level fetch + JS aggregation (for pre-migration envs)
    console.warn('[PROFIT-REPORT] agg_maintenance_costs RPC unavailable, falling back to JS aggregation.', maintRpcResult.error?.message);
    const { data: maintenanceLogs, error: maintFallbackErr } = await supabase
      .from('maintenance_logs')
      .select('cost')
      .not('cost', 'is', null)          // skip NULLs at the DB level
      .gte('performed_at', start.slice(0, 10))
      .lt('performed_at', end.slice(0, 10));

    if (maintFallbackErr) throw maintFallbackErr;

    const logs = maintenanceLogs || [];
    maintenanceCostCents = logs.reduce(
      (sum, m) => sum + Math.round(Number(m.cost) * 100),
      0,
    );
    maintenanceEventCount = logs.length;
  }

  // ── Operating Expenses (OpEx) ─────────────────────────────
  // property_expenses.amount is stored in dollars (numeric).
  // If the table/query is unavailable we default to 0 so the
  // report still renders — but flag a warning.
  let opexCents = 0;
  let opexEventCount = 0;

  if (!opexResult.error && opexResult.data) {
    const opexRows = opexResult.data || [];
    opexCents = opexRows.reduce(
      (sum, row) => sum + Math.round((Number(row.amount) || 0) * 100),
      0,
    );
    opexEventCount = opexRows.length;
  } else {
    console.warn('[PROFIT-REPORT] property_expenses query unavailable, OpEx defaults to $0.', opexResult.error?.message);
  }

  // ── Automated COGS (inventory consumption) ─────────────────
  let cogsCents = 0;
  let cogsEventCount = 0;

  if (!cogsRpcResult.error && cogsRpcResult.data) {
    const row = Array.isArray(cogsRpcResult.data)
      ? cogsRpcResult.data[0]
      : cogsRpcResult.data;
    cogsCents = Number(row?.total_cogs_cents) || 0;
    cogsEventCount = Number(row?.consumption_events) || 0;
  } else {
    console.warn('[PROFIT-REPORT] agg_inventory_cogs RPC unavailable, COGS defaults to $0.', cogsRpcResult.error?.message);
  }

  // ── Net Profit = Revenue − Maintenance − OpEx − COGS ─────
  // Aligns with Employment Addendum: "Revenue minus all Operating
  // Expenses (OpEx), including rent, payroll, COGS, and Equipment
  // Maintenance Costs."
  const totalExpensesCents = maintenanceCostCents + opexCents + cogsCents;
  const netProfitCents = revenueCents - totalExpensesCents;

  const maintenanceToRevenueRatio =
    revenueCents > 0
      ? parseFloat((maintenanceCostCents / revenueCents).toFixed(4))
      : 0;

  return {
    month: monthStr,
    revenue_cents: revenueCents,
    revenue_display: centsToDisplay(revenueCents),
    maintenance_cost_cents: maintenanceCostCents,
    maintenance_cost_display: centsToDisplay(maintenanceCostCents),
    opex_cents: opexCents,
    opex_display: centsToDisplay(opexCents),
    cogs_cents: cogsCents,
    cogs_display: centsToDisplay(cogsCents),
    total_expenses_cents: totalExpensesCents,
    total_expenses_display: centsToDisplay(totalExpensesCents),
    net_profit_cents: netProfitCents,
    net_profit_display: centsToDisplay(netProfitCents),
    maintenance_to_revenue_ratio: maintenanceToRevenueRatio,
    maintenance_to_revenue_pct: `${(maintenanceToRevenueRatio * 100).toFixed(2)}%`,
    order_count: orders.length,
    maintenance_event_count: maintenanceEventCount,
    opex_event_count: opexEventCount,
    cogs_event_count: cogsEventCount,
  };
}

/* ── Vesting validation helper ──────────────────────────────────── */
const VESTING_MONTHS = 6;
const PROBATION_DAYS = 90;

/**
 * Check whether a staff member is eligible for profit-share payouts.
 * Returns { eligible: true } or { eligible: false, reason: string }.
 *
 * @param {string} hireDateStr  ISO date (YYYY-MM-DD) from staff_directory.hire_date
 * @param {Date}   [asOf]       Reference date (defaults to now)
 */
function checkVestingEligibility(hireDateStr, asOf) {
  const now = asOf || new Date();

  const probationCutoff = new Date(now);
  probationCutoff.setDate(probationCutoff.getDate() - PROBATION_DAYS);

  const vestingCutoff = new Date(now);
  vestingCutoff.setMonth(vestingCutoff.getMonth() - VESTING_MONTHS);

  if (hireDateStr > probationCutoff.toISOString().slice(0, 10)) {
    return { eligible: false, reason: `Still within ${PROBATION_DAYS}-day probation period` };
  }

  if (hireDateStr > vestingCutoff.toISOString().slice(0, 10)) {
    return { eligible: false, reason: `Has not completed ${VESTING_MONTHS}-month vesting period` };
  }

  return { eligible: true, reason: null };
}

module.exports = { computeProfitReport, monthBounds, centsToDisplay, MONTH_RE, checkVestingEligibility, VESTING_MONTHS, PROBATION_DAYS };
