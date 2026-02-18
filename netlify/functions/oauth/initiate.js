const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const SQUARE_APP_ID = process.env.SQUARE_APP_ID;
const SQUARE_AUTHORIZE_URL = 'https://connect.squareup.com/oauth2/authorize';

exports.handler = async (event) => {
  // Only managers should be starting OAuth — require auth header
  const authHeader = event.headers?.authorization;
  if (!authHeader) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  // Verify the caller is a logged-in manager via Supabase JWT
  const token = authHeader.replace('Bearer ', '');
  const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
  if (authErr || !user) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Invalid session' }) };
  }

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
