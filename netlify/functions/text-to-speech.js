// Text-to-Speech using ElevenLabs
exports.handler = async (event) => {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method not allowed' };
    }

    try {
        const { text } = JSON.parse(event.body);
        
        if (!text) {
            return { statusCode: 400, body: 'No text provided' };
        }

        // Use Elise's voice (or a default ElevenLabs voice)
        const voiceId = process.env.ELEVENLABS_VOICE_ID || 'EXAVITQu4vr4xnSDxMaL'; // Sarah voice as fallback
        
        const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
            method: 'POST',
            headers: {
                'Accept': 'audio/mpeg',
                'Content-Type': 'application/json',
                'xi-api-key': process.env.ELEVENLABS_API_KEY
            },
            body: JSON.stringify({
                text: text,
                model_id: 'eleven_turbo_v2',
                voice_settings: {
                    stability: 0.5,
                    similarity_boost: 0.75
                }
            })
        });

        if (!response.ok) {
            console.error('ElevenLabs TTS error:', response.status);
            return { statusCode: 500, body: 'TTS failed' };
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
        console.error('TTS error:', error);
        return { statusCode: 500, body: 'TTS error' };
    }
};
