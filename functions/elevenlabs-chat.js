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

        // Get signed URL for WebSocket connection
        const signedUrlResp = await fetch(
            `https://api.elevenlabs.io/v1/convai/conversation/get_signed_url?agent_id=${agentId}`,
            { method: 'GET', headers: { 'xi-api-key': apiKey } }
        );
        
        if (!signedUrlResp.ok) {
            throw new Error('Failed to get signed URL');
        }

        const { signed_url } = await signedUrlResp.json();

        // Connect via WebSocket and get real AI response
        const reply = await new Promise((resolve, reject) => {
            const WebSocket = require('ws');
            const ws = new WebSocket(signed_url);
            let response = '';
            let timeout;
            let gotResponse = false;

            ws.on('open', () => {
                console.log('WebSocket connected');
                timeout = setTimeout(() => {
                    console.log('Timeout - closing');
                    ws.close();
                }, 20000);
            });

            ws.on('message', (data) => {
                try {
                    const msg = JSON.parse(data.toString());
                    console.log('Message type:', msg.type);
                    
                    // After receiving metadata, send user message
                    if (msg.type === 'conversation_initiation_metadata') {
                        console.log('Sending user message:', userText);
                        ws.send(JSON.stringify({
                            type: 'user_message',
                            user_message: {
                                role: 'user',
                                content: userText
                            }
                        }));
                    }
                    
                    // Collect transcript chunks
                    if (msg.type === 'agent_response' && msg.agent_response_event?.agent_response) {
                        response += msg.agent_response_event.agent_response;
                        gotResponse = true;
                    }
                    
                    // Alternative: check for text in various formats
                    if (msg.type === 'audio' && msg.text) {
                        response = msg.text;
                        gotResponse = true;
                    }

                    // Final corrected response
                    if (msg.type === 'agent_response_correction') {
                        response = msg.corrected_transcript || msg.agent_response || response;
                        gotResponse = true;
                    }

                    // Turn ended - we have the full response
                    if (msg.type === 'interruption' || msg.type === 'agent_turn_end' || msg.type === 'turn_end') {
                        if (gotResponse && response) {
                            console.log('Turn ended with response');
                            clearTimeout(timeout);
                            ws.close();
                        }
                    }
                } catch (e) {
                    console.error('Parse error:', e);
                }
            });

            ws.on('error', (err) => {
                console.error('WS Error:', err);
                clearTimeout(timeout);
                reject(err);
            });

            ws.on('close', () => {
                console.log('WS Closed, response:', response.substring(0, 50));
                clearTimeout(timeout);
                resolve(response || "Hey! Welcome to BrewHub. How can I help you today?");
            });
        });

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({ reply })
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
            body: JSON.stringify({ error: error.message })
        };
    }
};