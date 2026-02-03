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
        const lowerText = userText.toLowerCase().trim();
        let reply;

        if (lowerText.includes('hi') || lowerText.includes('hello') || lowerText.includes('hey')) {
            const greetings = [
                "Hey there! Welcome to BrewHub! ☕",
                "Hi! Great to see you! What brings you in today?",
                "Hey! Welcome to the neighborhood hub!"
            ];
            reply = greetings[Math.floor(Math.random() * greetings.length)];
        } else if (lowerText.includes('menu') || lowerText.includes('what do you have') || lowerText.includes('drinks')) {
            reply = "We'll have all the classics - lattes, cappuccinos, cold brew, plus some seasonal specials! Can't wait to serve you! ☕";
        } else if (lowerText.includes('when') || lowerText.includes('open') || lowerText.includes('hours')) {
            reply = "We're gearing up for our grand opening! Join the waitlist above and we'll keep you posted on the exact date! 🎉";
        } else if (lowerText.includes('where') || lowerText.includes('location') || lowerText.includes('address')) {
            reply = "We're setting up shop in Point Breeze, Philadelphia! More details coming soon to our Instagram @brewhubphl 📍";
        } else if (lowerText.includes('waitlist') || lowerText.includes('sign up') || lowerText.includes('list')) {
            reply = "Just drop your email in the form above and you're in! You'll be the first to know about our opening and exclusive perks! ✨";
        } else if (lowerText.includes('coffee')) {
            const coffeeReplies = [
                "Coffee is our passion! We'll have everything from classic drip to specialty lattes ☕",
                "You're speaking my language! We're gonna have some amazing roasts 🔥",
                "Can't wait to brew you a perfect cup! We're sourcing some incredible beans ☕"
            ];
            reply = coffeeReplies[Math.floor(Math.random() * coffeeReplies.length)];
        } else if (lowerText.includes('latte')) {
            reply = "Lattes are gonna be our specialty! Classic, vanilla, caramel, oat milk - we'll have it all ☕";
        } else if (lowerText.includes('espresso')) {
            reply = "We take our espresso seriously! Dialing in the perfect shot is an art 🎯";
        } else if (lowerText.includes('tea')) {
            reply = "We'll have a great tea selection too! Hot and iced options for everyone 🍵";
        } else if (lowerText.includes('food') || lowerText.includes('pastry') || lowerText.includes('eat')) {
            reply = "Fresh pastries and light bites are definitely on the menu! Perfect with your coffee ☕🥐";
        } else if (lowerText.includes('wifi') || lowerText.includes('work') || lowerText.includes('laptop')) {
            reply = "Absolutely! We're gonna be a great spot to work - good wifi and cozy vibes 💻☕";
        } else if (lowerText.includes('thank')) {
            reply = "You're so welcome! Can't wait to serve you when we open! 💛";
        } else if (lowerText.includes('bye') || lowerText.includes('later') || lowerText.includes('see you')) {
            reply = "See you soon! Don't forget to join the waitlist! ☕✌️";
        } else if (lowerText.includes('price') || lowerText.includes('cost') || lowerText.includes('how much')) {
            reply = "We're keeping prices fair and accessible for the neighborhood! Details coming soon 💰";
        } else if (lowerText.includes('job') || lowerText.includes('hiring') || lowerText.includes('work here')) {
            reply = "We'll be hiring soon! Keep an eye on our Instagram @brewhubphl for announcements 📣";
        } else {
            const defaults = [
                "That's a great question! Feel free to ask about our menu, location, or opening date ☕",
                "I'm here to help! Ask me about BrewHub - menu, hours, location, anything!",
                "Happy to chat! What would you like to know about BrewHub? ☕"
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
