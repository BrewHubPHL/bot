const { createClient } = require('@supabase/supabase-js');
const crypto = require('node:crypto');
const { validateWebhookSource, getClientIP } = require('./_ip-guard');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

/**
 * Constant-time string comparison to prevent timing attacks.
 */
function safeCompare(a, b) {
  if (!a || !b) return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

exports.handler = async (event) => {
  // 1. Security Layer 1: IP Allowlist (Defense in Depth)
  const ipCheck = validateWebhookSource(event, { allowSupabase: true, allowNetlify: true });
  if (!ipCheck.allowed) {
    console.error(`[WEBHOOK BLOCKED] IP not in allowlist: ${ipCheck.ip}`);
    // Don't reject yet - IP ranges may be incomplete. Log and continue to secret check.
  }

  // 2. Security Layer 2: Shared Secret (Primary Auth)
  // Uses timing-safe comparison with null guard
  const incomingSecret = event.headers['x-brewhub-secret'];
  const localSecret = process.env.SUPABASE_WEBHOOK_SECRET || process.env.INTERNAL_SYNC_SECRET;

  if (!incomingSecret || !localSecret || !safeCompare(incomingSecret, localSecret)) {
    console.error(`[WEBHOOK BLOCKED] Invalid secret from IP: ${getClientIP(event)}`);
    return { 
      statusCode: 401, 
      body: JSON.stringify({ error: "Unauthorized" }) 
    };
  }
  
  // Log successful auth for audit trail
  console.log(`[WEBHOOK] Authenticated from IP: ${ipCheck.ip}`);

  // 2. Parse the payload from Supabase
  const payload = JSON.parse(event.body || '{}');
  const { type, record } = payload;
  const eventId = payload.id || payload.event_id;

  // Idempotency: Deduplicate webhook retries using Supabase event ID
  if (eventId) {
    const { error: insertError } = await supabase
      .from('webhook_events')
      .insert({ event_id: String(eventId), source: 'supabase', payload });

    if (insertError) {
      if (insertError.code === '23505') {
        console.warn(`[WEBHOOK DUPLICATE] Event ${eventId} already processed.`);
        return {
          statusCode: 200,
          body: JSON.stringify({ message: 'Duplicate event ignored' })
        };
      }

      console.error('[WEBHOOK] Dedup insert failed:', insertError);
      return { statusCode: 500, body: 'Webhook dedup failed' };
    }
  } else {
    console.warn('[WEBHOOK] Missing event ID; deduplication skipped.');
  }

  console.log(`Processing ${type} for order: ${record?.id}`);

  let targetFunction = '';

  /**
   * ROUTING LOGIC:
   * * 1. NEW ORDERS (INSERT):
   * - We ONLY sync to Square if 'square_order_id' is missing.
   * - If 'square_order_id' exists, it means 'create-checkout.js' 
   * already handled the Square creation, so we skip it here.
   */
  if (type === 'INSERT' && !record.square_order_id) {
    targetFunction = 'square-sync';
  } 
  
  /**
   * NOTE: "Order Announcer" logic removed per request.
   * If you want to add other triggers (like sending emails on 'paid'),
   * add the 'UPDATE' logic here.
   */

  // 3. Forward the request to the appropriate service
  if (targetFunction) {
    try {
      // Use localhost:8888 for local dev, or the deployed URL
      const baseUrl = process.env.URL || 'http://localhost:8888';
      
      await fetch(`${baseUrl}/.netlify/functions/${targetFunction}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-brewhub-secret': process.env.INTERNAL_SYNC_SECRET
        },
        body: JSON.stringify({ record })
      });

      return { 
        statusCode: 200, 
        body: JSON.stringify({ message: `Routed to ${targetFunction}` }) 
      };
    } catch (err) {
      console.error(`Routing error to ${targetFunction}:`, err);
      return { statusCode: 500, body: "Internal Routing Error" };
    }
  }

  // Default response if no action is required
  return { 
    statusCode: 200, 
    body: JSON.stringify({ message: "No action required for this event." }) 
  };
};
