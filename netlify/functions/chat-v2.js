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
        const geminiMessages = messages.map(msg => ({
             role: msg.role === 'assistant' ? 'model' : 'user',
             parts: [{ text: msg.content }]
        }));

        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) return { statusCode: 500, headers, body: JSON.stringify({ error: "Missing Key" }) };

        const payload = JSON.stringify({
            contents: geminiMessages,
            generationConfig: { temperature: 0.7, maxOutputTokens: 300 }
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
                statusCode: 200, // Return 200 so frontend displays the error message
                headers,
                body: JSON.stringify({ choices: [{ message: { content: `API Error: ${geminiData.error.message}` } }] })
            };
        }

        const reply = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || `No reply from AI. Raw: ${responseText.substring(0, 100)}...`;

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({ choices: [{ message: { content: reply } }] })
        };

    } catch (error) {
        return { statusCode: 500, headers, body: JSON.stringify({ error: error.message }) };
    }
};
