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
      body: JSON.stringify({ error: 'Missing ElevenLabs Agent ID or API Key environment variables.' })
    };
  }

  try {
    const response = await fetch(
      `https://api.elevenlabs.io/v1/convai/conversation/get_signed_url?agent_id=${agentId}`,
      {
        headers: {
          'xi-api-key': elevenlabsApiKey,
        },
      }
    );

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(`Failed to get signed URL: ${response.status} - ${JSON.stringify(errorData)}`);
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
      body: JSON.stringify({ error: 'Failed to generate signed URL' }),
    };
  }
};