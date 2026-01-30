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
        // "systemInstruction" is supported in the getGenerativeModel config for gemini-1.5-flash and gemini-2.0-flash
        const model = genAI.getGenerativeModel({ 
            model: 'gemini-2.0-flash',
            systemInstruction: "You are BrewBot, the friendly AI assistant for BrewHub PHL, a coffee shop and parcel pickup spot in South Philadelphia. Be helpful, concise, and friendly. Use local Philly slang (like 'neighbor', 'jawn') occasionally but don't overdo it. If asked about hours, checks, or services, give accurate info. Current Date: " + new Date().toDateString()
        });

        const data = JSON.parse(event.body);
        let history = [];
        let lastUserMessage = "Hello";

        // Convert frontend history to Gemini SDK history format
        if (data.messages && Array.isArray(data.messages)) {
            // Seperate the last message (current input) from the history
            const pastMessages = data.messages.slice(0, -1);
            const currentMessage = data.messages[data.messages.length - 1];

            lastUserMessage = currentMessage.content;

            history = pastMessages.map(msg => ({
                role: msg.role === 'assistant' ? 'model' : 'user',
                parts: [{ text: msg.content }]
            }));
        } else {
            lastUserMessage = data.message || "Hello";
        }

        const chat = model.startChat({
            history: history,
            generationConfig: {
                maxOutputTokens: 300,
            },
        });

        const result = await chat.sendMessage(lastUserMessage);
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
