// get-voice-session.js
exports.handler = async function(event, context) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };

  const agentId = process.env.ELEVENLABS_AGENT_ID;
  const elevenlabsApiKey = process.env.ELEVENLABS_API_KEY;

  if (!agentId || !elevenlabsApiKey) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Missing Environment Variables' })
    };
  }

  try {
    const response = await fetch(
      `https://api.elevenlabs.io/v1/convai/conversation/get_signed_url?agent_id=${agentId}`,
      {
        method: 'GET', // Explicitly set GET
        headers: {
          'xi-api-key': elevenlabsApiKey,
        },
      }
    );

    if (!response.ok) {
      const errorData = await response.json();
      console.error("ElevenLabs Error Details:", errorData); // This helps you debug in Netlify logs
      return {
        statusCode: response.status,
        headers,
        body: JSON.stringify({ error: errorData })
      };
    }

    const data = await response.json();
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ signedUrl: data.signed_url }),
    };
  } catch (error) {
    console.error('Error generating signed URL:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: error.message })
    };
  }
};