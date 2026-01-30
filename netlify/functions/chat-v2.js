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
        const MODEL_NAME = process.env.GEMINI_MODEL || 'gemini-2.0-flash';
        // Default to the current 2.0 Flash tier (v1beta compatible). Provide GEMINI_MODEL to override if Google rotates names again.
        const model = genAI.getGenerativeModel({ 
            model: MODEL_NAME, 
            systemInstruction: "You are BrewBot, the friendly AI assistant for BrewHub PHL. Answer questions directly and never ask the guest what they need after they already told you. If someone orders a drink, kindly explain you are a virtual assistant and can only share info (menu, vibe, opening timeline, parcel lockers, hiring, etc.). If you do not know something, say you will check with Thomas and get back to them. Keep replies concise, warm, and specific to the user’s request." 
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

            // SANITIZE HISTORY: Gemini crashes if history is not User, Model, User, Model...
            // If we have User, User -> Merge them.
            // If the last message in history is User, it will crash because we are about to add ANOTHER User message (lastUserMessage).
            // So we must ensure history ends with Model (or is empty).
            
            const cleanHistory = [];
            for (const msg of history) {
                if (cleanHistory.length === 0) {
                    cleanHistory.push(msg);
                } else {
                    const prev = cleanHistory[cleanHistory.length - 1];
                    if (prev.role === msg.role) {
                        // Merge text into previous message
                        prev.parts[0].text += "\n\n" + msg.parts[0].text;
                    } else {
                        cleanHistory.push(msg);
                    }
                }
            }
            
            // Critical Check: If the history ends with USER, we are in trouble because we are about to send a USER message.
            // Gemini requires User -> Model -> User -> Model.
            // If history ends in User, we must fake a Model response or merge current input.
            // Simplest fix: If history ends in User, drop that last user message from history and prepend it to the current input.
            if (cleanHistory.length > 0 && cleanHistory[cleanHistory.length - 1].role === 'user') {
                const popped = cleanHistory.pop();
                lastUserMessage = popped.parts[0].text + "\n\n" + lastUserMessage;
            }

            history = cleanHistory;

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
        console.error('Gemini E:', error);
        // Return 200 so the frontend displays the error instead of crashing
        return { 
            statusCode: 200, 
            headers,
            body: JSON.stringify({ 
                choices: [{ 
                    message: { 
                        content: `(System Error) ${error.message || 'Unknown Error'}. \nStack: ${error.stack}` 
                    } 
                }] 
            }) 
        };
    }
};
