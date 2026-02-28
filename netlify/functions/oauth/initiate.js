const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');
const { authorize, json } = require('../_auth');
const { oauthBucket } = require('../_token-bucket');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const SQUARE_APP_ID = process.env.SQUARE_APP_ID;
const SQUARE_AUTHORIZE_URL = 'https://connect.squareup.com/oauth2/authorize';

exports.handler = async (event) => {
  // Per-IP rate limit on OAuth initiation
  const clientIp = event.headers['x-nf-client-connection-ip']
    || event.headers['x-forwarded-for']?.split(',')[0]?.trim()
    || 'unknown';
  const ipLimit = oauthBucket.consume('oauth-init:' + clientIp);
  if (!ipLimit.allowed) {
    return { statusCode: 429, body: JSON.stringify({ error: 'Too many requests. Please slow down.' }) };
  }

  // ── Centralized auth: require manager role ──────────────────
  // This enforces: staff_directory lookup, role check, revoked_users,
  // token version (fired-is-fired), and IP guard — all atomically.
  const auth = await authorize(event, { requireManager: true, requirePin: true });
  if (!auth.ok) return auth.response;
  const user = auth.user;

  // Generate a cryptographic random state token
  const state = crypto.randomBytes(32).toString('hex');

  // Store state in shop_settings with 10-minute expiry
  // shop_settings uses id (text PK) and text columns
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  const { error: storeErr } = await supabase
    .from('shop_settings')
    .upsert({
      id: 'oauth_state',
      access_token: JSON.stringify({ state, expires_at: expiresAt, user_id: user.id }),
      updated_at: new Date().toISOString()
    }, { onConflict: 'id' });

  if (storeErr) {
    console.error('[OAUTH] Failed to store state:', storeErr.message);
    return { statusCode: 500, body: JSON.stringify({ error: 'Failed to initiate OAuth' }) };
  }

  // Build Square authorization URL with state parameter
  const redirectUri = `${process.env.URL || 'https://brewhubphl.com'}/.netlify/functions/oauth-callback`;
  const params = new URLSearchParams({
    client_id: SQUARE_APP_ID,
    scope: 'MERCHANT_PROFILE_READ PAYMENTS_READ PAYMENTS_WRITE ORDERS_READ ORDERS_WRITE ITEMS_READ ITEMS_WRITE INVENTORY_READ INVENTORY_WRITE',
    session: 'false',
    state: state,
    redirect_uri: redirectUri
  });

  const authorizeUrl = `${SQUARE_AUTHORIZE_URL}?${params.toString()}`;

  return {
    statusCode: 302,
    headers: { Location: authorizeUrl },
    body: ''
  };
};
