const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');
const { SquareClient, SquareEnvironment } = require('square');
const { oauthBucket } = require('../_token-bucket');

/**
 * Constant-time comparison to prevent timing attacks on state tokens.
 */
function safeCompare(a, b) {
  if (!a || !b) return false;
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

exports.handler = async (event) => {
  // Normalize headers (case-insensitive) and apply per-IP rate limit
  const headers = {};
  for (const k of Object.keys(event.headers || {})) headers[k.toLowerCase()] = event.headers[k];
  const clientIp = headers['x-nf-client-connection-ip'] || headers['x-forwarded-for']?.split(',')[0]?.trim() || headers['x-real-ip'] || 'unknown';
  const ipLimit = oauthBucket.consume('oauth-cb:' + clientIp);
  if (!ipLimit.allowed) {
    return { statusCode: 429, body: JSON.stringify({ error: 'Too many requests.' }) };
  }

  // Extract the authorization code and state sent by Square
  const { code, state } = event.queryStringParameters || {};

  if (!code) {
    return { 
      statusCode: 400, 
      body: JSON.stringify({ error: "Missing authorization code from Square." }) 
    };
  }

  // --- Anti-CSRF: Validate state parameter ---
  if (!state) {
    console.error('[OAUTH] Missing state parameter — possible CSRF attempt');
    return {
      statusCode: 400,
      body: JSON.stringify({ error: "Missing state parameter. Please restart the authorization flow." })
    };
  }

  // Fail-closed env checks and per-request clients
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const SQUARE_APP_ID = process.env.SQUARE_APP_ID || process.env.SQUARE_PRODUCTION_APPLICATION_ID;
  const SQUARE_CLIENT_SECRET = process.env.SQUARE_PRODUCTION_ID_SECRET || process.env.SQUARE_PRODUCTION_TOKEN;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !SQUARE_APP_ID || !SQUARE_CLIENT_SECRET) {
    console.error('Missing required environment variables for OAuth callback');
    return { statusCode: 500, body: JSON.stringify({ error: 'Server misconfigured' }) };
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // Retrieve the stored state from shop_settings
  const { data: stored, error: fetchErr } = await supabase
    .from('shop_settings')
    .select('access_token')
    .eq('id', 'oauth_state')
    .maybeSingle();

  if (fetchErr || !stored?.access_token) {
    console.error('[OAUTH] Could not retrieve stored state:', fetchErr?.message);
    return {
      statusCode: 400,
      body: JSON.stringify({ error: "No pending authorization found. Please restart the flow." })
    };
  }

  // State is stored as JSON string in access_token column
  let storedState;
  try {
    storedState = JSON.parse(stored.access_token);
  } catch {
    console.error('[OAUTH] Corrupt stored state');
    return { statusCode: 400, body: JSON.stringify({ error: "Invalid authorization state. Please restart." }) };
  }
  if (!storedState || !storedState.state || !storedState.expires_at) {
    console.error('[OAUTH] Incomplete stored state');
    return { statusCode: 400, body: JSON.stringify({ error: "Invalid authorization state. Please restart." }) };
  }

  // Check expiry (10-minute window set during initiation)
  if (new Date(storedState.expires_at) < new Date()) {
    console.error('[OAUTH] State token expired');
    // Clean up expired state
    await supabase.from('shop_settings').delete().eq('id', 'oauth_state');
    return {
      statusCode: 400,
      body: JSON.stringify({ error: "Authorization expired. Please restart the flow." })
    };
  }

  // Constant-time comparison of state tokens
  if (!safeCompare(state, storedState.state)) {
    console.error('[OAUTH] State mismatch — CSRF attempt blocked');
    return {
      statusCode: 403,
      body: JSON.stringify({ error: "State validation failed. Authorization denied." })
    };
  }

  // State is valid — consume it (one-time use)
  await supabase.from('shop_settings').delete().eq('id', 'oauth_state');

  try {
    // Initialize Square client for production (per-request)
    const client = new SquareClient({ environment: SquareEnvironment.Production });

    // Exchange the Auth Code for Production Tokens (wrap with timeout)
    const withTimeout = (p, ms) => new Promise((resolve, reject) => {
      let done = false;
      const t = setTimeout(() => { if (!done) { done = true; reject(new Error('timeout')); } }, ms);
      p.then(r => { if (!done) { done = true; clearTimeout(t); resolve(r); } }).catch(e => { if (!done) { done = true; clearTimeout(t); reject(e); } });
    });

    const tokenPromise = client.oAuth.obtainToken({
      clientId: SQUARE_APP_ID,
      clientSecret: SQUARE_CLIENT_SECRET,
      code: code,
      grantType: 'authorization_code',
    });

    const response = await withTimeout(tokenPromise, 15_000);
    const result = response?.result || {};
    const accessToken = result.accessToken || result.access_token;
    const refreshToken = result.refreshToken || result.refresh_token;
    const merchantId = result.merchantId || result.merchant_id;

    if (!accessToken || !refreshToken) {
      console.error('Square OAuth did not return tokens');
      return { statusCode: 502, body: JSON.stringify({ error: 'Token exchange failed' }) };
    }

    // "Upsert" into shop_settings ensures we update the live token instead of creating duplicates
    const { error } = await supabase
      .from('shop_settings')
      .upsert({ 
        id: 'square_creds_prod', 
        access_token: accessToken,
        refresh_token: refreshToken,
        merchant_id: merchantId,
        updated_at: new Date().toISOString()
      }, { onConflict: 'id' });

    if (error) throw error;

    // Return a minimal success page; mask merchant id to last 4 characters when present
    const displayMerchant = merchantId ? `••••${String(merchantId).slice(-4)}` : 'your merchant';
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'text/html' },
      body: `
        <div style="font-family: sans-serif; text-align: center; margin-top: 50px;">
          <h1>☕ BrewHub Square Sync Success</h1>
          <p>Production tokens for Merchant <b>${displayMerchant}</b> have been secured in Supabase.</p>
          <p>You can now test production payments from your living room.</p>
        </div>
      `
    };

  } catch (error) {
    // Do not log tokens or stack traces. Log minimal error and return generic message.
    console.error('Square OAuth Error:', (error && error.message) || error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Token exchange failed' })
    };
  }
};