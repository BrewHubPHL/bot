// Run with: node scripts/check-models.js
require('dotenv').config(); 
const { GoogleGenerativeAI } = require('@google/generative-ai');

async function listModels() {
  if (!process.env.GEMINI_API_KEY) {
    console.error("❌ Error: GEMINI_API_KEY is missing from .env");
    return;
  }

  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

  try {
    // This fetches the list of ALL models available to your specific API Key
    const modelList = await genAI.getGenerativeModel({ model: "gemini-1.5-flash" }).apiKey; 
    // Wait, the SDK doesn't expose listModels directly on the instance easily, 
    // so we use the lower-level manager:
    
    console.log("🔍 Checking available models for your API Key...");
    
    // We have to use a fetch because the SDK simplifies this part away
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${process.env.GEMINI_API_KEY}`
    );
    
    if (!response.ok) {
      console.error(`❌ API Error: ${response.status} ${response.statusText}`);
      const errorBody = await response.text();
      console.error("Details:", errorBody);
      console.log("\n💡 TIP: If you see a 403 or 'Request had insufficient authentication scopes',");
      console.log("   it means your API Key is valid, but you haven't enabled the 'Generative Language API'");
      console.log("   in the Google Cloud Console.");
      return;
    }

    const data = await response.json();
    const availableModels = data.models
      .filter(m => m.supportedGenerationMethods.includes("generateContent"))
      .map(m => m.name.replace("models/", "")); // Clean up the name

    console.log("\n✅ SUCCESS! Here are the models you can use:");
    console.log("---------------------------------------------");
    availableModels.forEach(name => console.log(`"${name}"`));
    console.log("---------------------------------------------");
    
    console.log(`\n👉 Recommended: Use "${availableModels.find(m => m.includes('flash')) || availableModels[0]}"`);

  } catch (error) {
    console.error("Script failed:", error.message);
  }
}

listModels();