exports.handler = async (event) => {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }

    try {
        const { text } = JSON.parse(event.body);

        if (!text) {
            return { statusCode: 400, body: 'Text is required' };
        }

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

        if (!response.ok) {
            console.error('ElevenLabs API error:', response.status, response.statusText);
            return {
                statusCode: response.status,
                body: `ElevenLabs API error: ${response.statusText}`
            };
        }

        const audioBuffer = await response.arrayBuffer();

        return {
            statusCode: 200,
            headers: {
                'Content-Type': 'audio/mpeg',
                'Cache-Control': 'no-cache'
            },
            body: Buffer.from(audioBuffer).toString('base64'),
            isBase64Encoded: true
        };

    } catch (error) {
        console.error('ElevenLabs function error:', error);
        return {
            statusCode: 500,
            body: `Internal server error: ${error.message}`
        };
    }
};