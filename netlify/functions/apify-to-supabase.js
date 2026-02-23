const { createClient } = require('@supabase/supabase-js');
const { verifyServiceSecret } = require('./_auth');

// Lightweight in-memory dedupe for recently-processed dataset IDs (TTL, best-effort)
const _recentDatasets = new Map();

function _now() { return Date.now(); }

exports.handler = async (event) => {
  // Fail-closed env checks
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const APIFY_TOKEN = process.env.APIFY_TOKEN;
  const APIFY_MAX_ITEMS = parseInt(process.env.APIFY_MAX_ITEMS || '1000', 10);
  const UPSERT_CHUNK = parseInt(process.env.UPSERT_CHUNK || '200', 10);
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !APIFY_TOKEN) {
    console.error('Missing required service envs');
    return { statusCode: 500, body: 'Server misconfigured' };
  }

  // Auth: Apify webhook must include our sync secret
  const serviceAuth = verifyServiceSecret(event);
  if (!serviceAuth.valid) return serviceAuth.response;

  // Safe JSON parse
  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (err) {
    return { statusCode: 400, body: 'Invalid JSON' };
  }

  const datasetId = body?.resource?.defaultDatasetId;
  if (!datasetId) return { statusCode: 400, body: 'Missing Dataset ID' };

  // Simple dedupe: ignore identical dataset notifications within 60s window
  try {
    const prev = _recentDatasets.get(datasetId);
    const now = _now();
    if (prev && (now - prev) < 60_000) {
      console.warn('Duplicate dataset webhook ignored:', datasetId);
      return { statusCode: 202, body: 'Duplicate recent webhook ignored' };
    }
    _recentDatasets.set(datasetId, now);
    // Clear old entries opportunistically
    for (const [k, ts] of _recentDatasets.entries()) if ((now - ts) > 300_000) _recentDatasets.delete(k);
  } catch (err) {
    // Non-fatal
    console.warn('Dedupe check failed', err);
  }

  // fetchWithTimeout helper
  const fetchWithTimeout = async (url, opts = {}, timeout = 15_000) => {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeout);
    try {
      return await fetch(url, { ...opts, signal: controller.signal });
    } finally {
      clearTimeout(id);
    }
  };

  // Helper sanitizers
  const neutralizeLeadingFormula = (s) => {
    if (s == null) return s;
    let str = String(s);
    if (/^[=+\-@]/.test(str)) str = ' ' + str;
    if (str.length > 1024) str = str.slice(0, 1024);
    return str;
  };
  const safeInt = (v) => { const n = parseInt(v || 0, 10); return Number.isFinite(n) ? n : 0; };
  const safeTimestamp = (v) => { const d = new Date(v); return isNaN(d.getTime()) ? null : d.toISOString(); };

  // Build Apify URL WITHOUT token in querystring. Use Authorization header.
  const apifyUrl = `https://api.apify.com/v2/datasets/${encodeURIComponent(datasetId)}/items`;
  const headers = { Authorization: `Bearer ${APIFY_TOKEN}`, Accept: 'application/json' };

  try {
    const resp = await fetchWithTimeout(apifyUrl, { headers }, 15_000);
    if (!resp.ok) {
      console.error('Apify fetch failed', resp.status);
      return { statusCode: 502, body: 'Upstream fetch failed' };
    }

    const items = await resp.json();
    if (!Array.isArray(items)) {
      console.error('Unexpected items shape from Apify');
      return { statusCode: 502, body: 'Upstream response invalid' };
    }

    const total = items.length;
    console.log(`[APIFY] Received ${total} items`);

    // Cap large datasets to avoid memory/DB storms
    const maxItems = Math.max(0, APIFY_MAX_ITEMS || 1000);
    const truncated = total > maxItems;
    const limitedItems = truncated ? items.slice(0, maxItems) : items;

    // Map + sanitize
    const cleanItems = limitedItems
      .filter(post => safeInt(post.likesCount) > 20)
      .map(post => ({
        id: neutralizeLeadingFormula(post.url || post.id || ''),
        username: neutralizeLeadingFormula(post.ownerUsername || post.username || ''),
        caption: neutralizeLeadingFormula(post.caption || ''),
        image_url: neutralizeLeadingFormula(post.displayUrl || post.image_url || ''),
        likes: safeInt(post.likesCount),
        posted_at: safeTimestamp(post.timestamp || post.date)
      }));

    console.log(`[APIFY] ${cleanItems.length} items after filter${truncated ? ' (truncated)' : ''}`);

    // Per-request Supabase client (avoid module-scope service role client)
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Chunked upsert to avoid large single transactions
    for (let i = 0; i < cleanItems.length; i += UPSERT_CHUNK) {
      const chunk = cleanItems.slice(i, i + UPSERT_CHUNK);
      const { error } = await supabase.from('local_mentions').upsert(chunk, { onConflict: 'id' });
      if (error) {
        console.error('Supabase upsert error (chunk start):', i, error.message || error);
        return { statusCode: 500, body: 'DB upsert failed' };
      }
    }

    return { statusCode: 200, body: `Synced ${cleanItems.length} items.` };
  } catch (err) {
    console.error('Sync Error:', (err && err.message) || err);
    return { statusCode: 500, body: 'Sync Failed' };
  }
};