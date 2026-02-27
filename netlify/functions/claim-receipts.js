/**
 * POST /.netlify/functions/claim-receipts
 *
 * Atomic receipt claim endpoint for iPads and hardware print daemons.
 * Calls the claim_unprinted_receipts RPC which uses
 * SELECT … FOR UPDATE SKIP LOCKED to guarantee each receipt is
 * claimed by exactly one poller, eliminating duplicate prints.
 *
 * Defenses:
 *  - Strict CORS origin allowlist
 *  - CSRF header (X-BrewHub-Action: true)
 *  - Staff PIN / JWT auth via _auth.js
 *  - IP-based token-bucket rate limiting (staffBucket)
 */

'use strict';

const { createClient } = require('@supabase/supabase-js');
const { authorize, sanitizedError } = require('./_auth');
const { requireCsrfHeader } = require('./_csrf');
const { staffBucket } = require('./_token-bucket');

const MISSING_ENV = !process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY;

/* ── CORS origin allowlist ── */
const ALLOWED_ORIGINS = new Set(
  [
    process.env.SITE_URL,
    'https://brewhubphl.com',
    'https://www.brewhubphl.com',
  ].filter(Boolean)
);

function validateOrigin(headers) {
  const origin = headers['origin'] || headers['Origin'] || '';
  if (ALLOWED_ORIGINS.has(origin)) return origin;
  return null;
}

/* ── PII redaction (mirrors get-receipts.js) ── */
function redactPII(text) {
  if (!text) return text;
  let s = String(text);
  s = s.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/ig, '[REDACTED_EMAIL]');
  s = s.replace(/(\+?\d[\d\-\s()]{6,}\d)/g, '[REDACTED_PHONE]');
  return s;
}

const makeHeaders = (origin) => Object.assign(
  { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Vary': 'Origin' },
  origin ? { 'Access-Control-Allow-Origin': origin } : {}
);

exports.handler = async (event) => {
  const origin = validateOrigin(event.headers || {});
  const headers = makeHeaders(origin);

  if (MISSING_ENV) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Server misconfiguration' }) };
  }

  /* CORS preflight */
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: Object.assign({}, headers, {
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-BrewHub-Action',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
      }),
      body: '',
    };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  /* CSRF header check */
  const csrfBlock = requireCsrfHeader(event);
  if (csrfBlock) return csrfBlock;

  /* Staff-only auth (PIN or JWT) */
  const auth = await authorize(event);
  if (!auth.ok) {
    return Object.assign({}, auth.response, {
      headers: Object.assign({}, auth.response.headers || {}, headers),
    });
  }

  /* Rate limit per staff + IP */
  const clientIp =
    event.headers['x-nf-client-connection-ip'] ||
    event.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
    'unknown';
  const staffEmail =
    (auth.user && (auth.user.email || auth.user?.user?.email))
      ? String(auth.user.email || auth.user?.user?.email).toLowerCase()
      : 'unknown_staff';
  const rlKey = `claim:${staffEmail}:${clientIp}`;
  const rl = staffBucket.consume(rlKey);
  if (!rl.allowed) {
    return {
      statusCode: 429,
      headers: Object.assign({}, headers, {
        'Retry-After': String(Math.ceil(rl.retryAfterMs / 1000)),
      }),
      body: JSON.stringify({ error: 'Too many requests' }),
    };
  }

  try {
    /* Parse optional limit from body (default 5, max 20) */
    let limit = 5;
    if (event.body) {
      try {
        const body = JSON.parse(event.body);
        const parsed = Number(body.limit);
        if (Number.isFinite(parsed) && parsed > 0) {
          limit = Math.min(Math.max(1, Math.floor(parsed)), 20);
        }
      } catch { /* ignore malformed body — use default */ }
    }

    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

    const { data, error } = await supabase.rpc('claim_unprinted_receipts', { p_limit: limit });

    if (error) throw error;

    const receipts = (data || []).map((r) => {
      let txt = String(r.receipt_text || '').slice(0, 2000);
      txt = redactPII(txt);
      return { id: r.id, order_id: r.order_id, receipt_text: txt, created_at: r.created_at };
    });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ claimed: receipts.length, receipts }),
    };
  } catch (err) {
    const res = sanitizedError(err, 'claim-receipts');
    res.headers = Object.assign({}, res.headers || {}, headers);
    return res;
  }
};
