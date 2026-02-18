## 🔒 Security
This project implements strict architectural security (HMAC, RLS, and Atomic Locks).
Please review [README_SECURITY.md](./README_SECURITY.md) before making changes to the backend.

---

# ☕ BrewHub PHL

**Coffee shop · Parcel hub · Coworking space — all in one platform.**

BrewHub PHL is a full-stack Next.js application deployed on Netlify with a Supabase backend. It powers a real cafe's daily operations: customer-facing homepage with AI chat, staff POS with Square Terminal integration, real-time kitchen display, parcel logistics, inventory management, loyalty rewards, and a merch storefront.

### Tech Stack

| Layer | Tech |
|---|---|
| Frontend | Next.js 16, React 19, Tailwind CSS 4, Lucide icons |
| Backend | Netlify Serverless Functions (Node.js) |
| Database | Supabase (Postgres + Realtime + RLS) |
| Payments | Square (Terminal API, Checkout API, Webhooks) |
| AI | Claude (Anthropic) — text chat · ElevenLabs — voice chat (Elise) |
| Email | Resend |
| Marketing | Google Sheets sync, Facebook Business SDK |

---

## 📁 Project Structure

```
brewhubbot/
├── src/app/               # Next.js App Router
│   ├── (site)/            #   Public pages (homepage, shop, about, portal)
│   ├── (ops)/             #   Staff ops — full-screen, no nav
│   │   ├── pos/           #     3-column POS (Categories → Builder → Ticket)
│   │   ├── kds/           #     Kitchen Display System
│   │   └── scanner/       #     Inventory barcode scanner
│   └── layout.tsx         #   Root layout
├── public/                # Legacy HTML pages (kds, manager, cafe, parcels)
├── netlify/functions/     # Serverless API endpoints (~40 functions)
├── supabase/              # DB schemas, RPC functions, RLS policies
├── scripts/               # Utilities (Apple Pay, secret rotation, AI tests)
└── tests/                 # Jest test suite
```

## 🖥️ Key Pages

### Next.js App (`src/app/`)
| Route | Description |
|---|---|
| `/` | Homepage — hero, waitlist, AI chat (text + voice) |
| `/shop` | Merch storefront with Square Checkout |
| `/cafe` | Customer cafe ordering |
| `/portal` | Resident portal (loyalty + parcels) |
| `/pos` | **Staff POS** — 3-column layout, Square Terminal payments |
| `/kds` | **Kitchen Display** — real-time order board |
| `/scanner` | Inventory barcode scanner |
| `/manager` | Manager dashboard (stats, KDS, inventory) |
| `/about`, `/privacy`, `/terms` | Info pages |

### Legacy HTML (`public/`)
| Page | Description |
|---|---|
| `kds.html` | Full-featured KDS (realtime, status transitions, stale alerts) |
| `manager.html` | Manager dashboard with embedded KDS widget |
| `cafe.html` | Legacy staff POS |
| `parcels.html` | Parcel check-in & pickup |
| `scan.html` | Inventory scanner |
| `shop.html` | Merch storefront (Square Checkout links) |

---

## ⚡ Netlify Functions

### Orders & Payments
| Function | Description |
|---|---|
| `cafe-checkout` | Staff POS checkout → creates order + coffee line items in Supabase |
| `collect-payment` | Sends payment to Square Terminal hardware |
| `create-checkout` | Generates Square payment links |
| `create-order` | Generic order creation with server-side price validation |
| `ai-order` | API for AI agents (Elise/Claude) to place orders |
| `square-webhook` | Handles `payment.updated` → marks paid, triggers loyalty + inventory |
| `square-sync` | Syncs new Supabase orders to Square |
| `update-order-status` | KDS status transitions (preparing → ready → completed) |

### AI & Voice
| Function | Description |
|---|---|
| `claude-chat` | Claude conversational AI with tool use (place orders, check menu) |
| `get-voice-session` | ElevenLabs ConvAI session initialization |
| `text-to-speech` | ElevenLabs TTS for voice responses |

### Operations
| Function | Description |
|---|---|
| `parcel-check-in` / `parcel-pickup` / `register-tracking` | Parcel logistics flow |
| `inventory-check` / `inventory-lookup` / `adjust-inventory` | Inventory management |
| `get-loyalty` / `redeem-voucher` | Loyalty & rewards |
| `marketing-bot` / `marketing-sync` / `supabase-to-sheets` | Marketing ops |
| `sales-report` | Daily sales aggregation |
| `send-sms-email` | Notifications via Resend |

---

## 🔄 Order Lifecycle

```
┌─────────────┐    ┌──────────┐    ┌───────────┐    ┌───────┐    ┌───────────┐
│   pending    │───▶│  unpaid  │───▶│   paid    │───▶│ preparing │───▶│  ready  │───▶ completed
│ (checkout)   │    │ (AI order)│   │ (POS/webhook)│  │  (KDS)    │   │ (KDS)   │
└─────────────┘    └──────────┘    └───────────┘    └───────┘    └───────────┘
```

**POS flow:** Staff builds order → "Send to KDS" (creates Supabase order, KDS sees it instantly via realtime) → "Pay on Terminal" (calls `collect-payment` → Square Terminal) or "Cash/Comp".

**Database triggers:** `sync_coffee_order_status` syncs status to line items · `handle_order_completion` decrements inventory on completion.

---

## Voice Usage Policy
Voice features are limited to the public-facing chatbot only.
- **Allowed:** Homepage voice chat with Elise (ElevenLabs ConvAI + TTS)
- **Not allowed:** Voice announcements for orders, KDS, or operational alerts
- Keep all operational flows text-only unless explicitly approved

---

## 🔑 Environment Variables

Required in Netlify:

### Core
| Variable | Purpose |
|---|---|
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-side DB access |
| `SUPABASE_ANON_KEY` | Client-side DB access |
| `INTERNAL_SYNC_SECRET` | HMAC for internal webhooks |
| `ALLOWED_IPS` | Comma-separated IPs for PIN login allowlist |

### Square (Production)
| Variable | Purpose |
|---|---|
| `SQUARE_PRODUCTION_TOKEN` | Square API token (all functions) |
| `SQUARE_LOCATION_ID` | Point Breeze location ID |
| `SQUARE_WEBHOOK_SIGNATURE` | HMAC key for webhook verification |
| `SQUARE_WEBHOOK_URL` | Exact webhook URL for signature computation |

### AI & Integrations
| Variable | Purpose |
|---|---|
| `CLAUDE_API_KEY` | Anthropic Claude chat |
| `ELEVENLABS_API_KEY` | Voice synthesis |
| `ELEVENLABS_AGENT_ID` | ConvAI agent |
| `RESEND_API_KEY` | Transactional email |
| `GOOGLE_SCRIPT_URL` | Google Sheets sync |

---

## 🚀 Development

```bash
npm install          # Install dependencies
npm run dev          # Next.js dev server
npm run dev:legacy   # Local server for public/ HTML pages
npm test             # Run Jest tests
npm run lint         # ESLint
```

## Notes
- All Square functions use `SQUARE_PRODUCTION_TOKEN` with hardcoded `SquareEnvironment.Production`.
- Legacy HTML pages and Next.js app share the same Supabase database and Netlify functions.
- KDS has two implementations: `public/kds.html` (full-featured) and `src/app/(ops)/kds/` (Next.js).
