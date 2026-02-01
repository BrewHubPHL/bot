exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };

  try {
    const agentId = process.env.ELEVENLABS_AGENT_ID;
    const apiKey = process.env.ELEVENLABS_API_KEY;

    if (!agentId) {
      throw new Error('Missing ELEVENLABS_AGENT_ID');
    }

    // We removed the 'node-fetch' requirement and used the native fetch
    const response = await fetch(`https://api.elevenlabs.io/v1/convai/conversation/get_signed_url?agent_id=${agentId}`, {
      method: 'GET',
      headers: { 'xi-api-key': apiKey }
    });

    const data = await response.json();

    if (!data.signed_url) {
        throw new Error('ElevenLabs did not return a URL. Check your API Key.');
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ signedUrl: data.signed_url })
    };
  } catch (err) {
    console.error('Bot Error:', err.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};