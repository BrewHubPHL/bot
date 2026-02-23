// Public config endpoint for client-side Square SDK
// Only exposes values that are safe to be public
const { publicBucket } = require('./_token-bucket');

// --- Strict CORS allowlist ---
const ALLOWED_ORIGINS = new Set([
  process.env.URL, // Netlify deploy URL
  'https://brewhubphl.com',
  'https://www.brewhubphl.com',
].filter(Boolean));

function validateOrigin(headers) {
  const requestOrigin = (headers || {}).origin || (headers || {}).Origin || '';
  if (requestOrigin && ALLOWED_ORIGINS.has(requestOrigin)) return requestOrigin;
  return null;
}

exports.handler = async (event) => {
  const origin = validateOrigin(event.headers || {});
  const baseHeaders = {
    'Content-Type': 'application/json',
    'Cache-Control': 'public, max-age=300', // 5 min cache
    'Vary': 'Origin',
  };
  const headers = origin ? Object.assign({}, baseHeaders, { 'Access-Control-Allow-Origin': origin }) : baseHeaders;

  if (event.httpMethod === 'OPTIONS') {
    const optHeaders = Object.assign({}, headers);
    if (origin) {
      optHeaders['Access-Control-Allow-Methods'] = 'GET, OPTIONS';
      optHeaders['Access-Control-Allow-Headers'] = 'Content-Type, Authorization';
      optHeaders['Access-Control-Allow-Origin'] = origin;
    }
    return { statusCode: 200, headers: optHeaders, body: '' };
  }

  // Per-IP rate limiting — use shared global bucket if IP not available
  const rawIp = event.headers['x-nf-client-connection-ip'] || event.headers['x-forwarded-for']?.split(',')[0]?.trim();
  const clientIp = rawIp || null;
  const bucketKey = clientIp ? `public-config:${clientIp}` : 'public-config:global';
  const ipLimit = publicBucket.consume(bucketKey);
  if (!ipLimit.allowed) {
    return {
      statusCode: 429,
      headers: Object.assign({}, headers, { 'Retry-After': String(Math.ceil(ipLimit.retryAfterMs / 1000)) }),
      body: JSON.stringify({ error: 'Too many requests. Please try again shortly.' }),
    };
  }

  // Ensure public values exist (do not leak secrets). Log if missing but still return safe response.
  const missing = !process.env.SQUARE_PRODUCTION_APPLICATION_ID || !process.env.SQUARE_LOCATION_ID;
  if (missing) console.warn('public-config: missing SQUARE env vars');
  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({
      squareAppId: process.env.SQUARE_PRODUCTION_APPLICATION_ID || '',
      squareLocationId: process.env.SQUARE_LOCATION_ID || '',
      _warning: missing ? 'Some public env values are not set on this deployment' : undefined,
    }),
  };
};
