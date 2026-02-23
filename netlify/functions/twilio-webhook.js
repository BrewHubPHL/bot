// ═══════════════════════════════════════════════════════════════════════════
// twilio-webhook.js — Inbound SMS Webhook for Opt-Out Compliance
// ═══════════════════════════════════════════════════════════════════════════
//
// Twilio forwards every inbound SMS to this endpoint.
// Handles the required TCPA stop-words:
//   STOP / STOPALL / UNSUBSCRIBE / CANCEL / END  → record opt-out
//   START / YES / UNSTOP                          → record opt-in
//   HELP / INFO                                   → auto-reply with info
//
// Configure in Twilio Console → Phone Numbers → Messaging:
//   Webhook URL: https://brewhubphl.com/.netlify/functions/twilio-webhook
//   Method: POST
//
// NOTE: Twilio's Advanced Opt-Out also handles STOP at the carrier level,
// but we ALSO record it in our DB so the pre-send check catches it.
// Defense in depth — belt AND suspenders.
// ═══════════════════════════════════════════════════════════════════════════

const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');
const { normalizePhone } = require('./_sms');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Twilio stop words per https://www.twilio.com/docs/messaging/guides/opt-out-keywords
const STOP_WORDS = new Set(['stop', 'stopall', 'unsubscribe', 'cancel', 'end', 'quit']);
const START_WORDS = new Set(['start', 'yes', 'unstop']);
const HELP_WORDS = new Set(['help', 'info']);

/**
 * Validate that the request genuinely came from Twilio.
 * Uses the X-Twilio-Signature header with HMAC-SHA1.
 * See: https://www.twilio.com/docs/usage/security
 */
function validateTwilioSignature(url, params, signature) {
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!authToken) return false;

  // Build the data string: URL + sorted param key/value pairs
  const sortedKeys = Object.keys(params).sort();
  let data = url;
  for (const key of sortedKeys) {
    data += key + (params[key] || '');
  }

  const expected = crypto
    .createHmac('sha1', authToken)
    .update(data, 'utf-8')
    .digest('base64');

  // Constant-time comparison
  if (expected.length !== signature.length) return false;
  return crypto.timingSafeEqual(
    Buffer.from(expected, 'utf-8'),
    Buffer.from(signature, 'utf-8')
  );
}

/**
 * Build a TwiML response (Twilio's XML format).
 */
function twimlResponse(message) {
  if (!message) {
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'text/xml' },
      body: '<?xml version="1.0" encoding="UTF-8"?><Response></Response>',
    };
  }
  const escaped = message.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'text/xml' },
    body: `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escaped}</Message></Response>`,
  };
}

exports.handler = async (event) => {
  // ── Only accept POST ─────────────────────────────────────
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  // ── Parse form body ──────────────────────────────────────
  let params = {};
  try {
    const raw = event.body || '';
    if (event.isBase64Encoded) {
      const decoded = Buffer.from(raw, 'base64').toString('utf-8');
      params = Object.fromEntries(new URLSearchParams(decoded));
    } else {
      params = Object.fromEntries(new URLSearchParams(raw));
    }
  } catch {
    return { statusCode: 400, body: 'Invalid body' };
  }

  // ── Validate Twilio signature ────────────────────────────
  const signature = (event.headers || {})['x-twilio-signature'] || (event.headers || {})['X-Twilio-Signature'];
  if (!signature) {
    console.warn('[Twilio Webhook] Missing X-Twilio-Signature — rejecting');
    return { statusCode: 403, body: 'Forbidden' };
  }

  // Reconstruct the URL Twilio used to sign (must match exactly)
  const proto = (event.headers || {})['x-forwarded-proto'] || 'https';
  const host = (event.headers || {}).host || 'brewhubphl.com';
  const path = event.path || '/.netlify/functions/twilio-webhook';
  const fullUrl = `${proto}://${host}${path}`;

  if (!validateTwilioSignature(fullUrl, params, signature)) {
    console.warn('[Twilio Webhook] Invalid signature — rejecting');
    return { statusCode: 403, body: 'Invalid signature' };
  }

  // ── Extract message fields ───────────────────────────────
  const from = params.From || '';
  const body = (params.Body || '').trim();
  const keyword = body.toLowerCase().replace(/[^a-z]/g, '');
  const phoneE164 = normalizePhone(from);

  if (!phoneE164) {
    console.warn(`[Twilio Webhook] Invalid from number: ${from}`);
    return twimlResponse(null);
  }

  console.log(`[Twilio Webhook] Inbound from ${phoneE164}: "${body}" → keyword "${keyword}"`);

  // ── Handle STOP ──────────────────────────────────────────
  if (STOP_WORDS.has(keyword)) {
    console.log(`[Twilio Webhook] OPT-OUT: ${phoneE164}`);
    const { error } = await supabase.rpc('record_sms_opt_out', {
      p_phone_e164: phoneE164,
      p_source: 'twilio_stop',
      p_source_detail: `Inbound keyword: ${body}`,
      p_twilio_sid: params.MessageSid || null,
    });
    if (error) {
      console.error('[Twilio Webhook] Failed to record opt-out:', error.message);
    }
    // Twilio's Advanced Opt-Out will also send the carrier-level STOP reply,
    // but we send our own for belt-and-suspenders:
    return twimlResponse(
      'You have been unsubscribed from BrewHub PHL messages. ' +
      'Reply START to resubscribe. ' +
      'For help, contact info@brewhubphl.com'
    );
  }

  // ── Handle START ─────────────────────────────────────────
  if (START_WORDS.has(keyword)) {
    console.log(`[Twilio Webhook] OPT-IN: ${phoneE164}`);
    const { error } = await supabase.rpc('record_sms_resubscribe', {
      p_phone_e164: phoneE164,
      p_source: 'twilio_start',
      p_source_detail: `Inbound keyword: ${body}`,
      p_twilio_sid: params.MessageSid || null,
    });
    if (error) {
      console.error('[Twilio Webhook] Failed to record opt-in:', error.message);
    }
    return twimlResponse(
      'Welcome back to BrewHub PHL notifications! ' +
      'You will receive delivery and loyalty updates. ' +
      'Reply STOP at any time to unsubscribe.'
    );
  }

  // ── Handle HELP ──────────────────────────────────────────
  if (HELP_WORDS.has(keyword)) {
    return twimlResponse(
      'BrewHub PHL — Msg & data rates may apply. ' +
      'Reply STOP to cancel. ' +
      'For support: info@brewhubphl.com or (267) 225-7891.'
    );
  }

  // ── Unknown keyword — ignore silently ────────────────────
  // Per CTIA guidelines, don't reply to every random text
  console.log(`[Twilio Webhook] Unrecognized message from ${phoneE164} — no reply`);
  return twimlResponse(null);
};
