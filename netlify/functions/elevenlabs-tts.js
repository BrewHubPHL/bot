exports.handler = async (event) => {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }

    try {
        const { text } = JSON.parse(event.body);

        if (!text) {
            return { statusCode: 400, body: JSON.stringify({ error: 'Text is required' }) };
        }

        console.log('ElevenLabs TTS request for text:', text.substring(0, 50) + '...');

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
                voice_settings: {
                    stability: 0.75,
                    similarity_boost: 0.75,
                    style: 0.5,
                    use_speaker_boost: true
                }
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('ElevenLabs API error:', response.status, errorText);
            return {
                statusCode: response.status,
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    error: `ElevenLabs API error: ${response.statusText}`,
                    details: errorText
                })
            };
        }

        console.log('ElevenLabs API response OK, processing audio...');

        // Get the audio buffer
        const audioBuffer = await response.arrayBuffer();
        console.log('Audio buffer size:', audioBuffer.byteLength);

        // Convert to base64
        const base64Audio = Buffer.from(audioBuffer).toString('base64');

        return {
            statusCode: 200,
            headers: {
                'Content-Type': 'text/plain',
                'Cache-Control': 'no-cache',
                'Access-Control-Allow-Origin': '*'
            },
            body: base64Audio,
            isBase64Encoded: false // We're sending base64 as text
        };

    } catch (error) {
        console.error('ElevenLabs function error:', error);
        return {
            statusCode: 500,
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                error: 'Internal server error',
                message: error.message
            })
        };
    }
};