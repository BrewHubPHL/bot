# BrewHub PHL — Architecture Overview
*Last updated: 2026-02-18*

## Project Structure

```
brewhubbot/
├── netlify/functions/     # 45+ serverless API endpoints
│   ├── _auth.js           # Central auth (JWT + PIN tokens)
│   ├── _gdpr.js           # Request logging & compliance
│   ├── _ip-guard.js       # Rate limiting & IP checks
│   ├── _usage.js          # API quota tracking
│   └── oauth/             # Square OAuth flow
├── public/                # Legacy HTML pages (KDS, Manager, etc.)
├── src/
│   ├── app/
│   │   ├── (ops)/         # PIN-gated staff pages (POS, KDS, Scanner)
│   │   ├── (site)/        # Public pages (Cafe, Shop, About, etc.)
│   │   └── layout.tsx     # Root layout
│   ├── components/
│   │   └── OpsGate.tsx    # Fullscreen PIN pad + session context
│   └── lib/               # Supabase client, utilities
├── supabase/              # DB schemas (schema-1 through schema-8)
├── scripts/               # Utility & test scripts
└── tests/                 # Jest tests
```

## Route Groups (Next.js App Router)

### `(ops)` — Staff Operations (PIN-gated)
All routes wrapped by `OpsGate` component — requires 6-digit staff PIN.

| Route | Page | Purpose |
|-------|------|---------|
| `/pos` | POS terminal | 3-column layout: categories → products → cart/ticket |
| `/kds` | Kitchen Display | Real-time order cards for baristas |
| `/scanner` | Barcode/QR scanner | Inventory + loyalty lookups |

### `(site)` — Public / JWT-gated
| Route | Purpose |
|-------|---------|
| `/` | Homepage |
| `/cafe` | Customer ordering |
| `/shop` | Merch store |
| `/checkout` | Cart checkout |
| `/admin/*` | Admin dashboard + inventory (JWT auth) |
| `/manager` | Staff dashboard (JWT auth) |
| `/parcels` | Parcel hub management |
| `/portal` | Resident portal |
| `/waitlist` | Pre-launch waitlist |

---

## Core Systems

### 1. Cafe & Orders
- **ai-order.js** — AI agent ordering (Elise/Claude) → `status: 'unpaid'`
- **claude-chat.js** — Claude conversational AI with `place_order` tool
- **cafe-checkout.js** — POS + online order creation (supports `terminal` flag)
- **create-checkout.js** — Square payment link generation → `status: 'pending'`
- **square-webhook.js** — Handles `payment.updated` + `refund.created` with HMAC verification
- **update-order-status.js** — KDS status transitions
- **get-menu.js** — Public menu API for voice ordering

### 2. Kitchen Display System (KDS)
- **public/kds.html** — Real-time order display for baristas
- **public/manager.html** — Dashboard with KDS widget
- Order statuses: `pending` → `unpaid` → `paid` → `preparing` → `ready` → `completed`
- POS orders start as `preparing` (terminal flag); online orders start as `paid`
- Payment warning shows on KDS until `payment_id` is set

### 3. Voice & AI
- **get-voice-session.js** — ElevenLabs ConvAI signed URL
- **text-to-speech.js** — ElevenLabs TTS
- **tool-check-waitlist.js** — AI tool for waitlist queries
- Elise (ElevenLabs agent) calls `/api/order` webhook

### 4. Parcel Hub
- **parcel-check-in.js** — Register incoming packages
- **parcel-pickup.js** — Verify resident pickup
- **search-residents.js** — Resident lookup

### 5. Marketing & CRM
- **marketing-bot.js** — AI-powered social media
- **marketing-sync.js** — Google Sheets sync
- **send-sms-email.js** — Twilio SMS + Resend email

### 6. Payments & Loyalty
- **collect-payment.js** — Square Terminal checkout (BigInt amounts, `SQUARE_TERMINAL_DEVICE_ID`)
- **process-merch-payment.js** — Direct card payments for merch (server-side price lookup)
- **create-checkout.js** — Square payment link for online orders
- **get-loyalty.js** — Points lookup
- **redeem-voucher.js** — Free coffee redemption
- **square-sync.js** — Sync orders to Square from Supabase webhook

### 7. Inventory & Shop
- **create-inventory-item.js** — Add stock items
- **adjust-inventory.js** — Increment/decrement stock
- **inventory-check.js** / **inventory-lookup.js** — Stock queries
- **get-merch.js** / **shop-data.js** — Merch product APIs

---

## Authentication — Dual System

### `_auth.js` — Central Auth Module

The `authorize(event, { requiredRole })` function accepts **two token formats**:

| Token Type | Format | Source | Detection |
|------------|--------|--------|-----------|
| **Supabase JWT** | 3 dot-separated parts (`header.payload.signature`) | `supabase.auth.getSession()` | `tokenParts.length === 3` |
| **PIN HMAC token** | 2 dot-separated parts (`base64-payload.hex-signature`) | `pin-login.js` | `tokenParts.length === 2` |

**Role hierarchy** (from `staff_directory`):

| Role | Level | Access |
|------|-------|--------|
| `staff` | 1 | POS, KDS, Scanner |
| `manager` | 2 | + Manager dashboard, reports |
| `admin` | 3 | + Admin panel, inventory, settings |

### PIN Login System

- **pin-login.js** — Validates 6-digit PIN, returns HMAC session token (8hr TTL)
  - Rate limiting: 5 attempts/min per IP
  - Timing-safe PIN comparison (`crypto.timingSafeEqual`)
  - IP allowlist via `ALLOWED_IPS` env var (localhost always allowed)
- **pin-clock.js** — Clock in/out using PIN session token
  - Prevents double clock-in
  - Updates `time_logs` + `staff_directory.is_working`
- **OpsGate.tsx** — React component wrapping all `(ops)` routes
  - Fullscreen PIN pad → on success stores session in `sessionStorage`
  - Header bar: staff name, shift timer, Clock In/Out button, Lock button
  - Exports `useOpsSession()` hook → `{ token, user, clockedIn }`
  - Hydration-safe: defers rendering until mounted

### Supporting Middleware
- **_gdpr.js** — Request logging & compliance
- **_ip-guard.js** — Rate limiting with timing-safe token comparison
- **_usage.js** — API quota tracking

---

## Square Integration (Production)

All Square clients use `SquareEnvironment.Production` + `SQUARE_PRODUCTION_TOKEN`.

### Webhook Security (`square-webhook.js`)
1. **Payload size cap** — 500 KB max
2. **HMAC-SHA256 verification** — `notificationUrl + rawBody` signed with `SQUARE_WEBHOOK_SIGNATURE`
3. **Timing-safe comparison** — `crypto.timingSafeEqual` on base64-decoded buffers
4. **Replay protection** — 5-minute timestamp window
5. **Idempotency** — `processed_webhooks` table with unique constraint (Postgres 23505)
6. **Fraud detection** — Amount validation (1% tolerance), currency check, payment reuse detection

### Event Routing
| Event | Handler | Action |
|-------|---------|--------|
| `payment.updated` (COMPLETED) | `handlePaymentUpdate()` | Mark order paid, award loyalty, generate voucher |
| `refund.created` | `handleRefund()` | Mark order refunded, revoke points, delete unused voucher |
| All others | Ignored | Return 200 |

---

## Database (Supabase)

### Schema migrations: `supabase/schema-1` through `schema-8-pin`

Key tables:
- `orders` — Cafe orders with status, payment_id, total_amount_cents
- `coffee_orders` — Line items linked to orders
- `menu_items` — Cafe menu with prices
- `merch_products` — Shop products with price_cents, is_active
- `residents` — Parcel hub members
- `parcels` — Package tracking
- `inventory` — Stock levels
- `staff_directory` — Employee records with `pin` (6-digit, unique), `role`, `is_working`
- `time_logs` — Clock in/out records
- `vouchers` — Generated free coffee codes with QR
- `processed_webhooks` — Idempotency table (unique `event_key`)
- `refund_locks` — Prevents voucher redemption during refund processing

### Key RPC functions
- `increment_loyalty` — Atomic points increment, triggers voucher at threshold
- `decrement_loyalty_on_refund` — Safe decrement (never below zero)

---

## Order Flows

### POS Orders (Staff PIN auth)
1. Staff logs in via 6-digit PIN on `/pos`
2. Builds cart → "Send to KDS"
3. `cafe-checkout.js` creates order with `status: 'preparing'`, `terminal: true`
4. KDS displays order immediately
5. Customer pays via Square (checkout link or terminal when configured)
6. Square webhook confirms payment → sets `payment_id`

### AI/Voice Orders (Elise, Claude)
1. Customer speaks to Elise or types to Claude
2. AI calls `/api/order` with items
3. Order created with `status: 'unpaid'`
4. KDS shows red card + "⚠️ COLLECT PAYMENT"
5. Barista starts preparing (status → `preparing`)
6. Customer pays at counter → Square webhook sets `payment_id`
7. Warning disappears, order completes normally

### Online Orders (Customer self-serve)
1. Customer uses `/cafe` checkout
2. `create-checkout.js` generates Square payment link
3. Order created with `status: 'pending'`
4. Customer pays → Square webhook updates to `paid`
5. KDS shows green card, normal flow

### Merch Orders
1. Customer shops at `/shop`, pays via card form
2. `process-merch-payment.js` — server-side price lookup, Square `payments.create`
3. Order stored with `type: 'merch'`

---

## Environment Variables

### Supabase
- `SUPABASE_URL` — Project URL
- `SUPABASE_SERVICE_ROLE_KEY` — Server-side admin key
- `NEXT_PUBLIC_SUPABASE_URL` — Client-side URL
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` — Client-side anon key

### Square (Production)
- `SQUARE_PRODUCTION_TOKEN` — Server API access token (secret)
- `SQUARE_PRODUCTION_APPLICATION_ID` — Client app ID (public, via `public-config.js`)
- `SQUARE_LOCATION_ID` — Point Breeze location
- `SQUARE_WEBHOOK_SIGNATURE` — HMAC key for webhook validation
- `SQUARE_WEBHOOK_URL` — Base URL for signature computation (`https://brewhubphl.com`)
- `SQUARE_TERMINAL_DEVICE_ID` — Hardware terminal device code (when available)
- `SQUARE_APP_ID` — OAuth app ID

### Auth & Security
- `BREWHUB_API_KEY` — Internal API auth
- `OPS_HMAC_SECRET` — HMAC key for PIN session tokens
- `ALLOWED_IPS` — Comma-separated IP allowlist for PIN login
- `SERVICE_SECRET` — Internal service-to-service auth

### AI & Voice
- `CLAUDE_API_KEY` — Anthropic Claude
- `ELEVENLABS_API_KEY` — ElevenLabs voice
- `ELEVENLABS_AGENT_ID` — Elise agent

### Communications
- `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` — SMS
- `RESEND_API_KEY` — Transactional email

### Infrastructure
- `SITE_URL` / `URL` — Site base URL for CORS + redirects
