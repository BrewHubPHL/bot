/**
 * POST /.netlify/functions/join-waitlist
 *
 * Server-side waitlist signup endpoint. Replaces the previous
 * client-side Supabase insert that was vulnerable to botnet flooding.
 *
 * Defenses:
 *  - Strict CORS origin allowlist
 *  - CSRF custom-header check (X-BrewHub-Action: true)
 *  - IP-based token-bucket rate limiting (formBucket: 3 per 60 s)
 *  - Honeypot field detection (silent fake-success for bots)
 *  - Email format validation & length cap
 *  - Service-role insert (anon INSERT policy is now dropped)
 */

'use strict';

const { createClient } = require('@supabase/supabase-js');
const { requireCsrfHeader } = require('./_csrf');
const { formBucket } = require('./_token-bucket');
const { sanitizeInput } = require('./_sanitize');

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
  if (origin === '' && process.env.SITE_URL) return process.env.SITE_URL;
  return null;
}

function json(statusCode, data, origin) {
  const headers = {
    'Content-Type': 'application/json',
    'Vary': 'Origin',
  };
  if (origin) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Access-Control-Allow-Methods'] = 'POST, OPTIONS';
    headers['Access-Control-Allow-Headers'] = 'Content-Type, X-BrewHub-Action';
  }
  return { statusCode, headers, body: JSON.stringify(data) };
}

/* ── Simple email format check (RFC 5321 length cap) ── */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isValidEmail(str) {
  if (!str || str.length > 254) return false;
  return EMAIL_RE.test(str);
}

/* ── Handler ── */
exports.handler = async (event) => {
  const origin = validateOrigin(event.headers || {});

  /* CORS preflight */
  if (event.httpMethod === 'OPTIONS') {
    return json(200, {}, origin);
  }

  if (event.httpMethod !== 'POST') {
    return json(405, { success: false, error: 'Method not allowed' }, origin);
  }

  /* CSRF header check */
  const csrfBlock = requireCsrfHeader(event);
  if (csrfBlock) return csrfBlock;

  /* IP-based rate limit */
  const clientIp =
    event.headers['x-nf-client-connection-ip'] ||
    event.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
    'unknown';
  const rl = formBucket.consume('waitlist:' + clientIp);
  if (!rl.allowed) {
    return json(429, {
      success: false,
      error: 'Too many requests. Please wait a minute and try again.',
    }, origin);
  }

  try {
    const body = JSON.parse(event.body || '{}');
    const { email: rawEmail, honeypot, wl_company_name } = body;

    /* Honeypot: if filled, return fake success to fool bots */
    if (honeypot || wl_company_name) {
      return json(200, { success: true, message: "You've been added to the waitlist!" }, origin);
    }

    /* Sanitize & validate email */
    const email = sanitizeInput(rawEmail).toLowerCase().substring(0, 254);
    if (!isValidEmail(email)) {
      return json(400, { success: false, error: 'Please enter a valid email address.' }, origin);
    }

    /* Insert via service role (anon INSERT policy has been dropped) */
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    const { error: insertError } = await supabase
      .from('waitlist')
      .insert({ email });

    if (insertError) {
      /* 23505 = unique_violation — already on the list */
      if (insertError.code === '23505') {
        return json(200, {
          success: true,
          message: "You're already on the list! Check your inbox.",
        }, origin);
      }
      console.error('[JOIN-WAITLIST] Insert error:', insertError.message);
      return json(500, { success: false, error: 'Something went wrong. Please try again.' }, origin);
    }

    return json(200, {
      success: true,
      message: "You've been added to the waitlist!",
    }, origin);
  } catch (err) {
    console.error('[JOIN-WAITLIST] Error:', err);
    return json(500, { success: false, error: 'Something went wrong. Please try again.' }, origin);
  }
};
