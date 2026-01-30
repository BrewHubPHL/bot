const https = require('https');

exports.handler = async (event) => {
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Content-Type': 'application/json'
    };

    if (event.httpMethod !== 'POST') {
        return { statusCode: 200, headers, body: 'Chat V2 Online' };
    }

    try {
        const body = JSON.parse(event.body);
        const messages = body.messages || [];

        // Simple Format
        // Remove system messages (Gemini Flash doesn't support 'system' role in this simple payload)
        // Ensure alternating user/model roles if possible, but mainly just map them rights
        const geminiMessages = messages
            .filter(msg => msg.role !== 'system') 
            .map(msg => ({
                role: msg.role === 'assistant' ? 'model' : 'user',
                parts: [{ text: msg.content }]
        }));

        // Add a System Prompt as the very first "user" message if needed
        const systemPrompt = "You are BrewBot, a helpful assistant for BrewHub PHL (a coffee shop and parcel pickup spot). Be friendly, concise, and helpful. Current date: " + new Date().toDateString();
        
        // Prepend system prompt to the first user message or add as new one
        if (geminiMessages.length > 0 && geminiMessages[0].role === 'user') {
            geminiMessages[0].parts[0].text = systemPrompt + "\n\nUser: " + geminiMessages[0].parts[0].text;
        } else {
             geminiMessages.unshift({ role: 'user', parts: [{ text: systemPrompt }] });
        }

        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) return { statusCode: 500, headers, body: JSON.stringify({ error: "Missing Key" }) };

        const payload = JSON.stringify({
            contents: geminiMessages,
            generationConfig: { temperature: 0.7, maxOutputTokens: 300 },
             safetySettings: [
                { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_ONLY_HIGH" },
                { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_ONLY_HIGH" },
                { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_ONLY_HIGH" },
                { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_ONLY_HIGH" },
                { category: "HARM_CATEGORY_CIVIC_INTEGRITY", threshold: "BLOCK_ONLY_HIGH" }
            ]
        });

        const options = {
            hostname: 'generativelanguage.googleapis.com',
            path: `/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        };

        const responseText = await new Promise((resolve, reject) => {
            const req = https.request(options, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => resolve(data));
            });
            req.on('error', reject);
            req.write(payload);
            req.end();
        });

        const geminiData = JSON.parse(responseText);
        
        // Better error handling to see why it fails
        if (geminiData.error) {
            console.error("Gemini API Error:", geminiData.error);
            return {
                statusCode: 200, 
                headers,
                body: JSON.stringify({ choices: [{ message: { content: `API Error: ${geminiData.error.message}` } }] })
            };
        }

        const candidate = geminiData.candidates?.[0];
        if (candidate && candidate.finishReason && candidate.finishReason !== 'STOP') {
             return {
                statusCode: 200,
                headers,
                body: JSON.stringify({ choices: [{ message: { content: `AI refused to answer. Finish Reason: ${candidate.finishReason}` } }] })
            };
        }

        const reply = candidate?.content?.parts?.[0]?.text;
        
        if (!reply) {
             // If we get here, valid JSON but no text. Dump the whole structure for debugging.
             const debugStr = JSON.stringify(geminiData).substring(0, 500); 
             return {
                statusCode: 200,
                headers,
                body: JSON.stringify({ choices: [{ message: { content: `Empty Response. Debug Data: ${debugStr}` } }] })
             };
        }

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({ choices: [{ message: { content: reply } }] })
        };

    } catch (error) {
        return { statusCode: 500, headers, body: JSON.stringify({ error: error.message }) };
    }
};
