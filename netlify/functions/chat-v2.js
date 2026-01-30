const { GoogleGenerativeAI } = require('@google/generative-ai');

exports.handler = async (event) => {
    const headers = {
        'Access-Control-Allow-Origin': '*'
    };

    if (event.httpMethod !== 'POST') {
        return { statusCode: 200, headers, body: 'Bot Online' };
    }

    try {
        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

        const data = JSON.parse(event.body);
        let promptInput = '';
        
        if (data.messages && Array.isArray(data.messages)) {
            const lastMsg = data.messages[data.messages.length - 1];
            promptInput = lastMsg.content;
        } else {
            promptInput = data.message || 'Hello';
        }

        const result = await model.generateContent(promptInput);
        const response = await result.response;
        const text = response.text();

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({ 
                choices: [{ message: { content: text } }],
                reply: text
            }) 
        };

    } catch (error) {
        console.error('Gemini Error:', error);
        return { 
            statusCode: 500, 
            headers,
            body: JSON.stringify({ error: error.message }) 
        };
    }
};
