# BrewHub PHL - Architecture Overview

## Project Structure

```
brewhubbot/
├── netlify/functions/     # Serverless API endpoints
├── public/                # Legacy HTML pages (KDS, Manager, etc.)
├── src/                   # Next.js app (homepage, about)
├── supabase/              # Database schemas & edge functions
├── scripts/               # Utility scripts
└── tests/                 # Jest tests
```

## Core Systems

### 1. Cafe & Orders
- **ai-order.js** - API for AI agents (Elise/Claude) to place orders → `status: 'unpaid'`
- **claude-chat.js** - Claude conversational AI with `place_order` tool
- **create-checkout.js** - Square payment link generation → `status: 'pending'`
- **square-webhook.js** - Handles Square payment confirmations
- **update-order-status.js** - KDS status transitions
- **get-menu.js** - Public menu API for voice ordering

### 2. Kitchen Display System (KDS)
- **public/kds.html** - Real-time order display for baristas
- **public/manager.html** - Dashboard with KDS widget
- Order statuses: `pending` → `unpaid` → `paid` → `preparing` → `ready` → `completed`
- Payment warning shows until `payment_id` is set

### 3. Voice & AI
- **get-voice-session.js** - ElevenLabs ConvAI signed URL
- **text-to-speech.js** - ElevenLabs TTS
- **tool-check-waitlist.js** - AI tool for waitlist queries
- Elise (ElevenLabs agent) calls `/api/order` webhook

### 4. Parcel Hub
- **parcel-check-in.js** - Register incoming packages
- **parcel-pickup.js** - Verify resident pickup
- **search-residents.js** - Resident lookup

### 5. Marketing & CRM
- **marketing-bot.js** - AI-powered social media
- **marketing-sync.js** - Google Sheets sync
- **send-sms-email.js** - Twilio SMS + Resend email

### 6. Payments & Loyalty
- **collect-payment.js** - Square terminal payments
- **get-loyalty.js** - Points lookup
- **redeem-voucher.js** - Free coffee redemption

## Database (Supabase)

Key tables:
- `orders` - Cafe orders with status, payment_id, total
- `coffee_orders` - Line items linked to orders
- `residents` - Parcel hub members
- `parcels` - Package tracking
- `menu_items` - Cafe menu with prices
- `inventory` - Stock levels
- `staff` - Employee records with PIN auth

## Authentication
- **_auth.js** - Middleware: API key, staff PIN, or Supabase JWT
- **_gdpr.js** - Request logging & compliance
- **_ip-guard.js** - Rate limiting
- **_usage.js** - API quota tracking

## External Services
- **Supabase** - Database, Auth, Realtime
- **Square** - POS, Payments, Terminals
- **ElevenLabs** - Voice AI (Elise), TTS
- **Anthropic** - Claude chat
- **Twilio** - SMS notifications
- **Resend** - Transactional email
- **Apify** - Web scraping

## URL Routing

```
/api/order     → ai-order.js (AI ordering)
/api/menu      → get-menu.js
/api/loyalty   → get-loyalty.js
/kds.html      → Kitchen display
/manager.html  → Staff dashboard
/cafe.html     → Customer ordering
```

## Order Flow

### AI/Voice Orders (Elise, Claude)
1. Customer speaks to Elise or types to Claude
2. AI calls `/api/order` with items
3. Order created with `status: 'unpaid'`
4. KDS shows red card + "⚠️ COLLECT PAYMENT"
5. Barista starts preparing (status → `preparing`)
6. Customer pays at POS → Square webhook sets `payment_id`
7. Warning disappears, order completes normally

### Online Orders
1. Customer uses cafe.html checkout
2. `create-checkout.js` generates Square payment link
3. Order created with `status: 'pending'`
4. Customer pays → Square webhook updates to `paid`
5. KDS shows green card, normal flow

## Environment Variables

See `.env.example` for required keys:
- `SUPABASE_*` - Database connection
- `SQUARE_*` - Payment processing
- `ELEVENLABS_*` - Voice AI
- `CLAUDE_API_KEY` - Chat AI
- `TWILIO_*` - SMS
- `RESEND_API_KEY` - Email
- `BREWHUB_API_KEY` - Internal API auth
