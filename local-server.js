const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const http = require('http');
const https = require('https');
require('dotenv').config();

const devConfig = require('./dev-config');

const app = express();
const PORT = 3000;

// Hybrid mode: proxy heavy functions to Netlify preview
const PREVIEW_URL = process.env.NETLIFY_PREVIEW_URL || devConfig.previewUrl;
const OFFLOAD_FUNCTIONS = devConfig.offloadFunctions || [];

// Security: Disable X-Powered-By header
app.disable('x-powered-by');

// Middleware to parse JSON bodies
app.use(bodyParser.json());

// Dev status endpoint
app.get('/dev-status', (req, res) => {
    res.json({
        mode: PREVIEW_URL ? 'hybrid' : 'local',
        previewUrl: PREVIEW_URL || null,
        offloadedFunctions: PREVIEW_URL ? OFFLOAD_FUNCTIONS : [],
        localFunctions: PREVIEW_URL ? 'all others' : 'all'
    });
});

// Proxy middleware for offloaded functions
function proxyToNetlify(functionName, req, res) {
    const url = new URL(`/.netlify/functions/${functionName}`, PREVIEW_URL);
    const isHttps = url.protocol === 'https:';
    const lib = isHttps ? https : http;

    console.log(`  ☁️  Proxying ${functionName} → ${url.href}`);

    const options = {
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: url.pathname,
        method: req.method,
        headers: {
            'Content-Type': 'application/json',
            ...req.headers
        }
    };

    const proxyReq = lib.request(options, (proxyRes) => {
        let data = '';
        proxyRes.on('data', chunk => data += chunk);
        proxyRes.on('end', () => {
            res.status(proxyRes.statusCode);
            Object.entries(proxyRes.headers).forEach(([k, v]) => res.setHeader(k, v));
            res.send(data);
        });
    });

    proxyReq.on('error', (err) => {
        console.error(`  ❌ Proxy error: ${err.message}`);
        res.status(502).json({ error: 'Proxy failed', details: err.message });
    });

    if (req.body) {
        proxyReq.write(JSON.stringify(req.body));
    }
    proxyReq.end();
}

// Generic function handler - runs locally or proxies
async function handleFunction(functionName, req, res) {
    // Check if should proxy
    if (PREVIEW_URL && OFFLOAD_FUNCTIONS.includes(functionName)) {
        return proxyToNetlify(functionName, req, res);
    }

    // Run locally
    console.log(`  🏠 Running ${functionName} locally`);
    try {
        const { handler } = require(`./netlify/functions/${functionName}.js`);
        const event = {
            httpMethod: req.method,
            headers: req.headers,
            body: JSON.stringify(req.body),
            queryStringParameters: req.query
        };
        const response = await handler(event);
        res.status(response.statusCode);
        if (response.headers) {
            Object.entries(response.headers).forEach(([k, v]) => res.setHeader(k, v));
        }
        res.send(response.body);
    } catch (err) {
        console.error(`  ❌ Error: ${err.message}`);
        res.status(500).json({ error: err.message });
    }
}

// Serve static files from 'public' folder
app.use(express.static(path.join(__dirname, 'public')));

// Dynamic function routes
app.all('/.netlify/functions/:fn', (req, res) => handleFunction(req.params.fn, req, res));
app.all('/api/:fn', (req, res) => handleFunction(req.params.fn, req, res));

// Legacy test routes (keeping for backward compat)
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
    console.log(`🚀 Local Server Running on http://localhost:${PORT}`);
    console.log(`---------------------------------------------------------`);
    if (PREVIEW_URL) {
        console.log(`\n☁️  HYBRID MODE - Heavy functions proxied to:`);
        console.log(`   ${PREVIEW_URL}`);
        console.log(`\n   Offloaded: ${OFFLOAD_FUNCTIONS.join(', ')}`);
    } else {
        console.log(`\n🏠 LOCAL MODE - All functions running locally`);
        console.log(`   Tip: Set NETLIFY_PREVIEW_URL to offload heavy functions`);
    }
    console.log(`\n📊 Check status: http://localhost:${PORT}/dev-status\n`);
});
