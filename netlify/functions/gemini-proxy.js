exports.handler = async (event) => {
    if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

    try {
        const { messages } = JSON.parse(event.body);

        // Map messages to Gemini format if necessary, or just send the last user message
        // Gemini API structure is slightly different (contents: [{ role: 'user', parts: [{ text: '...' }] }])
        // For simplicity, we'll try to adapt the 'messages' array to Gemini's format
        // Assuming 'messages' is an array of { role: 'system'|'user'|'assistant', content: '...' }

        const geminiMessages = messages.map(msg => {
             // Gemini uses 'model' role for assistant, and 'user' for user. System prompts are handled differently or just passed as user context.
             // Simple mapping: 
             let role = 'user';
             if (msg.role === 'assistant') role = 'model';
             if (msg.role === 'system') role = 'user'; // Treat system prompt as initial context from user for now

             return {
                 role: role,
                 parts: [{ text: msg.content }]
             };
        });
        
        // Ensure system prompt (if any) is at the start (already handled by main history array order usually)
        
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) {
            console.error("Missing GEMINI_API_KEY environment variable");
            return { statusCode: 500, body: JSON.stringify({ error: "Server Configuration Error: Missing API Key" }) };
        }

        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;

        // Gemini stateless request (send whole history)
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                contents: geminiMessages,
                generationConfig: {
                    temperature: 0.7,
                    maxOutputTokens: 300
                }
            })
        });

        const data = await response.json();

        // Gemini response format: data.candidates[0].content.parts[0].text
        // We need to map it back to the format the frontend expects (OpenAI-ish)
         if (!response.ok) {
             console.error('Gemini API Error:', data);
             return {
                 statusCode: response.status,
                 body: JSON.stringify({ error: data.error?.message || 'Gemini API Error' })
             };
         }

        const replyText = data.candidates?.[0]?.content?.parts?.[0]?.text || "I'm sorry, I couldn't generate a response.";
        
        // Mocking OpenAI structure for frontend compatibility
        const frontendResponse = {
            choices: [
                {
                    message: {
                        content: replyText
                    }
                }
            ]
        };

        return {
            statusCode: 200,
            body: JSON.stringify(frontendResponse)
        };

    } catch (error) {
        console.error('Function Error:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'Internal Server Error' })
        };
    }
};
