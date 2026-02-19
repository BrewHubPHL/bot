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

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Timing-safe secret comparison to prevent timing attacks
function safeCompare(a, b) {
  if (!a || !b) return false;
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

exports.handler = async (event, context) => {
  // Only allow scheduled/cron invocations — reject direct HTTP calls
  const isScheduled = context?.clientContext?.custom?.scheduled === true
    || event.headers?.['x-netlify-event'] === 'schedule';
  const hasCronSecret = safeCompare(
    event.headers?.['x-cron-secret'],
    process.env.CRON_SECRET
  );

  if (!isScheduled && !hasCronSecret) {
    return { statusCode: 403, body: JSON.stringify({ error: 'Forbidden' }) };
  }

  console.log('[STALE-ORDERS] Running stale order cleanup...');

  try {
    // Call the Postgres RPC that atomically cancels stale orders
    const { data, error } = await supabase.rpc('cancel_stale_orders', {
      stale_minutes: 30
    });

    if (error) {
      console.error('[STALE-ORDERS] RPC error:', error.message);
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'Stale order cleanup failed' })
      };
    }

    const cancelledCount = data ?? 0;

    if (cancelledCount > 0) {
      console.log(`[STALE-ORDERS] Cancelled ${cancelledCount} stale orders.`);
    } else {
      console.log('[STALE-ORDERS] No stale orders found.');
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        cancelled: cancelledCount,
        timestamp: new Date().toISOString()
      })
    };

  } catch (err) {
    console.error('[STALE-ORDERS] Unhandled error:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Internal server error' })
    };
  }
};
