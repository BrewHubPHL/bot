// Public config endpoint for client-side Square SDK
// Only exposes values that are safe to be public
const { publicBucket } = require('./_token-bucket');

// --- Strict CORS allowlist ---
const ALLOWED_ORIGINS = [
  process.env.URL,                   // Netlify deploy URL
  'https://brewhubphl.com',
  'https://www.brewhubphl.com',
].filter(Boolean);

function corsOrigin(event) {
  const requestOrigin = (event.headers || {}).origin || (event.headers || {}).Origin;
  if (requestOrigin && ALLOWED_ORIGINS.includes(requestOrigin)) return requestOrigin;
  return 'https://brewhubphl.com'; // strict default
}

exports.handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': corsOrigin(event),
    'Cache-Control': 'public, max-age=300', // 5 min cache
    'Vary': 'Origin',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  // Per-IP rate limiting
  const clientIp = event.headers['x-nf-client-connection-ip']
    || event.headers['x-forwarded-for']?.split(',')[0]?.trim()
    || 'unknown';
  const ipLimit = publicBucket.consume('config:' + clientIp);
  if (!ipLimit.allowed) {
    return {
      statusCode: 429,
      headers: { ...headers, 'Retry-After': String(Math.ceil(ipLimit.retryAfterMs / 1000)) },
      body: JSON.stringify({ error: 'Too many requests. Please try again shortly.' }),
    };
  }

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({
      squareAppId: process.env.SQUARE_PRODUCTION_APPLICATION_ID,
      squareLocationId: process.env.SQUARE_LOCATION_ID,
    }),
  };
};
