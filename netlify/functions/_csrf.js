// ─── _csrf.js ─── Anti-CSRF helper for Netlify functions ───
// Requires the custom header X-BrewHub-Action: true on all
// state-mutating (POST/PUT/PATCH/DELETE) requests.
//
// Browsers block custom headers on cross-origin requests
// unless the server explicitly permits them via CORS preflight.
// Because our CORS only allows our own origin, a cross-site
// form or fetch from an attacker's page can never attach this
// header, effectively killing CSRF.

const HEADER_NAME = 'x-brewhub-action'; // lower-cased by Netlify
const HEADER_VALUE = 'true';

/**
 * Returns a 403 response if the CSRF header is missing or wrong.
 * Returns null when the header is valid (caller should proceed).
 *
 * Usage:
 *   const block = requireCsrfHeader(event);
 *   if (block) return block;
 *
 * @param {object} event  Netlify function event
 * @returns {object|null}
 */
function requireCsrfHeader(event) {
  const method = (event.httpMethod || '').toUpperCase();
  // Only enforce on mutating methods
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) return null;

  const value = event.headers?.[HEADER_NAME];
  if (value === HEADER_VALUE) return null;

  console.warn(`[CSRF] Blocked ${method} ${event.path} — missing/invalid ${HEADER_NAME} header`);
  return {
    statusCode: 403,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ error: 'Forbidden: missing CSRF header' }),
  };
}

module.exports = { requireCsrfHeader, HEADER_NAME };
