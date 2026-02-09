const { checkQuota } = require('./_usage');

exports.handler = async (event) => {
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Content-Type': 'application/json'
    };

    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers, body: '' };
    }

    // Rate limit to prevent Denial-of-Wallet attacks
    const hasQuota = await checkQuota('claude_chat');
    if (!hasQuota) {
        return {
            statusCode: 429,
            headers,
            body: JSON.stringify({ reply: 'Elise is resting her voice. Try again later! ☕' })
        };
    }

    try {
        let userText = "Hello";
        let conversationHistory = [];
        if (event.body) {
            const body = JSON.parse(event.body);
            userText = body.text || "Hello";
            conversationHistory = body.history || [];
        }

        const claudeKey = process.env.CLAUDE_API_KEY;
        
        // Use Claude API for AI responses
        if (claudeKey) {
            try {
                // Build messages array with conversation history
                const messages = [
                    ...conversationHistory.slice(-10), // Keep last 10 messages for context
                    { role: 'user', content: userText }
                ];

                const claudeResp = await fetch('https://api.anthropic.com/v1/messages', {
                    method: 'POST',
                    headers: {
                        'x-api-key': claudeKey,
                        'anthropic-version': '2023-06-01',
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        model: 'claude-sonnet-4-20250514',
                        max_tokens: 150,
                        system: `You are Elise the BrewHubPHL AI assistant, located in the heart of Point Breeze, South Philly. You are friendly, direct, and helpful. You know the neighborhood well. You help residents with packages, coffee orders, and loyalty points. Use local flavor—not over-the-top, but let them know we’re part of the community. 

Key info:
- BrewHub is a neighborhood coffee hub opening soon in Point Breeze, Philly
- For marketing/business inquiries: info@brewhubphl.com
- Instagram: @brewhubphl
- Menu will have lattes, cappuccinos, cold brew, espresso, tea, pastries
- Good wifi and workspace vibes
- Hiring announcements on Instagram
- Join waitlist on the website for opening updates
- parcel services include options for monthly mailbox rentals with 24/7 access or basic shipping and receiving during business hours
- we also offer a cozy lounge area with comfortable seating, free Wi-Fi, and a selection of coffee and tea for our mailbox renters and local community to enjoy while they work or wait for their packages

Keep responses short, friendly, and helpful (1-2 sentences max). Use emojis sparingly.`,
                        messages: messages
                    })
                });

                if (claudeResp.ok) {
                    const claudeData = await claudeResp.json();
                    const reply = claudeData.content?.[0]?.text || "Hey! How can I help you today?";
                    return {
                        statusCode: 200,
                        headers,
                        body: JSON.stringify({ reply })
                    };
                } else {
                    console.error('Claude API error:', claudeResp.status, await claudeResp.text());
                }
            } catch (e) {
                console.error('Claude error:', e.message);
            }
        } else {
            console.error('No CLAUDE_API_KEY found');
        }

        // Fallback: Simple keyword responses
        const lowerText = userText.toLowerCase().trim();
        let reply = "For any questions, feel free to email info@brewhubphl.com or DM us on Instagram @brewhubphl! ☕";

        if (lowerText.includes('hi') || lowerText.includes('hello') || lowerText.includes('hey')) {
            reply = "Hey there! Welcome to BrewHub! How can I help? ☕";
        } else if (lowerText.includes('email') || lowerText.includes('contact') || lowerText.includes('marketing')) {
            reply = "For business or marketing inquiries, email info@brewhubphl.com! 📧";
        } else if (lowerText.includes('menu') || lowerText.includes('drinks') || lowerText.includes('coffee') || lowerText.includes('black') || lowerText.includes('latte')) {
            reply = "We'll have all the classics - drip coffee, lattes, cappuccinos, cold brew and more! Can't wait to serve you ☕";
        } else if (lowerText.includes('when') || lowerText.includes('open')) {
            reply = "We're gearing up for our grand opening! Join the waitlist above to be the first to know! 🎉";
        } else if (lowerText.includes('where') || lowerText.includes('location')) {
            reply = "We're setting up in Point Breeze, Philadelphia! Follow @brewhubphl for updates 📍";
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
            body: JSON.stringify({ error: 'Chat failed' })
        };
    }
};
