exports.handler = async (event) => {
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Content-Type': 'application/json'
    };

    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers, body: '' };
    }

    try {
        let userText = "Hello";
        if (event.body) {
            const body = JSON.parse(event.body);
            userText = body.text || "Hello";
        }

        // Simple keyword-based responses that feel natural
        // ElevenLabs ConvAI WebSocket doesn't support text-only conversations
        // For dynamic AI responses, use voice chat which connects to the real agent
        const lowerText = userText.toLowerCase().trim();
        let reply;

        if (lowerText.includes('hi') || lowerText.includes('hello') || lowerText.includes('hey')) {
            const greetings = [
                "Hey there! Welcome to BrewHub! 🙌",
                "Hi! Great to see you! What brings you in today?",
                "Hey! Welcome to the neighborhood hub! ☕"
            ];
            reply = greetings[Math.floor(Math.random() * greetings.length)];
        } else if (lowerText.includes('menu') || lowerText.includes('what do you have') || lowerText.includes('drinks')) {
            reply = "We'll have all the classics - lattes, cappuccinos, cold brew, plus some seasonal specials! Hit the voice button to chat with me about recommendations! 🎤";
        } else if (lowerText.includes('when') || lowerText.includes('open') || lowerText.includes('hours')) {
            reply = "We're gearing up for our grand opening! Join the waitlist above and we'll keep you posted on the exact date! 🎉";
        } else if (lowerText.includes('where') || lowerText.includes('location') || lowerText.includes('address')) {
            reply = "We're setting up shop in Point Breeze, Philadelphia! More details coming soon to our Instagram @brewhubphl 📍";
        } else if (lowerText.includes('waitlist') || lowerText.includes('sign up') || lowerText.includes('list')) {
            reply = "Just drop your email in the form above and you're in! You'll be the first to know about our opening and exclusive perks! ✨";
        } else if (lowerText.includes('coffee') || lowerText.includes('latte') || lowerText.includes('espresso')) {
            reply = "Ooh, you're speaking my language! ☕ We're gonna have amazing coffee. Try the voice chat to talk more about what you like!";
        } else if (lowerText.includes('thank')) {
            reply = "You're so welcome! Can't wait to serve you when we open! 💛";
        } else if (lowerText.includes('bye') || lowerText.includes('later') || lowerText.includes('see you')) {
            reply = "See you soon! Don't forget to join the waitlist! ☕✌️";
        } else {
            const defaults = [
                "I'd love to chat more! Try the voice button for a real conversation with me 🎤",
                "Great question! Hit the voice chat button and let's talk! 🎙️",
                "For the best experience, try our voice chat - I can really help you out there! 🎤"
            ];
            reply = defaults[Math.floor(Math.random() * defaults.length)];
        }

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({ reply })
        };

    } catch (error) {
        console.error("Error:", error.message);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ error: error.message })
        };
    }
};
