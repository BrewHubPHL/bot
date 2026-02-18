/**
 * BrewHub Security: IP Whitelisting & Webhook Verification
 * 
 * This module provides IP-based access control for webhook endpoints.
 * Use this to ensure only Square and Supabase can trigger webhooks.
 */

// Square IP ranges (as of 2024 - verify at https://developer.squareup.com)
// Square uses AWS IP ranges, so we validate the signature instead of IP
const SQUARE_SIGNATURE_REQUIRED = true;

// Supabase Edge Functions originate from these IP ranges
// See: https://supabase.com/docs/guides/functions/cicd-workflow
// Note: These may change - Supabase recommends signature-based auth
const SUPABASE_IP_RANGES = [
  '54.65.',     // AWS Tokyo
  '13.112.',    // AWS Tokyo
  '35.75.',     // AWS Tokyo
  '52.69.',     // AWS Tokyo
  '54.238.',    // AWS Tokyo
  '54.199.',    // AWS Tokyo
  '52.192.',    // AWS Tokyo
  '52.68.',     // AWS Tokyo
  // Add more ranges as needed from Supabase docs
];

// Netlify's own IP (for internal function-to-function calls)
const NETLIFY_INTERNAL = [
  '127.0.0.1',
  '::1',
];

/**
 * Extract client IP from Netlify function event
 */
function getClientIP(event) {
  // Netlify provides the real client IP in these headers
  return event.headers['x-nf-client-connection-ip'] 
    || event.headers['x-forwarded-for']?.split(',')[0]?.trim()
    || event.headers['client-ip']
    || 'unknown';
}

/**
 * Check if IP matches any allowed range
 */
function isIPInRanges(ip, ranges) {
  if (!ip || ip === 'unknown') return false;
  return ranges.some(range => ip.startsWith(range));
}

/**
 * Validate that request comes from expected source
 * 
 * @param {object} event - Netlify function event
 * @param {object} options - { allowSupabase: boolean, allowNetlify: boolean }
 * @returns {{ allowed: boolean, ip: string, reason: string }}
 */
function validateWebhookSource(event, options = {}) {
  const { allowSupabase = false, allowNetlify = false } = options;
  const ip = getClientIP(event);
  
  const allowedRanges = [];
  if (allowSupabase) allowedRanges.push(...SUPABASE_IP_RANGES);
  if (allowNetlify) allowedRanges.push(...NETLIFY_INTERNAL);
  
  if (allowedRanges.length === 0) {
    return { allowed: false, ip, reason: 'No IP ranges configured' };
  }
  
  const allowed = isIPInRanges(ip, allowedRanges);
  
  return {
    allowed,
    ip,
    reason: allowed ? 'IP in allowlist' : `IP ${ip} not in allowed ranges`
  };
}

/**
 * Generate HMAC signature for Supabase webhook validation
 * (Supabase doesn't have built-in HMAC, but you can configure it)
 */
function verifySupabaseSignature(event, secret) {
  const signature = event.headers['x-supabase-signature'];
  if (!signature) return { valid: false, reason: 'Missing signature header' };
  
  const crypto = require('crypto');
  const payload = event.body || '';
  const expected = crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('hex');
  
  const sigBuf = Buffer.from(signature);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length) {
    return { valid: false, reason: 'Signature length mismatch' };
  }
  const valid = crypto.timingSafeEqual(sigBuf, expBuf);
  
  return { valid, reason: valid ? 'Signature valid' : 'Signature mismatch' };
}

module.exports = {
  getClientIP,
  validateWebhookSource,
  verifySupabaseSignature,
  SUPABASE_IP_RANGES,
};
