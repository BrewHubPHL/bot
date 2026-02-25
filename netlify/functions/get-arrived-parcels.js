const { createClient } = require('@supabase/supabase-js');
const { authorize } = require('./_auth');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

function sanitize(text, max = 120) {
  if (typeof text !== 'string') return null;
  return text.replace(/[\x00-\x1F\x7F]/g, '').trim().slice(0, max);
}

function makeHeaders(origin) {
  const allowed = [process.env.URL, 'https://brewhubphl.com', 'https://www.brewhubphl.com'].filter(Boolean);
  const corsOrigin = allowed.includes(origin) ? origin : allowed[0];
  return {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': corsOrigin,
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-BrewHub-Action',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
  };
}

exports.handler = async (event) => {
  const headers = makeHeaders(event.headers?.origin || '');

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const auth = await authorize(event, { requirePin: true });
  if (!auth.ok) {
    return {
      statusCode: auth.response.statusCode,
      headers: { ...headers, ...(auth.response.headers || {}) },
      body: auth.response.body,
    };
  }

  try {
    // Fetch both arrived AND pending_notification (dead-letter) parcels for staff visibility
    const { data, error } = await supabase
      .from('parcels')
      .select('id, tracking_number, recipient_name, recipient_email, unit_number, status, received_at, estimated_value_tier')
      .in('status', ['arrived', 'pending_notification'])
      .order('received_at', { ascending: false })
      .limit(200);

    if (error) {
      return { statusCode: 500, headers, body: JSON.stringify({ error: 'Failed to load parcels' }) };
    }

    const STALE_DAYS = 14;
    const staleThreshold = Date.now() - STALE_DAYS * 24 * 60 * 60 * 1000;
    const snapshotAt = new Date().toISOString();
    const parcels = (data || []).map((row) => {
      const receivedMs = row.received_at ? new Date(row.received_at).getTime() : 0;
      return {
        id: row.id,
        tracking_number: sanitize(row.tracking_number, 80),
        recipient_name: sanitize(row.recipient_name, 120),
        unit_number: sanitize(row.unit_number, 20),
        status: row.status,
        received_at: row.received_at,
        estimated_value_tier: row.estimated_value_tier || 'standard',
        notification_failed: row.status === 'pending_notification',
        has_email: Boolean(row.recipient_email),
        is_stale: receivedMs > 0 && receivedMs < staleThreshold,
      };
    });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        parcels,
        snapshot_at: snapshotAt,
        freshness_ttl_ms: 60_000,
      }),
    };
  } catch {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Failed to load parcels' }) };
  }
};
