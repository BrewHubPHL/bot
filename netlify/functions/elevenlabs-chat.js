exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };

  // Handle preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  try {
    const apiKey = process.env.ELEVENLABS_API_KEY;
    const agentId = process.env.ELEVENLABS_AGENT_ID;

    if (!apiKey || !agentId) {
      return { 
        statusCode: 500, 
        headers, 
        body: JSON.stringify({ error: 'Missing API Key or Agent ID in environment variables.' }) 
      };
    }

    const payload = JSON.parse(event.body || '{}');
    // TRIPLE CHECK: Ensure we catch 'text' or 'message' from the frontend
    const userMessage = payload.text || payload.message;

    if (!userMessage) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'No text provided' }) };
    }

    // ElevenLabs ConvAI Text Interface
    const response = await fetch(`https://api.elevenlabs.io/v1/convai/conversation?agent_id=${agentId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'xi-api-key': apiKey
      },
      body: JSON.stringify({ 
        text: userMessage,
        // Optional: you can pass a conversation_id here if you want Elise to remember previous texts
      })
    });

    const raw = await response.text();
    
    if (!response.ok) {
      console.error('ElevenLabs Error:', raw);
      return { statusCode: response.status, headers, body: JSON.stringify({ error: raw }) };
    }

    let data = JSON.parse(raw);
    
    // ElevenLabs usually returns the response in data.reply or data.response.text
    const reply = data.reply || (data.response && data.response.text) || "I'm not sure how to respond to that.";

    return { 
      statusCode: 200, 
      headers, 
      body: JSON.stringify({ reply: reply }) 
    };

  } catch (err) {
    console.error('ElevenLabs chat error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Internal Server Error' }) };
  }
};