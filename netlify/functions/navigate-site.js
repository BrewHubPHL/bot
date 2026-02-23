/**
 * GET/POST /api/navigate (or /.netlify/functions/navigate-site)
 * 
 * API endpoint for AI agents to get navigation links for the BrewHub website.
 * No authentication required - this is public site info.
 * 
 * Query params (GET) or body (POST):
 * - destination: Where to navigate (menu, shop, loyalty, parcels, etc.)
 */

const { publicBucket } = require('./_token-bucket');

const SITE_PAGES = {
  'menu': { url: 'https://brewhubphl.com/cafe', description: 'View our cafe menu and place an order' },
  'cafe': { url: 'https://brewhubphl.com/cafe', description: 'View our cafe menu and place an order' },
  'order': { url: 'https://brewhubphl.com/cafe', description: 'Place a coffee or food order' },
  'shop': { url: 'https://brewhubphl.com/shop', description: 'Browse our merchandise and coffee beans' },
  'merch': { url: 'https://brewhubphl.com/shop', description: 'Browse our merchandise' },
  'checkout': { url: 'https://brewhubphl.com/checkout', description: 'Complete your purchase' },
  'cart': { url: 'https://brewhubphl.com/checkout', description: 'View your cart and checkout' },
  'loyalty': { url: 'https://brewhubphl.com/portal', description: 'View your loyalty points and QR code' },
  'points': { url: 'https://brewhubphl.com/portal', description: 'Check your rewards points' },
  'rewards': { url: 'https://brewhubphl.com/portal', description: 'View your loyalty rewards' },
  'portal': { url: 'https://brewhubphl.com/portal', description: 'Access your account dashboard' },
  'account': { url: 'https://brewhubphl.com/portal', description: 'Manage your account' },
  'login': { url: 'https://brewhubphl.com/portal', description: 'Sign in to your account' },
  'signin': { url: 'https://brewhubphl.com/portal', description: 'Sign in to your account' },
  'parcels': { url: 'https://brewhubphl.com/parcels', description: 'Check on your packages' },
  'packages': { url: 'https://brewhubphl.com/parcels', description: 'Track and manage your parcels' },
  'mailbox': { url: 'https://brewhubphl.com/resident', description: 'Mailbox rental information' },
  'waitlist': { url: 'https://brewhubphl.com/waitlist', description: 'Join our waitlist for updates' },
  'contact': { url: 'mailto:info@brewhubphl.com', description: 'Get in touch with us' },
  'email': { url: 'mailto:info@brewhubphl.com', description: 'Email us at info@brewhubphl.com' },
  'home': { url: 'https://brewhubphl.com', description: 'Go to our homepage' },
  'privacy': { url: 'https://brewhubphl.com/privacy', description: 'Read our privacy policy' },
  'terms': { url: 'https://brewhubphl.com/terms', description: 'Read our terms of service' },
};

// --- Strict CORS allowlist ---
const ALLOWED_ORIGINS = [
  process.env.URL, // Netlify deploy URL
  'https://brewhubphl.com',
  'https://www.brewhubphl.com',
].filter(Boolean);

function corsOrigin(requestOrigin) {
  if (!requestOrigin) return undefined;
  return ALLOWED_ORIGINS.includes(requestOrigin) ? requestOrigin : undefined;
}

function sanitizeString(s, max = 200) {
  if (!s) return '';
  const str = String(s).replace(/<[^>]*>?/g, '').trim();
  return str.length > max ? str.slice(0, max) : str;
}

function json(status, data, event) {
  const hdrs = (event && event.headers)
    ? Object.keys(event.headers).reduce((acc, k) => (acc[k.toLowerCase()] = event.headers[k], acc), {})
    : {};
  const origin = hdrs.origin;
  const validated = corsOrigin(origin);
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
  };
  if (validated) {
    headers['Access-Control-Allow-Origin'] = validated;
    headers['Vary'] = 'Origin';
  }
  return { statusCode: status, headers, body: JSON.stringify(data) };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return json(200, {}, event);
  }

  // Per-IP rate limit (normalize headers and use shared bucket for unknown)
  const hdrs = Object.keys(event.headers || {}).reduce((m, k) => (m[k.toLowerCase()] = event.headers[k], m), {});
  const clientIp = hdrs['x-nf-client-connection-ip'] || (hdrs['x-forwarded-for'] || '').split(',')[0]?.trim() || null;
  const bucketKey = clientIp ? `nav:${clientIp}` : 'nav:global';
  const ipLimit = publicBucket.consume(bucketKey);
  if (!ipLimit.allowed) {
    return json(429, { success: false, error: 'Too many requests.' }, event);
  }

  // Parse destination from query string or body
  let destination;
  
  if (event.httpMethod === 'GET') {
    destination = (event.queryStringParameters || {}).destination;
  } else {
    let parsed;
    try {
      parsed = JSON.parse(event.body || '{}');
    } catch (e) {
      return json(400, { success: false, error: 'Invalid JSON body' }, event);
    }
    destination = parsed.destination;
  }

  // If no destination, return all available pages
  if (!destination) {
    return json(200, {
      success: true,
      available_pages: Object.keys(SITE_PAGES).filter((v, i, a) => {
        // Dedupe by URL
        const url = SITE_PAGES[v].url;
        return a.findIndex(k => SITE_PAGES[k].url === url) === i;
      }),
      message: 'Provide a destination parameter to get the link. Available: menu, shop, checkout, loyalty, parcels, waitlist, contact, home'
    }, event);
  }

  if (typeof destination !== 'string') {
    return json(400, { success: false, error: 'destination must be a string' }, event);
  }
  const dest = sanitizeString(destination).toLowerCase().trim();
  const page = SITE_PAGES[dest];

  if (page) {
    return json(200, {
      success: true,
      destination: dest,
      url: page.url,
      description: page.description,
      message: `${page.description}: ${page.url}`
    }, event);
  }

  // Destination not found
  return json(404, {
    success: false,
    error: `Unknown destination: ${dest}`,
    available_pages: ['menu', 'shop', 'checkout', 'loyalty', 'parcels', 'waitlist', 'contact', 'home'],
    message: 'I can help you find: menu, shop, checkout, loyalty portal, parcels, waitlist, contact, or home.'
  }, event);
};
