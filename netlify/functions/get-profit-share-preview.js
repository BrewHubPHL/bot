// ═══════════════════════════════════════════════════════════════════════════
// get-profit-share-preview.js — Team Profit Share Preview (Manager Dashboard)
//
// Consumes the shared `computeProfitReport()` helper, then applies:
//   1. A $5,000 Profit Floor (500_000 cents)
//   2. A 10% Staff Pool allocation (1 000 basis points) on the surplus
//   3. A "Bonus per Hour" figure derived via integer minutes worked
//
// All monetary math uses integer cents and basis-point arithmetic —
// no floating-point multiplication on money.  Pool share is computed
// per-minute first, then scaled to per-hour to avoid the "fractional
// hour" float trap.
//
// If net profit is below the floor the pool is $0.
//
// GET ?month=YYYY-MM  (defaults to the current month)
//
// Response:
//   { month, net_profit_cents, profit_floor_cents, profit_above_floor_cents,
//     staff_pool_cents, staff_pool_display, total_staff_hours,
//     total_staff_minutes, bonus_per_hour_cents, bonus_per_hour_display,
//     floor_progress_pct, eligible_staff_count, pending_staff_count,
//     vesting_months, probation_days }
//
// SECURITY:
//   - Manager PIN session required (requireManager + requirePin)
//   - Optional view_finances permission check (falls back to manager role)
//   - CSRF header checked (defense-in-depth on GET)
//   - Rate limited via staffBucket
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
const { computeProfitReport, monthBounds: profitMonthBounds, centsToDisplay, MONTH_RE } = require('./_profit-report');

/* ── Constants ─────────────────────────────────────────── */
const PROFIT_FLOOR_CENTS = 500_000;          // $5,000
const STAFF_POOL_RATE_BPS = 1000;            // 1 000 basis points = 10 %
const BPS_DIVISOR         = 10_000;          // 1 basis point = 1/10 000
const VESTING_MONTHS = 6;                    // 6-month vesting period
const PROBATION_DAYS = 90;                   // 90-day probation hard-exclude
const MISSING_ENV = !process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY;

/* ── Helpers ───────────────────────────────────────────── */
function getClientIP(event) {
  return (
    event.headers['x-nf-client-connection-ip'] ||
    event.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
    'unknown'
  );
}

// centsToDisplay and monthBounds are now imported from _profit-report.js

/* ── Handler ───────────────────────────────────────────── */
exports.handler = async (event) => {
  // ── ENV guard ──────────────────────────────────────────
  if (MISSING_ENV) {
    return json(500, { error: 'Server misconfiguration' });
  }

  // ── Method gate ────────────────────────────────────────
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

  // ── CSRF (defense-in-depth on GET) ─────────────────────
  const csrfBlock = requireCsrfHeader(event);
  if (csrfBlock) return csrfBlock;

  // ── Auth: manager PIN session required ─────────────────
  const auth = await authorize(event, { requireManager: true, requirePin: true });
  if (!auth.ok) return auth.response;

  // ── Rate limiting ──────────────────────────────────────
  const clientIp = getClientIP(event);
  const userKey = String(auth.user?.email || 'unknown').toLowerCase();
  const rlKey = `profit-share:${userKey}:${clientIp}`;
  const rl = staffBucket.consume(rlKey);
  if (!rl.allowed) {
    return {
      statusCode: 429,
      headers: {
        'Content-Type': 'application/json',
        'Retry-After': String(Math.ceil(rl.retryAfterMs / 1000)),
      },
      body: JSON.stringify({ error: 'Too many requests' }),
    };
  }

  // ── Parse & validate month parameter ───────────────────
  const params = event.queryStringParameters || {};
  const rawMonth = params.month
    ? sanitizeInput(params.month, 7)
    : new Date().toISOString().slice(0, 7);

  if (!MONTH_RE.test(rawMonth)) {
    return json(400, { error: 'Invalid month format. Use YYYY-MM.' });
  }

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
  );

  try {
    // ── 1. Get base profit report ──────────────────────────
    const report = await computeProfitReport(supabase, rawMonth);

    // ── 2. Calculate staff pool (integer basis-point math) ─
    const netProfitCents = report.net_profit_cents;
    const profitAboveFloorCents = Math.max(0, netProfitCents - PROFIT_FLOOR_CENTS);
    // Basis-point formula: (cents × rate_bps) ÷ 10 000  — pure integer math,
    // no floating-point multiplication on money.
    const staffPoolCents = Math.floor(
      (profitAboveFloorCents * STAFF_POOL_RATE_BPS) / BPS_DIVISOR,
    );

    // Floor progress: what % of the way to $5k are we?
    const floorProgressPct =
      netProfitCents <= 0
        ? 0
        : Math.min(100, parseFloat(((netProfitCents / PROFIT_FLOOR_CENTS) * 100).toFixed(1)));

    // ── 3. Vesting & probation date boundaries ────────────
    const now = new Date();
    const vestingDate = new Date(now);
    vestingDate.setMonth(vestingDate.getMonth() - VESTING_MONTHS);
    const vestingDateISO = vestingDate.toISOString().slice(0, 10); // YYYY-MM-DD

    const probationDate = new Date(now);
    probationDate.setDate(probationDate.getDate() - PROBATION_DAYS);
    const probationDateISO = probationDate.toISOString().slice(0, 10);

    // ── 4. Total eligible staff hours (vested only) ────────
    const { start, end } = profitMonthBounds(rawMonth);

    // Fetch all time_logs for the month, joined with staff hire_date
    const { data: timeLogs, error: tlError } = await supabase
      .from('time_logs')
      .select('clock_in, clock_out, staff_id, staff_directory!inner(hire_date)')
      .gte('clock_in', start)
      .lt('clock_in', end)
      .not('clock_out', 'is', null);

    if (tlError) throw tlError;

    const logs = timeLogs || [];
    let totalEligibleMinutes = 0;
    const eligibleStaffIds = new Set();
    const pendingStaffIds = new Set();

    for (const log of logs) {
      const hireDate = log.staff_directory?.hire_date;
      if (!hireDate) continue; // skip orphan rows with no hire_date

      // Probation guard: employees hired within the last 90 days are hard-excluded
      if (hireDate > probationDateISO) {
        pendingStaffIds.add(log.staff_id);
        continue;
      }

      // 6-month vesting: only count hours for staff hired on or before vestingDate
      if (hireDate > vestingDateISO) {
        pendingStaffIds.add(log.staff_id);
        continue;
      }

      // Vested employee — count their minutes (integer)
      eligibleStaffIds.add(log.staff_id);
      const inMs = new Date(log.clock_in).getTime();
      const outMs = new Date(log.clock_out).getTime();
      if (outMs > inMs) {
        // Floor to whole minutes — avoids accumulating fractional floats
        totalEligibleMinutes += Math.floor((outMs - inMs) / 60_000);
      }
    }

    // totalEligibleMinutes is now a whole integer — no fractional hours involved
    const eligibleStaffCount = eligibleStaffIds.size;
    const pendingStaffCount = pendingStaffIds.size;

    // Display-only: total hours rounded to 2 dp (not used in any math)
    const totalStaffHours = parseFloat((totalEligibleMinutes / 60).toFixed(2));

    // ── 5. Bonus per hour (cents-per-minute path) ──────────
    // Compute via total minutes to sidestep the "fractional hour" float
    // trap.  Formula:  (poolCents × 60) ÷ totalMinutes  — all integers
    // until the final floor, so precision is exact.
    let bonusPerHourCents =
      totalEligibleMinutes > 0
        ? Math.floor((staffPoolCents * 60) / totalEligibleMinutes)
        : 0;

    if (bonusPerHourCents < 1) {
      bonusPerHourCents = 0;
    }

    // Log a warning if no staff are eligible yet (new shop scenario)
    if (eligibleStaffCount === 0 && pendingStaffCount > 0) {
      await logSystemError(supabase, {
        error_type: 'ops_info',
        severity: 'info',
        source_function: 'get-profit-share-preview',
        error_message: `No vested staff for ${rawMonth}. ${pendingStaffCount} employee(s) still in vesting/probation period.`,
      }).catch(() => {});
    }

    return json(200, {
      month: rawMonth,
      net_profit_cents: netProfitCents,
      net_profit_display: centsToDisplay(netProfitCents),
      profit_floor_cents: PROFIT_FLOOR_CENTS,
      profit_floor_display: centsToDisplay(PROFIT_FLOOR_CENTS),
      profit_above_floor_cents: profitAboveFloorCents,
      profit_above_floor_display: centsToDisplay(profitAboveFloorCents),
      staff_pool_cents: staffPoolCents,
      staff_pool_display: centsToDisplay(staffPoolCents),
      staff_pool_rate: STAFF_POOL_RATE_BPS / BPS_DIVISOR,   // 0.10 for backward compat
      staff_pool_rate_bps: STAFF_POOL_RATE_BPS,              // 1000 (canonical)
      total_staff_hours: totalStaffHours,                    // display-only
      total_staff_minutes: totalEligibleMinutes,             // integer, used in math
      bonus_per_hour_cents: bonusPerHourCents,
      bonus_per_hour_display: centsToDisplay(bonusPerHourCents),
      floor_progress_pct: floorProgressPct,
      eligible_staff_count: eligibleStaffCount,
      pending_staff_count: pendingStaffCount,
      vesting_months: VESTING_MONTHS,
      probation_days: PROBATION_DAYS,
      order_count: report.order_count,
      revenue_display: report.revenue_display,
    });
  } catch (err) {
    console.error('[PROFIT-SHARE] Failed:', err.message);
    await logSystemError(supabase, {
      error_type: 'db_query_failed',
      severity: 'warning',
      source_function: 'get-profit-share-preview',
      error_message: `Profit share preview failed: ${err.message}`,
    }).catch(() => {});
    return sanitizedError(err, 'get-profit-share-preview');
  }
};
