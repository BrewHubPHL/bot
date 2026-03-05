const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');
const { publicBucket } = require('./_token-bucket');

exports.handler = async (event) => {
  // 1. Only allow POST requests (standard for ElevenLabs tools)
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  // Per-IP rate limit
  const clientIp = event.headers['x-nf-client-connection-ip']
    || event.headers['x-forwarded-for']?.split(',')[0]?.trim()
    || 'unknown';
  const ipLimit = publicBucket.consume('waitlist:' + clientIp);
  if (!ipLimit.allowed) {
    return { statusCode: 429, body: JSON.stringify({ result: 'Too many requests. Please slow down.' }) };
  }

  // API key authentication — reject unauthenticated calls
  // ElevenLabs sends the key as AI_ORDER_API_KEY; also accept standard X-API-Key
  const apiKey = event.headers['ai_order_api_key'] || event.headers['AI_ORDER_API_KEY'] || event.headers['x-api-key'] || event.headers['X-Api-Key'];
  const validKey = process.env.BREWHUB_API_KEY;
  if (!validKey || !apiKey) {
    return { statusCode: 401, body: JSON.stringify({ result: "Unauthorized" }) };
  }
  const bufA = Buffer.from(String(apiKey));
  const bufB = Buffer.from(String(validKey));
  if (bufA.length !== bufB.length || !crypto.timingSafeEqual(bufA, bufB)) {
    return { statusCode: 401, body: JSON.stringify({ result: "Unauthorized" }) };
  }

  // Check env vars
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
    console.error("Missing SUPABASE_URL or SUPABASE_ANON_KEY");
    return { 
      statusCode: 500, 
      body: JSON.stringify({ result: "I'm having trouble accessing the list right now. Please try again later." }) 
    };
  }

  // Initialize Supabase with anon key (read-only, RLS-protected)
  const supabase = createClient(
    process.env.SUPABASE_URL, 
    process.env.SUPABASE_ANON_KEY
  );

  try {
    // 2. Parse the email from the agent
    const { email } = JSON.parse(event.body || '{}');

    if (!email) {
      return { 
        statusCode: 200, // Return 200 so the agent can handle the error verbally
        body: JSON.stringify({ result: "I need an email address to check the list." }) 
      };
    }

    // Audit #24: cap email input to 254 chars (RFC 5321 max)
    const safeEmail = String(email).toLowerCase().trim().slice(0, 254);

    // 3. Query Supabase
    const { data, error } = await supabase
      .from('waitlist')
      .select('email, created_at')
      .eq('email', safeEmail)
      .maybeSingle(); // Returns null if not found, instead of throwing an error

    if (error) throw error;

    // 4. Formulate the response for Elise
    if (data) {
      // User IS on the list
      return {
        statusCode: 200,
        body: JSON.stringify({ 
          result: `Yes! I found you on the list. You're all set for updates.` 
        })
      };
    } else {
      // User is NOT on the list
      return {
        statusCode: 200,
        body: JSON.stringify({ 
          result: "I couldn't find that email on our waitlist yet. You can sign up manually at our website!" 
        })
      };
    }

  } catch (err) {
    console.error('[tool-check-waitlist] error:', err?.message);
    return { 
      statusCode: 502, 
      body: JSON.stringify({ result: "I'm having trouble accessing the list right now. Please try again later." }) 
    };
  }
};