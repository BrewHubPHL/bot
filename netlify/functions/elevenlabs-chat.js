exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod !== 'POST') {
    return { statusCode: 200, headers, body: JSON.stringify({ status: 'ok' }) };
  }

  try {
    const apiKey = process.env.ELEVENLABS_API_KEY;
    const agentId = process.env.ELEVENLABS_AGENT_ID;

    if (!apiKey) {
      return { statusCode: 500, headers, body: JSON.stringify({ error: 'Missing ELEVENLABS_API_KEY' }) };
    }

    const payload = JSON.parse(event.body || '{}');
    const message = payload.message;

    if (!message) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing message' }) };
    }

    if (!agentId) {
      return { statusCode: 500, headers, body: JSON.stringify({ error: 'Missing ELEVENLABS_AGENT_ID' }) };
    }

    const response = await fetch('https://api.elevenlabs.io/v1/convai/conversation', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'xi-api-key': apiKey
      },
      body: JSON.stringify({ agent_id: agentId, text: message })
    });

    const raw = await response.text();
    console.log('ElevenLabs status:', response.status);
    console.log('ElevenLabs raw response:', raw);
    if (!response.ok) {
      return { statusCode: response.status, headers, body: JSON.stringify({ error: raw || response.statusText }) };
    }

    let data;
    try {
      data = JSON.parse(raw);
    } catch (parseErr) {
      return { statusCode: 200, headers, body: JSON.stringify({ reply: raw }) };
    }

    const reply = data.reply || data.message || (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '';
    return { statusCode: 200, headers, body: JSON.stringify({ reply }) };

  } catch (err) {
    console.error('ElevenLabs chat error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
