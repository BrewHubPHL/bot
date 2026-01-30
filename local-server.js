const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
require('dotenv').config(); // Load environment variables from .env
const { handler } = require('./netlify/functions/chat-v2.js');

const app = express();
const PORT = 3000;

// Middleware to parse JSON bodies
app.use(bodyParser.json());

// Serve static files from 'public' folder
app.use(express.static(path.join(__dirname, 'public')));

// Mock the Netlify Function API route
app.post('/api/chat-v2', async (req, res) => {
    console.log("Local Server: Received Chat Request");
    
    // Create a mock Netlify event object
    const event = {
        httpMethod: 'POST',
        body: JSON.stringify(req.body)
    };

    try {
        // Call the actual function code
        const response = await handler(event);
        
        // Send the response back to the browser
        res.status(response.statusCode).set(response.headers).send(response.body);
    } catch (err) {
        console.error("Function Crash:", err);
        res.status(500).send(err.message);
    }
});

app.listen(PORT, () => {
    console.log(`\n---------------------------------------------------------`);
    console.log(`🚀 Local Server Running!`);
    console.log(`🔗 Open http://localhost:${PORT} in your browser.`);
    console.log(`---------------------------------------------------------\n`);
});
