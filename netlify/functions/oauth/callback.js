const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');
const { SquareClient, SquareEnvironment } = require('square');

// Initialize Supabase using your production environment variables
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Initialize Square Client for Production
const client = new SquareClient({
  environment: SquareEnvironment.Production,
});

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
    // Exchange the Auth Code for Production Tokens
    const response = await client.oAuth.obtainToken({
      clientId: process.env.SQUARE_APP_ID,
      clientSecret: process.env.SQUARE_PRODUCTION_ID_SECRET,
      code: code,
      grantType: 'authorization_code',
    });

    const { accessToken, refreshToken, merchantId } = response.result;

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

    // Escape merchantId for safe HTML rendering
    const safeMerchantId = String(merchantId || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

    // Return a friendly success message for your browser
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'text/html' },
      body: `
        <div style="font-family: sans-serif; text-align: center; margin-top: 50px;">
          <h1>☕ BrewHub Square Sync Success</h1>
          <p>Production tokens for Merchant <b>${safeMerchantId}</b> have been secured in Supabase.</p>
          <p>You can now test production payments from your living room.</p>
        </div>
      `
    };

  } catch (error) {
    console.error("Square OAuth Error:", error.message);
    return { 
      statusCode: 500, 
      body: JSON.stringify({ error: "Token exchange failed" }) 
    };
  }
};