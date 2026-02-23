const { createClient } = require('@supabase/supabase-js');
const crypto = require('node:crypto');
const { validateWebhookSource, getClientIP } = require('./_ip-guard');
const { redactIP } = require('./_ip-hash');

function safeCompare(a, b) {
  if (!a || !b) return false;
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function truncate(s, n = 1000) {
  if (!s && s !== 0) return '';
  const str = typeof s === 'string' ? s : JSON.stringify(s);
  return str.length > n ? str.slice(0, n) + '…' : str;
}

function fetchWithTimeout(url, opts = {}, timeout = 10000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  return fetch(url, { ...opts, signal: controller.signal })
    .finally(() => clearTimeout(id));
}

exports.handler = async (event) => {
  // 1. Normalize headers and IP
  const hdrs = Object.keys(event.headers || {}).reduce((m, k) => (m[k.toLowerCase()] = event.headers[k], m), {});
  const clientIp = getClientIP(event);
  const ipCheck = validateWebhookSource(event, { allowSupabase: true, allowNetlify: true });
  if (!ipCheck.allowed) {
    console.warn(`[WEBHOOK] IP not in allowlist: ${redactIP(ipCheck.ip)}`);
    // Do not fail solely on IP mismatch; secret is the primary auth
  }

  // 2. Shared secret (fail-closed)
  const incomingSecret = hdrs['x-brewhub-secret'];
  const localSecret = process.env.SUPABASE_WEBHOOK_SECRET || process.env.INTERNAL_SYNC_SECRET;
  if (!localSecret) {
    console.error('[WEBHOOK] No webhook secret configured (SUPABASE_WEBHOOK_SECRET or INTERNAL_SYNC_SECRET)');
    return { statusCode: 500, body: JSON.stringify({ error: 'Server misconfiguration' }) };
  }
  if (!incomingSecret || !safeCompare(incomingSecret, localSecret)) {
    console.error(`[WEBHOOK BLOCKED] Invalid secret from IP: ${redactIP(clientIp)}`);
    return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  // Parse payload safely
  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch (e) {
    console.error('[WEBHOOK] Invalid JSON body');
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  const { type, record } = payload;
  const eventId = payload.id || payload.event_id;

  // Fail-closed: require Supabase service role to persist dedup records
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('[WEBHOOK] Missing Supabase configuration');
    return { statusCode: 500, body: JSON.stringify({ error: 'Server misconfiguration' }) };
  }

  // Create per-request Supabase client
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

  // Idempotency: Deduplicate webhook retries using Supabase event ID (store minimal/truncated payload)
  if (eventId) {
    try {
      const payloadText = truncate({ id: eventId, type, summary: payload?.record ? truncate(payload.record, 400) : undefined }, 1000);
      const { error: insertError } = await supabase
        .from('webhook_events')
        .insert({ event_id: String(eventId), source: 'supabase', received_at: new Date().toISOString(), payload_summary: payloadText });

      if (insertError) {
        if (insertError.code === '23505') {
          console.warn(`[WEBHOOK DUPLICATE] Event ${eventId} already processed.`);
          return { statusCode: 200, body: JSON.stringify({ message: 'Duplicate event ignored' }) };
        }
        console.error('[WEBHOOK] Dedup insert failed:', truncate(insertError.message || insertError, 200));
        return { statusCode: 500, body: JSON.stringify({ error: 'Webhook dedup failed' }) };
      }
    } catch (e) {
      console.error('[WEBHOOK] Dedup error:', truncate(e?.message || e, 200));
      return { statusCode: 500, body: JSON.stringify({ error: 'Webhook dedup failed' }) };
    }
  } else {
    console.warn('[WEBHOOK] Missing event ID; deduplication skipped.');
  }

  console.log(`[WEBHOOK] Authenticated event from IP: ${redactIP(clientIp)}; type=${String(type).slice(0,50)}`);

  let targetFunction = '';
  if (type === 'INSERT' && !record?.square_order_id) {
    targetFunction = 'square-sync';
  }

  if (targetFunction) {
    try {
      const baseUrl = process.env.URL || 'http://localhost:8888';
      await fetchWithTimeout(`${baseUrl}/.netlify/functions/${targetFunction}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-brewhub-secret': process.env.INTERNAL_SYNC_SECRET,
        },
        body: JSON.stringify({ record })
      }, 10000);

      return { statusCode: 200, body: JSON.stringify({ message: `Routed to ${targetFunction}` }) };
    } catch (err) {
      console.error(`Routing error to ${targetFunction}:`, truncate(err?.message || err, 200));
      return { statusCode: 502, body: JSON.stringify({ error: 'Internal Routing Error' }) };
    }
  }

  return { statusCode: 200, body: JSON.stringify({ message: 'No action required for this event.' }) };
};
