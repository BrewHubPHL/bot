## 🔒 Security
This project implements strict architectural security (HMAC, RLS, and Atomic Locks).
See [SYSTEM-BLUEPRINT.md](./SYSTEM-BLUEPRINT.md) and [SITE-MANIFEST.md](./SITE-MANIFEST.md) for the full security architecture and audit findings.

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

---

## 🔄 Order Lifecycle

```text
┌─────────────┐    ┌──────────┐    ┌───────────┐    ┌───────┐    ┌───────────┐
│   pending    │───▶│  unpaid  │───▶│   paid    │───▶│ preparing │───▶│  ready  │───▶ completed
│ (checkout)   │    │ (AI order)│   │ (POS/webhook)│  │  (KDS)    │   │ (KDS)   │
└─────────────┘    └──────────┘    └───────────┘    └───────┘    └───────────┘