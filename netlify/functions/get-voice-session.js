const { authorize } = require('./_auth');
const { checkQuota } = require('./_usage');

exports.handler = async function(event, context) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  // Require staff auth for ConvAI sessions
  const auth = await authorize(event);
  if (!auth.ok) {
    return auth.response;
  }

  // Apply a hard quota even for staff to avoid runaway costs
  const hasQuota = await checkQuota('elevenlabs_convai');
  if (!hasQuota) {
    return {
      statusCode: 429,
      headers,
      body: JSON.stringify({ error: 'Daily voice quota reached. Come back tomorrow!' })
    };
  }

  try {
    const agentId = process.env.ELEVENLABS_AGENT_ID;
    const apiKey = process.env.ELEVENLABS_API_KEY;

    if (!agentId || !apiKey) {
      return { 
        statusCode: 400, 
        headers, 
        body: JSON.stringify({ error: 'Check your .env file or Netlify variables' }) 
      };
    }

    // Using global fetch (built into Node 18+)
    const response = await fetch(
      `https://api.elevenlabs.io/v1/convai/conversation/get_signed_url?agent_id=${agentId}`,
      {
        method: 'GET',
        headers: { 'xi-api-key': apiKey }
      }
    );

    const data = await response.json();

    if (!response.ok) {
      return { statusCode: response.status, headers, body: JSON.stringify(data) };
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ signedUrl: data.signed_url })
    };

  } catch (error) {
    console.error(error);
    return { 
      statusCode: 500, 
      headers, 
      body: JSON.stringify({ error: 'Voice session failed' }) 
    };
  }
};