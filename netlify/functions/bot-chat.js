const https = require('https');

exports.handler = async (event) => {
    // Enable CORS
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
        const body = JSON.parse(event.body);
        const messages = body.messages || [];

        // Helper: Format for Gemini
        const geminiMessages = messages.map(msg => {
             let role = 'user';
             if (msg.role === 'assistant') role = 'model';
             return { role: role, parts: [{ text: msg.content }] };
        });

        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) {
            return { statusCode: 500, headers, body: JSON.stringify({ error: "Missing API Key" }) };
        }

        const dataString = JSON.stringify({
            contents: geminiMessages,
            generationConfig: { temperature: 0.7, maxOutputTokens: 300 }
        });

        const options = {
            hostname: 'generativelanguage.googleapis.com',
            path: `/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': dataString.length
            }
        };

        // Promisify the HTTPS request (Native Node.js - No Dependencies)
        const responseBody = await new Promise((resolve, reject) => {
            const req = https.request(options, (res) => {
                let chunks = [];
                res.on('data', (chunk) => chunks.push(chunk));
                res.on('end', () => {
                    const buffer = Buffer.concat(chunks);
                    resolve({
                        status: res.statusCode,
                        data: buffer.toString()
                    });
                });
            });

            req.on('error', (e) => reject(e));
            req.write(dataString);
            req.end();
        });

        const geminiData = JSON.parse(responseBody.data);

        if (responseBody.status !== 200) {
            console.error("Gemini Error:", geminiData);
            return { statusCode: responseBody.status, headers, body: JSON.stringify(geminiData) };
        }

        const replyText = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || "No response.";

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                choices: [{ message: { content: replyText } }]
            })
        };

    } catch (error) {
        console.error("Handler Error:", error);
        return { statusCode: 500, headers, body: JSON.stringify({ error: error.message }) };
    }
};
