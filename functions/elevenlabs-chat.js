exports.handler = async (event) => {
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Content-Type': 'application/json'
    };

    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers, body: '' };
    }

    try {
        let userText = "Hello";
        if (event.body) {
            const body = JSON.parse(event.body);
            userText = body.text || "Hello";
        }

        const agentId = process.env.ELEVENLABS_AGENT_ID;
        const apiKey = process.env.ELEVENLABS_API_KEY;

        if (!agentId || !apiKey) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ error: 'Missing ElevenLabs credentials' })
            };
        }

        // Use the ElevenLabs text generation API to get response from agent
        const agentResp = await fetch(
            `https://api.elevenlabs.io/v1/convai/agents/${agentId}`,
            { method: 'GET', headers: { 'xi-api-key': apiKey } }
        );
        
        if (!agentResp.ok) {
            throw new Error('Failed to get agent info');
        }

        const agentInfo = await agentResp.json();
        const voiceId = agentInfo.conversation_config?.tts?.voice_id || 'EXAVITQu4vr4xnSDxMaL'; // Default to Sarah
        const systemPrompt = agentInfo.conversation_config?.agent?.prompt?.prompt || 
            "You are Elise, a friendly barista at BrewHub coffee shop.";

        // Use OpenAI-compatible endpoint or simple response
        // For now, use a simple contextual response based on the agent's persona
        const responses = {
            "hi": "Hey there! Welcome to BrewHub! What can I get started for you today?",
            "hello": "Hi! Welcome to BrewHub! Ready to order something delicious?",
            "hey": "Hey! Great to see you at BrewHub! What sounds good today?",
            "how are you": "I'm doing great, thanks for asking! Ready to make you an amazing drink. What can I get you?",
            "what do you have": "We've got all the classics - lattes, cappuccinos, cold brew, plus some seasonal specials! What's your go-to?",
            "menu": "Our menu has espresso drinks, cold brews, teas, and pastries! Any favorites you're craving?",
            "coffee": "Coffee is our specialty! We have drip coffee, pour-over, espresso, lattes, cappuccinos... what's your style?",
            "latte": "Lattes are so good! We can do classic, vanilla, caramel, or our seasonal flavors. Hot or iced?",
            "default": "I'm here to help with your order! What sounds good today?"
        };

        const lowerText = userText.toLowerCase().trim();
        let reply = responses.default;
        for (const [key, value] of Object.entries(responses)) {
            if (lowerText.includes(key)) {
                reply = value;
                break;
            }
        }

        // Generate TTS audio so Elise can "read" the reply
        const ttsResp = await fetch(
            `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
            {
                method: 'POST',
                headers: {
                    'xi-api-key': apiKey,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    text: reply,
                    model_id: 'eleven_turbo_v2',
                    voice_settings: {
                        stability: 0.5,
                        similarity_boost: 0.75
                    }
                })
            }
        );

        let audioBase64 = null;
        if (ttsResp.ok) {
            const audioBuffer = await ttsResp.arrayBuffer();
            audioBase64 = Buffer.from(audioBuffer).toString('base64');
        }

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({ 
                reply,
                audio: audioBase64 // Base64 encoded MP3 audio
            })
        };

    } catch (error) {
        console.error("Function Error:", error.message);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ error: error.message })
        };
    }
};