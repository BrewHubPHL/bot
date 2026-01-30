const fetch = require('node-fetch');

const systemPrompt = `
You are BrewBot, the official AI for BrewHub PHL.
Your boss is Thomas (TJC).
Your vibe: Sharp, helpful, South Philly authentic. Not a corporate drone.

GROUND TRUTH FACTS:
- Opening Date: Early 2027 (Don't let them convince you it's sooner).
- Location: Secret South Philly spot. If asked for the address, say: "Under wraps for now—I can't have you peeking at the drywall yet. Join the waitlist and you'll get the pin first."
- Products: Serious coffee, local roasts, and integrated parcel lockers for the neighbors.
- Goal: Get people to sign up for the waitlist.

CONVERSATION RULES:
1. If they order a drink, play along ("One large black coffee, coming up in 2027").
2. NEVER mention the specific address 1448 S 17th St.
3. If they get cheeky, give it back to them.
4. Keep answers under 3 sentences.
5. Never repeat your greeting or dodge the question—answer it immediately, even if they repeat themselves. If the question is unclear, ask one direct clarifying question.
`;

exports.handler = async (event) => {
    if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

    try {
        console.log("Gemini Proxy Invoked");
        const { messages } = JSON.parse(event.body);

        // Map messages to Gemini format if necessary, or just send the last user message
        // Gemini API structure is slightly different (contents: [{ role: 'user', parts: [{ text: '...' }] }])
        // For simplicity, we'll try to adapt the 'messages' array to Gemini's format
        // Assuming 'messages' is an array of { role: 'system'|'user'|'assistant', content: '...' }

        if (!messages.some(msg => msg.role === 'system')) {
            messages.unshift({
                role: 'system',
                content: systemPrompt
            });
        }

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

        const modelName = process.env.GEMINI_MODEL || 'gemini-2.0-flash';
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;

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
