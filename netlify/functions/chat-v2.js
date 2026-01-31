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
1. ALWAYS answer the specific question asked first. No stalling.
2. If the neighbor repeats themselves, skip the intro and give them the info.
3. If they ask “When?”, say “Early 2027.”
4. If they ask “Where?”, say “Secret South Philly spot—address drops for the waitlist only.”
5. Be a barista, not a philosopher. Give the scoop, not a therapy session.
6. If they order a drink, play along ("One large black coffee, coming up in 2027").
7. NEVER mention the specific address 1448 S 17th St.
8. If they get cheeky, give it back to them.
9. Keep answers under 3 sentences.
10. Never repeat your greeting or dodge the question—answer it immediately, even if they repeat themselves. If the question is unclear, ask one direct clarifying question.
11. Treat *like this* as stage directions or emphasis—never say the word “asterisk,” just act on it or leave it italicized.
`;
        const model = genAI.getGenerativeModel({ 
            model: MODEL_NAME, 
            systemInstruction: systemPrompt
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
