// Run with: node scripts/test-hype.js
require('dotenv').config();
const { GoogleGenerativeAI } = require('@google/generative-ai');

async function testHype() {
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

  const scenarios = [
    { day: "Monday", topic: "Construction/Hard Hats" },
    { day: "Wednesday", topic: "Menu Teaser/Roasting" },
    { day: "Friday", topic: "Community Question" }
  ];

  console.log("🚧 Testing Pre-Launch Hype Machine...\n");

  for (const s of scenarios) {
    const prompt = `
      Context: BrewHubPHL is OPENING SOON (not open yet).
      Day: ${s.day}
      Topic: ${s.topic}
      Write a short Instagram caption.
    `;
    
    try {
      const result = await model.generateContent(prompt);
      console.log(`--- 📅 ${s.day.toUpperCase()} VIBE ---`);
      console.log(result.response.text());
      console.log("\n");
    } catch (err) {
      console.error(err.message);
    }
  }
}

testHype();