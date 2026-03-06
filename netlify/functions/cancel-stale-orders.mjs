/**
 * STALE ORDER CLEANER (Scheduled Cron — v2 ESM)
 *
 * Cancels orders stuck in 'pending' or 'unpaid' for longer than 30 minutes.
 * Prevents ghost orders from cluttering KDS and inflating reports.
 *
 * Schedule: Every 5 minutes via Netlify Scheduled Functions v2
 *
 * Security:
 *   - Only accepts Netlify scheduled invocations or requests with CRON_SECRET header
 *   - Uses service role key (bypasses RLS)
 */

import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

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

function jsonResponse(code, data, extraHeaders = {}) {
  const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...extraHeaders };
  return new Response(JSON.stringify(data), { status: code, headers });
}

export default async function handler(req, context) {
  const hdrs = {};
  for (const [k, v] of req.headers.entries()) {
    hdrs[k.toLowerCase()] = v;
  }

  // Only allow scheduled/cron invocations
  if (!process.env.CRON_SECRET) {
    console.error('[STALE-ORDERS] CRON_SECRET not configured');
  }

  const hasCronSecret = process.env.CRON_SECRET
    ? safeCompare(hdrs['x-cron-secret'], process.env.CRON_SECRET)
    : false;

  if (!hasCronSecret) {
    return jsonResponse(403, { error: 'Forbidden' });
  }

  console.log('[STALE-ORDERS] Running stale order cleanup...');
  try {
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY || !process.env.SUPABASE_URL) {
      console.error('[STALE-ORDERS] Missing Supabase service role configuration');
      return jsonResponse(500, { error: 'Server misconfiguration' });
    }

    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

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
      return jsonResponse(500, { error: 'Stale order cleanup failed' });
    }

    const { data, error } = res || {};

    if (error) {
      console.error('[STALE-ORDERS] RPC error:', truncate(error?.message));
      return jsonResponse(500, { error: 'Stale order cleanup failed' });
    }

    let cancelledCount = 0;
    if (typeof data === 'number') cancelledCount = data;
    else if (Array.isArray(data)) cancelledCount = data.length;
    else if (data && typeof data.count === 'number') cancelledCount = data.count;
    else {
      const asNum = Number(data);
      cancelledCount = Number.isFinite(asNum) ? asNum : 0;
    }
    cancelledCount = Math.max(0, Math.min(cancelledCount, 10000));

    if (cancelledCount > 0) {
      console.log(`[STALE-ORDERS] Cancelled ${cancelledCount} stale orders.`);
    } else {
      console.log('[STALE-ORDERS] No stale orders found.');
    }

    const respHeaders = {};
    const origin = hdrs['origin'];
    const allowlist = [process.env.SITE_URL, 'https://brewhubphl.com', 'https://www.brewhubphl.com'].filter(Boolean);
    if (origin && allowlist.includes(origin)) {
      respHeaders['Access-Control-Allow-Origin'] = origin;
      respHeaders['Vary'] = 'Origin';
    }

    return jsonResponse(200, {
      success: true,
      cancelled: cancelledCount,
      timestamp: new Date().toISOString()
    }, respHeaders);

  } catch (err) {
    console.error('[STALE-ORDERS] Unhandled error:', truncate(err?.message));
    return jsonResponse(500, { error: 'Internal server error' });
  }
}

export const config = {
  schedule: "*/5 * * * *"
};
