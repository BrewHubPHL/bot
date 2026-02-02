const fetch = require('node-fetch');

exports.handler = async function(event, context) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  try {
    const { text } = JSON.parse(event.body);
    
    // For now, this returns a confirmation. 
    // You can later connect this to OpenAI or ElevenLabs text-to-text API.
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ 
        reply: `BrewBot received: "${text}". Elise is checking the parcel logs for you now!` 
      })
    };
  } catch (error) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: error.message }) };
  }
};