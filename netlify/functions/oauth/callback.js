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

exports.handler = async (event) => {
  // Extract the authorization code sent by Square to your production redirect URL
  const { code } = event.queryStringParameters || {};

  if (!code) {
    return { 
      statusCode: 400, 
      body: JSON.stringify({ error: "Missing authorization code from Square." }) 
    };
  }

  try {
    // Exchange the Auth Code for Production Tokens
    // We use the hardcoded Production App ID you provided
    const response = await client.oAuth.obtainToken({
      clientId: "sq0idp-8iZw6wLX61i-6v4zRn-ong",
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

    // Return a friendly success message for your browser
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'text/html' },
      body: `
        <div style="font-family: sans-serif; text-align: center; margin-top: 50px;">
          <h1>☕ BrewHub Square Sync Success</h1>
          <p>Production tokens for Merchant <b>${merchantId}</b> have been secured in Supabase.</p>
          <p>You can now test production payments from your living room.</p>
        </div>
      `
    };

  } catch (error) {
    console.error("Square OAuth Error:", error.message);
    return { 
      statusCode: 500, 
      body: JSON.stringify({ error: "Token exchange failed", details: error.message }) 
    };
  }
};