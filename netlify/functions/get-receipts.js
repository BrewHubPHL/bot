// get-receipts.js — Server-side proxy for ReceiptRoll.
// Returns the latest receipts from receipt_queue using service_role
// to bypass RLS restrictions on the anon key.

const { createClient } = require('@supabase/supabase-js');
const { authorize, json, sanitizedError } = require('./_auth');
const { publicBucket } = require('./_token-bucket');

const MISSING_ENV = !process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY;

const ALLOWED_ORIGINS = new Set([
  process.env.SITE_URL,
  'https://brewhubphl.com',
  'https://www.brewhubphl.com',
].filter(Boolean));

function validateOrigin(headers) {
  const origin = headers['origin'] || headers['Origin'] || '';
  if (ALLOWED_ORIGINS.has(origin)) return origin;
  return null;
}

function redactPII(text) {
  if (!text) return text;
  let s = String(text);
  // redact emails
  s = s.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/ig, '[REDACTED_EMAIL]');
  // redact likely phone numbers (simple heuristic)
  s = s.replace(/(\+?\d[\d\-\s()]{6,}\d)/g, '[REDACTED_PHONE]');
  return s;
}

const makeHeaders = (origin) => Object.assign({ 'Content-Type': 'application/json', 'Cache-Control': 'no-cache', 'Vary': 'Origin' }, origin ? { 'Access-Control-Allow-Origin': origin } : {});

exports.handler = async (event) => {
  const origin = validateOrigin(event.headers || {});
  const headers = makeHeaders(origin);

  if (MISSING_ENV) return { statusCode: 500, headers, body: JSON.stringify({ error: 'Server misconfiguration' }) };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: Object.assign({}, headers, { 'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Access-Control-Allow-Methods': 'GET, OPTIONS' }), body: '' };
  }

  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  // Staff-only (PIN or JWT)
  const auth = await authorize(event);
  if (!auth.ok) return Object.assign({}, auth.response, { headers: Object.assign({}, auth.response.headers || {}, headers) });

  // rate limit per-staff+IP
  const clientIp = event.headers['x-nf-client-connection-ip'] || event.headers['x-forwarded-for']?.split(',')[0]?.trim() || 'unknown';
  const staffEmail = (auth.user && (auth.user.email || auth.user?.user?.email)) ? String(auth.user.email || auth.user?.user?.email).toLowerCase() : 'unknown_staff';
  const rlKey = `receipts:${staffEmail}:${clientIp}`;
  const rl = publicBucket.consume(rlKey);
  if (!rl.allowed) {
    return { statusCode: 429, headers: Object.assign({}, headers, { 'Retry-After': String(Math.ceil(rl.retryAfterMs / 1000)) }), body: JSON.stringify({ error: 'Too many requests' }) };
  }

  try {
    const params = event.queryStringParameters || {};
    let limit = Number(params.limit);
    if (!Number.isFinite(limit) || limit <= 0) limit = 10;
    limit = Math.min(Math.max(1, Math.floor(limit)), 100);

    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

    const { data, error } = await supabase
      .from('receipt_queue')
      .select('id, receipt_text, created_at')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) throw error;

    const receipts = (data || []).map(r => {
      let txt = String(r.receipt_text || '').slice(0, 2000);
      // NOTE: Do NOT apply sanitizeInput() here — it collapses \s{2,}
      // (newlines + alignment spaces) into single spaces, destroying the
      // 32-column fixed-width receipt layout.  Receipt text is generated
      // server-side by _receipt.js and rendered in a React <pre> tag
      // (auto-escaped), so XSS risk is negligible.  redactPII is safe
      // because it only targets email/phone patterns without touching
      // whitespace structure.
      txt = redactPII(txt);
      return { id: r.id, receipt_text: txt, created_at: r.created_at };
    });

    return { statusCode: 200, headers, body: JSON.stringify({ receipts }) };
  } catch (err) {
    const res = sanitizedError(err, 'get-receipts');
    res.headers = Object.assign({}, res.headers || {}, headers);
    return res;
  }
};
