/**
 * pin-logout.js — Clear the HttpOnly session cookie.
 *
 * Called by OpsGate on logout. Sets Max-Age=0 to delete the cookie
 * that pin-login.js creates.
 */
exports.handler = async (event) => {
  const ALLOWED_ORIGIN = process.env.SITE_URL || 'https://brewhubphl.com';

  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Credentials': 'true',
      },
      body: '',
    };
  }

  const isProduction = !['localhost', '127.0.0.1'].includes(
    (event.headers?.host || '').split(':')[0]
  );

  const clearCookie = [
    'hub_staff_session=deleted',
    'HttpOnly',
    'SameSite=Strict',
    'Path=/',
    'Max-Age=0', // immediately expire
    isProduction ? 'Secure' : '',
  ].filter(Boolean).join('; ');

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
      'Access-Control-Allow-Credentials': 'true',
      'Set-Cookie': clearCookie,
    },
    body: JSON.stringify({ success: true }),
  };
};
