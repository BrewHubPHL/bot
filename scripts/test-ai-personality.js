// Run this with: node test-ai-personality.js
require('dotenv').config(); // Load your .env file
const { GoogleGenerativeAI } = require('@google/generative-ai');

async function testPersonality() {
  if (!process.env.GEMINI_API_KEY) {
    console.error("❌ Error: GEMINI_API_KEY is missing from your .env file.");
    return;
  }

  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

  // SCENARIO A: Slow Morning
  const slowDayStats = { total_orders: 12, vouchers_redeemed: 0 };
  const promptA = `
    You are the social media manager for BrewHubPHL.
    Write a short, witty Instagram caption (with emojis) based on our status:
    - Time: Morning coffee run
    - Cups sold: ${slowDayStats.total_orders} (Low sales)
    - Vouchers: ${slowDayStats.vouchers_redeemed}
    Tone: Encourage people to wake up and stop by.
    Hashtags: #BrewHubPHL
  `;

  // SCENARIO B: Busy Afternoon
  const busyDayStats = { total_orders: 85, vouchers_redeemed: 12 };
  const promptB = `
    You are the social media manager for BrewHubPHL.
    Write a short, witty Instagram caption (with emojis) based on our status:
    - Time: Late afternoon survival mode
    - Cups sold: ${busyDayStats.total_orders} (High sales!)
    - Vouchers: ${busyDayStats.vouchers_redeemed}
    Tone: Excited, celebrating the energy.
    Hashtags: #BrewHubPHL
  `;

  console.log("🤖 Asking Gemini for captions...\n");

  try {
    const [resultA, resultB] = await Promise.all([
      model.generateContent(promptA),
      model.generateContent(promptB)
    ]);

    console.log("--- 🌅 SCENARIO A: SLOW MORNING ---");
    console.log(resultA.response.text());
    console.log("\n--- 🚀 SCENARIO B: BUSY AFTERNOON ---");
    console.log(resultB.response.text());

  } catch (error) {
    console.error("Test Failed:", error.message);
  }
}

testPersonality();
