const { createClient } = require('@supabase/supabase-js');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { checkQuota } = require('./_usage');
const { verifyServiceSecret } = require('./_auth');

// Initialize Supabase
const supabase = createClient(
  process.env.SUPABASE_URL, 
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Initialize Gemini
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

exports.handler = async (event) => {
  // 1. Quota Check (Circuit Breaker)
  const isUnderLimit = await checkQuota('gemini_marketing');
  if (!isUnderLimit) {
    console.error('[WALLET PROTECTION] Gemini daily budget exceeded.');
    return { statusCode: 429, body: "Quota exceeded" };
  }

  // 2. Auth Guard (timing-safe comparison with null guard)
  const serviceAuth = verifyServiceSecret(event);
  if (!serviceAuth.valid) return serviceAuth.response;

  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const today = days[new Date().getDay()];

  let topic = "General excitement that BrewHub is coming soon to Philly";
  let tone = "Mysterious and exciting";

  if (today === 'Monday') {
    topic = "Construction update or 'Building the dream'. Mention sawdust and hard hats.";
    tone = "Motivated and gritty";
  } else if (today === 'Wednesday') {
    topic = "Menu teaser. Mention 'Testing roast profiles' or 'Perfecting the latte art'.";
    tone = "Insider sneak peek";
  } else if (today === 'Friday') {
    topic = "Weekend vibes. Ask Philly where they are getting coffee while they wait for us.";
    tone = "Community-focused and fun";
  }

  const prompt = `
    You are the social media manager for BrewHubPHL (Opening Soon).
    Write a short, punchy Instagram caption (with emojis) about: ${topic}.
    Current Vibe: ${tone}.
    Hashtags: #BrewHubPHL #ComingSoon #PhillyCoffee
  `;

  try {
    // 1. Generate Caption
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
    const result = await model.generateContent(prompt);
    const caption = result.response.text();

    console.log(`[HYPE BOT] Generated: ${caption}`);

    // 2. Save to Supabase (Triggers the Google Sheet sync)
    const { error } = await supabase
      .from('marketing_posts')
      .insert([{ day_of_week: today, topic, caption }]);

    if (error) throw error;

    return { statusCode: 200, body: "Caption generated and saved to DB" };

  } catch (err) {
    console.error("Bot Error:", err);
    return { statusCode: 500, body: "Failed" };
  }
};