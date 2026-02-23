const { createClient } = require('@supabase/supabase-js');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { checkQuota } = require('./_usage');
const { verifyServiceSecret } = require('./_auth');
const { formBucket } = require('./_token-bucket');
const { sanitizeInput } = require('./_sanitize');

const MISSING_ENV = !process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY || !process.env.GEMINI_API_KEY;

exports.handler = async (event) => {
  // Fail-closed on missing critical envs
  if (MISSING_ENV) {
    console.warn('marketing-bot: missing SUPABASE or GEMINI envs');
    return { statusCode: 500, body: 'Server misconfiguration' };
  }

  // CORS allowlist and preflight handling
  const ALLOWED_ORIGINS = [process.env.SITE_URL, 'https://brewhubphl.com', 'https://www.brewhubphl.com'].filter(Boolean);
  const origin = (event.headers['origin'] || '').replace(/\/$/, '');
  const referer = (event.headers['referer'] || '');
  const isLocalDev = process.env.NODE_ENV !== 'production' && (origin.includes('://localhost') || referer.includes('://localhost'));
  const isValidOrigin = ALLOWED_ORIGINS.some(a => a === origin || referer.startsWith(a));

  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Headers': 'Content-Type, X-BrewHub-Action, Authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
    'Cache-Control': 'no-store',
  };
  if (isValidOrigin || isLocalDev) headers['Access-Control-Allow-Origin'] = origin || ALLOWED_ORIGINS[0];

  // CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  // Method guard
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  // Origin check
  if (!isValidOrigin && !isLocalDev) {
    console.warn('[MARKETING-BOT] Rejected origin:', origin, referer);
    return { statusCode: 403, headers, body: JSON.stringify({ error: 'Invalid request origin' }) };
  }

  // 1. Quota Check (Circuit Breaker)
  const isUnderLimit = await checkQuota('gemini_marketing');
  if (!isUnderLimit) {
    console.error('[WALLET PROTECTION] Gemini daily budget exceeded.');
    return { statusCode: 429, headers, body: JSON.stringify({ error: 'Quota exceeded' }) };
  }

  // 2. Auth Guard (timing-safe comparison with null guard)
  const serviceAuth = verifyServiceSecret(event);
  if (!serviceAuth.valid) return { ...serviceAuth.response, headers };

  // Per-service + per-IP rate limiting
  const rawIp = event.headers['x-nf-client-connection-ip'] || event.headers['x-forwarded-for']?.split(',')[0]?.trim();
  const rlKey = rawIp ? `marketing-bot:${rawIp}` : 'marketing-bot:global';
  const rl = formBucket.consume(rlKey);
  if (!rl.allowed) {
    return { statusCode: 429, headers, body: JSON.stringify({ error: 'Too many requests' }) };
  }

  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const today = days[new Date().getDay()];

  let topic = 'General excitement that BrewHub is coming soon to Philly';
  let tone = 'Mysterious and exciting';

  if (today === 'Monday') {
    topic = "Construction update or 'Building the dream'. Mention sawdust and hard hats.";
    tone = 'Motivated and gritty';
  } else if (today === 'Wednesday') {
    topic = "Menu teaser. Mention 'Testing roast profiles' or 'Perfecting the latte art'.";
    tone = 'Insider sneak peek';
  } else if (today === 'Friday') {
    topic = "Weekend vibes. Ask Philly where they are getting coffee while they wait for us.";
    tone = 'Community-focused and fun';
  }

  const prompt = `You are the social media manager for BrewHubPHL (Opening Soon). Write a short, punchy Instagram caption (with emojis) about: ${topic}. Current Vibe: ${tone}. Hashtags: #BrewHubPHL #ComingSoon #PhillyCoffee`;

    try {
    // Create per-request clients (avoid long-lived service-role objects at module scope)
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

    // 1. Generate Caption with timeout
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
    let result;
    try {
      result = await Promise.race([
        model.generateContent(prompt),
        new Promise((_, rej) => setTimeout(() => rej(new Error('model timeout')), 12000)),
      ]);
    } catch (e) {
      console.error('[MARKETING-BOT] Model call failed:', e?.message || e);
      return { statusCode: 502, headers, body: JSON.stringify({ error: 'Model generation failed' }) };
    }

    // Defensive extraction of text from possible SDK shapes
    let caption = '';
    try {
      if (result?.response?.text) caption = String(result.response.text());
      else if (result?.candidates && result.candidates[0] && result.candidates[0].content) caption = String(result.candidates[0].content);
      else if (Array.isArray(result?.output) && result.output[0]?.content) caption = String(result.output[0].content);
      else caption = String(result || '');
    } catch (e) {
      caption = String(result || '');
    }

    // Sanitize + truncate to avoid DB errors and PII leakage
    caption = sanitizeInput(caption).slice(0, 1000);

    // Log only a safe preview
    console.log(`[HYPE BOT] Generated preview: ${caption.slice(0, 120)}`);

    // 2. Save to Supabase (Triggers the Google Sheet sync)
    const { error } = await supabase
      .from('marketing_posts')
      .insert([{ day_of_week: today, topic, caption }]);

    if (error) throw error;

    return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
  } catch (err) {
    console.error('HYPE BOT Error:', err?.message);
    return { statusCode: 500, body: 'Failed' };
  }
};