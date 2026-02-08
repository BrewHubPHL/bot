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

        const grokKey = process.env.GROK_API_KEY || process.env.XAI_API_KEY;
        
        // Use Grok API for real AI responses
        if (grokKey) {
            try {
                const grokResp = await fetch('https://api.x.ai/v1/chat/completions', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${grokKey}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        model: 'grok-2',
                        messages: [
                            {
                                role: 'system',
                                content: `You are Elise, a friendly digital barista and concierge for BrewHub, a coffee shop opening soon in Point Breeze, Philadelphia. 

Key info:
- BrewHub is a neighborhood coffee hub opening soon in Point Breeze, Philly
- For marketing/business inquiries: info@brewhubphl.com
- Instagram: @brewhubphl
- Menu will have lattes, cappuccinos, cold brew, espresso, tea, pastries
- Good wifi and workspace vibes
- Hiring announcements on Instagram
- Join waitlist on the website for opening updates

Keep responses short, friendly, and helpful (1-2 sentences max). Use emojis sparingly.`
                            },
                            {
                                role: 'user',
                                content: userText
                            }
                        ],
                        max_tokens: 150
                    })
                });

                if (grokResp.ok) {
                    const grokData = await grokResp.json();
                    const reply = grokData.choices?.[0]?.message?.content || "Hey! How can I help you today?";
                    return {
                        statusCode: 200,
                        headers,
                        body: JSON.stringify({ reply })
                    };
                } else {
                    console.error('Grok API error:', grokResp.status, await grokResp.text());
                }
            } catch (e) {
                console.error('Grok error:', e.message);
            }
        } else {
            console.error('No GROK_API_KEY or XAI_API_KEY found');
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
