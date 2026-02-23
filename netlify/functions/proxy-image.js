const fetch = require('node-fetch');

// Trusted hostnames
const TRUSTED_HOSTNAMES = [
  'brewhubphl.com',
  'www.brewhubphl.com',
  'storage.googleapis.com',
  'i.imgur.com',
];

const ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  const raw = q.u;
  if (!raw) return { statusCode: 400, body: 'Missing url' };

  let u;
  try {
    u = new URL(raw);
  } catch {
    return { statusCode: 400, body: 'Invalid url' };
  }

  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && u.hostname === 'localhost')) {
    return { statusCode: 400, body: 'Invalid protocol' };
  }

  const hn = u.hostname.toLowerCase();
  if (!TRUSTED_HOSTNAMES.some(t => hn === t || hn.endsWith('.' + t))) {
    return { statusCode: 403, body: 'Host not allowed' };
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    const res = await fetch(u.href, { signal: controller.signal });
    clearTimeout(timeout);

    if (!res.ok) return { statusCode: 502, body: 'Upstream fetch failed' };

    const contentType = res.headers.get('content-type') || '';
    if (!ALLOWED_TYPES.some(t => contentType.startsWith(t))) {
      return { statusCode: 415, body: 'Unsupported media type' };
    }

    const buffer = await res.arrayBuffer();
    const b64 = Buffer.from(buffer).toString('base64');
    const body = b64;

    return {
      statusCode: 200,
      isBase64Encoded: true,
      headers: {
        'Content-Type': contentType.split(';')[0],
        'Cache-Control': 'public, max-age=300',
      },
      body,
    };
  } catch (err) {
    console.error('proxy-image error', err?.message || err);
    return { statusCode: 502, body: 'Fetch error' };
  }
};
