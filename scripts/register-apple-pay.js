const { SquareClient, SquareEnvironment } = require('square');
require('dotenv').config(); // Load your .env variables

// 1. Initialize Production Client
const client = new SquareClient({
  token: process.env.SQUARE_PRODUCTION_TOKEN,
  environment: SquareEnvironment.Production,
});

const registerDomains = async () => {
  // 2. Add all variations of your domain
  // Note: www subdomain removed - Square can't follow redirects
  const domains = [
    'brewhubphl.com',
    'brewhubphl.netlify.app'
  ];

  console.log("🍏 Starting Apple Pay Domain Registration...");

  for (const domain of domains) {
    try {
      const response = await client.applePay.registerDomain({
        domainName: domain
      });
      
      console.log(`✅ Success: ${domain} is now verified for Apple Pay.`);
      console.log(`   Status: ${response.result.status}`);
      
    } catch (error) {
      console.error(`❌ Failed to register ${domain}:`);
      // Parse Square API errors for clarity
      const errors = error.result?.errors || error.message;
      console.error(JSON.stringify(errors, null, 2));
    }
  }
};

registerDomains();