const fetch = require('node-fetch');

exports.handler = async (event) => {
    // Enable CORS for testing if needed
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Content-Type': 'application/json'
    };

    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers, body: '' };
    }

    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, headers, body: 'Make a POST request' };
    }

    try {
        console.log("Chat Function Invoked");
        const { messages } = JSON.parse(event.body);

        const geminiMessages = messages.map(msg => {
             let role = 'user';
             if (msg.role === 'assistant') role = 'model';
             return {
                 role: role,
                 parts: [{ text: msg.content }]
             };
        });

        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) {
            console.error("Missing GEMINI_API_KEY");
            return { statusCode: 500, headers, body: JSON.stringify({ error: "Missing API Key" }) };
        }

        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;

        // Add System Instruction at the start if needed, or rely on system message mapping above
        
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: geminiMessages,
                generationConfig: {
                    temperature: 0.7,
                    maxOutputTokens: 300
                }
            })
        });

        const data = await response.json();

         if (!response.ok) {
             console.error('Gemini API Error:', data);
             return {
                 statusCode: response.status,
                 headers,
                 body: JSON.stringify({ error: data.error?.message || 'Gemini API Error' })
             };
         }

        const replyText = data.candidates?.[0]?.content?.parts?.[0]?.text || "No response generated.";
        
        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                choices: [{ message: { content: replyText } }]
            })
        };

    } catch (error) {
        console.error('Function Error:', error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ error: error.message })
        };
    }
};
