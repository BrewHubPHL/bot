exports.handler = async (event) => {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }

    const { text } = JSON.parse(event.body);

    const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/21m00Tcm4TlvDq8ikWAM/stream`, {
        method: 'POST',
        headers: {
            'Accept': 'audio/mpeg',
            'xi-api-key': process.env.ELEVENLABS_API_KEY,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            text,
            model_id: 'eleven_turbo_v2',
            voice_settings: { stability: 0.75, similarity_boost: 0.75 }
        })
    });

    return {
        statusCode: response.status,
        headers: {
            'Content-Type': 'audio/mpeg'
        },
        body: await response.buffer(),
        isBase64Encoded: true
    };
};