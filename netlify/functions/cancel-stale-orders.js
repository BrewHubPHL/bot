/**
 * STALE ORDER CLEANER (Scheduled Cron)
 *
 * Cancels orders stuck in 'pending' or 'unpaid' for longer than 30 minutes.
 * Prevents ghost orders from cluttering KDS and inflating reports.
 *
 * Schedule: Every 5 minutes via Netlify Scheduled Functions
 *   → Configure in netlify.toml: [functions."cancel-stale-orders"] schedule = "@every 5m"
 *
 * Security:
 *   - Only accepts Netlify scheduled invocations or requests with CRON_SECRET header
 *   - Uses service role key (bypasses RLS)
 */

const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');

// Helpers
function safeCompare(a, b) {
  if (!a || !b) return false;
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function truncate(s, n = 200) {
  if (!s) return '';
  const str = String(s);
  return str.length > n ? str.slice(0, n) + '…' : str;
}

exports.handler = async (event, context) => {
  // Normalize headers to lowercase for robust lookup
  const hdrs = {};
  for (const k of Object.keys(event.headers || {})) {
    hdrs[k.toLowerCase()] = event.headers[k];
  }

  // Only allow scheduled/cron invocations — reject direct HTTP calls unless valid CRON_SECRET
  const isScheduled = context?.clientContext?.custom?.scheduled === true
    || hdrs['x-netlify-event'] === 'schedule';

  if (!process.env.CRON_SECRET) {
    console.error('[STALE-ORDERS] CRON_SECRET not configured — HTTP cron secret checks will be disabled for non-scheduled runs');
  }

  const hasCronSecret = process.env.CRON_SECRET
    ? safeCompare(hdrs['x-cron-secret'], process.env.CRON_SECRET)
    : false;

  if (!isScheduled && !hasCronSecret) {
    const outHeaders = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
    return { statusCode: 403, headers: outHeaders, body: JSON.stringify({ error: 'Forbidden' }) };
  }

  console.log('[STALE-ORDERS] Running stale order cleanup...');
  try {
    // Fail-closed if Supabase service role or URL not configured
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY || !process.env.SUPABASE_URL) {
      console.error('[STALE-ORDERS] Missing Supabase service role configuration');
      const outHeaders = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
      return {
        statusCode: 500,
        headers: outHeaders,
        body: JSON.stringify({ error: 'Server misconfiguration' })
      };
    }

    // Instantiate Supabase service-role client per-request (avoid module-scope long-lived client)
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

    // Call the Postgres RPC that atomically cancels stale orders with a timeout
    const rpcPromise = supabase.rpc('cancel_stale_orders', { stale_minutes: 30 });
    const RPC_TIMEOUT_MS = 30_000;

    let res;
    try {
      res = await Promise.race([
        rpcPromise,
        new Promise((_, reject) => setTimeout(() => reject(new Error('RPC timeout')), RPC_TIMEOUT_MS))
      ]);
    } catch (rpcErr) {
      console.error('[STALE-ORDERS] RPC call failed:', truncate(rpcErr?.message));
      const outHeaders = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
      return {
        statusCode: 500,
        headers: outHeaders,
        body: JSON.stringify({ error: 'Stale order cleanup failed' })
      };
    }

    // Supabase RPC returns an object `{ data, error }`
    const { data, error } = res || {};

    if (error) {
      console.error('[STALE-ORDERS] RPC error:', truncate(error?.message));
      const outHeaders = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
      return {
        statusCode: 500,
        headers: outHeaders,
        body: JSON.stringify({ error: 'Stale order cleanup failed' })
      };
    }

    // Normalize cancelled count safely
    let cancelledCount = 0;
    if (typeof data === 'number') cancelledCount = data;
    else if (Array.isArray(data)) cancelledCount = data.length;
    else if (data && typeof data.count === 'number') cancelledCount = data.count;
    else {
      const asNum = Number(data);
      cancelledCount = Number.isFinite(asNum) ? asNum : 0;
    }
    // Clamp to a reasonable maximum to avoid log floods
    cancelledCount = Math.max(0, Math.min(cancelledCount, 10000));

    if (cancelledCount > 0) {
      console.log(`[STALE-ORDERS] Cancelled ${cancelledCount} stale orders.`);
    } else {
      console.log('[STALE-ORDERS] No stale orders found.');
    }

    // Response headers — echo validated origin only
    const outHeaders = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
    const origin = hdrs['origin'];
    const allowlist = [process.env.SITE_URL, 'https://brewhubphl.com', 'https://www.brewhubphl.com'].filter(Boolean);
    if (origin && allowlist.includes(origin)) {
      outHeaders['Access-Control-Allow-Origin'] = origin;
      outHeaders['Vary'] = 'Origin';
    }

    return {
      statusCode: 200,
      headers: outHeaders,
      body: JSON.stringify({
        success: true,
        cancelled: cancelledCount,
        timestamp: new Date().toISOString()
      })
    };

  } catch (err) {
    console.error('[STALE-ORDERS] Unhandled error:', truncate(err?.message));
    const outHeaders = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
    return {
      statusCode: 500,
      headers: outHeaders,
      body: JSON.stringify({ error: 'Internal server error' })
    };
  }
};
