# BrewHub Square Integration - Debug Plan

## Problem Summary
The `netlify dev` server crashes immediately after startup when running locally. The server shows "Local dev server ready" then exits with code 1 before any requests can be made.

## Environment
- **Node.js**: v24.13.0 (very new, released recently)
- **Netlify CLI**: v23.14.0
- **OS**: Windows 11
- **Square SDK**: v44.0.0

## Root Cause Analysis
The issue is **NOT** with the Square sync function itself - it loads fine in isolation:
```bash
node -e "require('./netlify/functions/square-sync.js'); console.log('OK')"
# Output: OK
```

The issue is a **compatibility problem between Netlify CLI and Node 24**. The dev server starts, loads all 7 functions successfully, then immediately exits.

## Data Flow (When Working)
```
1. Order inserted → Supabase
2. Supabase trigger → POST /supabase-webhook
3. Webhook router → checks x-brewhub-secret header
4. If INSERT → routes to /square-sync
5. square-sync → creates order in Square Sandbox
6. square-sync → updates Supabase with square_order_id
```

## Potential Fixes (In Order of Priority)

### Option 1: Downgrade Node.js (Recommended)
Node 24 is cutting-edge and may have breaking changes. Try Node 20 LTS:
```bash
# Using nvm-windows
nvm install 20
nvm use 20
npx netlify dev
```

### Option 2: Test on Netlify Directly
Skip local dev and deploy to a preview branch:
```bash
git checkout -b test-square
git add .
git commit -m "Test Square integration"
git push origin test-square
# Netlify will auto-deploy preview
```
Then test the function at `https://test-square--brewhubphl.netlify.app/.netlify/functions/square-sync`

### Option 3: Use Express Server for Local Testing
Bypass Netlify CLI entirely with [local-server.js](local-server.js):
```bash
# Create .env file with your secrets
node local-server.js
# Test at http://localhost:3000/test/square-sync
```

### Option 4: Update Netlify CLI
Check if there's a newer version with Node 24 fixes:
```bash
npm install -g netlify-cli@latest
npx netlify --version
```

## Files Involved
| File | Purpose |
|------|---------|
| `netlify/functions/supabase-webhook.js` | Routes INSERT → square-sync, UPDATE(paid) → order-announcer |
| `netlify/functions/square-sync.js` | Creates Square order, updates Supabase with order ID |
| `netlify/functions/order-announcer.js` | Triggers ElevenLabs TTS when order paid |
| `test-checkout.js` | End-to-end test script |
| `local-server.js` | Express server for local function testing |

## Required Environment Variables
```
SQUARE_SANDBOX_TOKEN     # Square API access token (sandbox)
SQUARE_LOCATION_ID       # Square location for orders
SUPABASE_SERVICE_ROLE_KEY # Supabase admin access
INTERNAL_SYNC_SECRET     # Webhook authentication
```

## Next Steps
1. **Try Option 1** - Install Node 20 LTS and retest
2. If that works, document the Node version requirement
3. If not, use Option 2 to test directly on Netlify's infrastructure
4. Once working, run `test-checkout.js` to verify full flow

## Status
- [x] Square SDK loads correctly
- [x] Function file syntax valid
- [x] Env vars configured in Netlify
- [x] Local dev server stays running (Node 20 required)
- [x] Square order creation works
- [ ] Supabase gets updated with square_order_id
