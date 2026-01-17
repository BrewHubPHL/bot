exports.handler = async (event) => {
    if (event.httpMethod !== 'POST') return { statusCode: 405 };

    const { messages } = JSON.parse(event.body);

    const response = await fetch('https://api.x.ai/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.GROK_API_KEY}`
        },
        body: JSON.stringify({
            model: 'grok-3-mini',
            messages,
            temperature: 0.7,
            max_tokens: 300
        })
    });

    const data = await response.json();
    return {
        statusCode: response.status,
        body: JSON.stringify(data)
    };
};