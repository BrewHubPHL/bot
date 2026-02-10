const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
require('dotenv').config(); // Load environment variables from .env

const app = express();
const PORT = 3000;

// Middleware to parse JSON bodies
app.use(bodyParser.json());

// Serve static files from 'public' folder
app.use(express.static(path.join(__dirname, 'public')));

// Test route for supabase-webhook
app.post('/test/webhook', async (req, res) => {
    console.log("Testing supabase-webhook...");
    
    const { handler } = require('./netlify/functions/supabase-webhook.js');
    
    const event = {
        httpMethod: 'POST',
        headers: {
            'x-brewhub-secret': process.env.INTERNAL_SYNC_SECRET
        },
        body: JSON.stringify(req.body)
    };

    try {
        const response = await handler(event);
        console.log("Response:", response);
        res.status(response.statusCode).json(JSON.parse(response.body));
    } catch (err) {
        console.error("Error:", err);
        res.status(500).json({ error: err.message });
    }
});

// Test route for square-sync
app.post('/test/square-sync', async (req, res) => {
    console.log("Testing square-sync...");
    
    const { handler } = require('./netlify/functions/square-sync.js');
    
    const event = {
        httpMethod: 'POST',
        body: JSON.stringify(req.body)
    };

    try {
        const response = await handler(event);
        console.log("Response:", response);
        res.status(response.statusCode).json(JSON.parse(response.body));
    } catch (err) {
        console.error("Error:", err);
        res.status(500).json({ error: err.message });
    }
});

// Test route for tool-check-waitlist
app.post('/test/check-waitlist', async (req, res) => {
    console.log("Testing tool-check-waitlist...");
    
    const { handler } = require('./netlify/functions/tool-check-waitlist.js');
    
    const event = {
        httpMethod: 'POST',
        body: JSON.stringify(req.body)
    };

    try {
        const response = await handler(event);
        console.log("Response:", response);
        res.status(response.statusCode).json(JSON.parse(response.body));
    } catch (err) {
        console.error("Error:", err);
        res.status(500).json({ error: err.message });
    }
});

app.listen(PORT, () => {
    console.log(`\n---------------------------------------------------------`);
    console.log(`🚀 Local Server Running!`);
    console.log(`🔗 Open http://localhost:${PORT} in your browser.`);
    console.log(`---------------------------------------------------------\n`);
});
