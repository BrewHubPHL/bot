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
│   └── api/               #   App Router API routes (rate-limited wrappers)
│       ├── check-in/      #     Parcel check-in (rate-limited proxy)
│       └── revalidate/    #     Cache revalidation endpoint
├── src/lib/               # Shared utilities
│   ├── supabase.ts        #   Supabase client
│   ├── rateLimit.ts       #   In-memory IP rate limiter
│   └── escapeHtml.ts      #   HTML entity escaper for emails
├── public/                # Static assets (icons, manifest, robots.txt)
├── netlify/functions/     # Serverless API endpoints (50+ functions)
├── supabase/              # DB schemas (1–33), RPC functions, RLS policies
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
| `/careers` | Public job application page |
| `/checkout` | Cart → Square payment |
| `/login` | Staff PIN login |
| `/menu` | Public menu display |
| `/parcels` | Parcel history (**⚠ unauthenticated — audit issue FE-C3**) |
| `/parcels/monitor` | Real-time parcel monitor (Supabase Realtime) |
| `/queue` | Public lobby order board (first names only) |
| `/resident` | Resident lookup / parcel log |
| `/staff-hub` | Staff portal (clock, orders, inventory) |
| `/waitlist` | Manage/view waitlist |
| `/admin/dashboard` | Admin dashboard (**⚠ not in middleware auth — audit issue FE-C1**) |
| `/admin/inventory` | Admin inventory (**⚠ not in middleware auth — audit issue FE-C1**) |
| `/thank-you` | Post-checkout confirmation |
| `/about`, `/privacy`, `/terms` | Info pages |

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
| `process-merch-payment` | Merch storefront checkout via Square |
| `square-webhook` | Handles `payment.updated` → marks paid, triggers loyalty + inventory + receipt |
| `square-sync` | Syncs new Supabase orders to Square |
| `update-order-status` | KDS status transitions (preparing → ready → completed) via `safe_update_order_status` RPC |
| `redeem-voucher` | Loyalty voucher redemption via `atomic_redeem_voucher` RPC |
| `cancel-stale-orders` | Scheduled: cancels orders stuck in pending/unpaid >30 min |

### AI & Voice
| Function | Description |
|---|---|
| `claude-chat` | Claude conversational AI with identity-bound tool use |
| `text-to-speech` | ElevenLabs TTS for voice responses |

### Staff Auth & Clock
| Function | Description |
|---|---|
| `pin-login` | PIN authentication → HMAC session cookie (8h expiry) |
| `pin-logout` | Clear session cookie |
| `pin-verify` | Verify active PIN session |
| `pin-clock` | Clock in/out via `atomic_staff_clock` RPC |
| `log-time` | Legacy clock endpoint (direct INSERT/UPDATE — audit gap) |
| `fix-clock` | Fix missing clock-out (direct UPDATE — audit gap) |

### Operations
| Function | Description |
|---|---|
| `parcel-check-in` / `parcel-pickup` / `register-tracking` | Parcel logistics flow |
| `inventory-check` / `inventory-lookup` / `adjust-inventory` / `create-inventory-item` | Inventory management |
| `get-loyalty` / `redeem-voucher` | Loyalty & rewards |
| `manage-catalog` / `upload-menu-image` | Menu/merch catalog CRUD |
| `update-hours` / `get-payroll` | Payroll management via `atomic_payroll_adjustment` RPC |
| `marketing-bot` / `marketing-sync` / `supabase-to-sheets` | Marketing ops |
| `sales-report` / `export-csv` | Reports & data export |
| `send-sms-email` / `order-announcer` | Notifications (Resend + Twilio) |
| `search-residents` | Resident search (PIN + 15-min freshness) |
| `ops-diagnostics` | Manager-only system diagnostics |
| `get-manager-stats` / `get-kds-orders` / `get-receipts` / `get-recent-activity` | Operational data retrieval |

### Hiring
| Function | Description |
|---|---|
| `submit-application` | Public job application (honeypot + timing defense) |
| `get-applications` | View applications (staff auth) |
| `update-application-status` | Change application status (staff auth) |

### Public & Config
| Function | Description |
|---|---|
| `get-menu` / `get-merch` / `shop-data` | Public catalog data |
| `get-queue` | Public lobby order board (first names only) |
| `public-config` | Square public identifiers |
| `health` | System health check |
| `navigate-site` | Site navigation helper |
| `site-settings-sync` | Shop/cafe mode toggle |
| `create-customer` | Create customer record |
| `tool-check-waitlist` | AI tool: waitlist check |

### Scheduled & Background
| Function | Description |
|---|---|
| `cancel-stale-orders` | Cancels orders stuck in pending/unpaid >30 min (cron: `*/5 * * * *`) |
| `queue-processor` | Processes parcel notification queue (batches of 5) |

### Shared Modules (not endpoints)
| Module | Description |
|---|---|
| `_auth.js` | Central auth: JWT validation + PIN HMAC tokens + role enforcement + token versioning |
| `_csrf.js` | CSRF header validation (`X-BrewHub-Action`) |
| `_gdpr.js` | Tombstone-based deletion & GDPR compliance |
| `_ip-guard.js` | Rate limiting with timing-safe comparison |
| `_ip-hash.js` | SHA-256 IP hashing with salt |
| `_receipt.js` | 32-column thermal receipt generator |
| `_sanitize.js` | Input sanitization (strip tags, scripts, event handlers) |
| `_token-bucket.js` | In-memory token bucket rate limiter |
| `_usage.js` | DB-backed daily API quota tracking |

---

## 🔄 Order Lifecycle

```
┌─────────────┐    ┌──────────┐    ┌───────────┐    ┌───────┐    ┌───────────┐
│   pending    │───▶│  unpaid  │───▶│   paid    │───▶│ preparing │───▶│  ready  │───▶ completed
│ (checkout)   │    │ (AI order)│   │ (POS/webhook)│  │  (KDS)    │   │ (KDS)   │
└─────────────┘    └──────────┘    └───────────┘    └───────┘    └───────────┘
```

**POS flow:** Staff builds order → "Send to KDS" (creates Supabase order, KDS sees it instantly via realtime) → "Pay on Terminal" (calls `collect-payment` → Square Terminal) or "Cash/Comp".

**Database triggers:** `sync_coffee_order_status` syncs status to line items · `handle_order_completion` decrements inventory on completion (exact `'12oz Cups'` match).

### Supabase Schema Migrations
The database is managed through sequential migration files (`schema-1` through `schema-43`):

| Schema | Purpose |
|---|---|
| `schema-1` – `schema-5` | Core tables, functions, RPCs, RLS policies |
| `schema-6` – `schema-7` | Trigger rewrites (order completion, coffee status cascade) |
| `schema-8-pin` | PIN auth system (staff_directory.pin, token_version) |
| `schema-9-receipts` | `receipt_queue` table + `orders.completed_at` column |
| `schema-10-payment-hardening` | `cancel_stale_orders` RPC + `orders.paid_amount_cents` column |
| `schema-11-medium-fixes` | DB-backed PIN lockout (`pin_attempts`) + staff-scoped RLS SELECT policies |
| `schema-12-rls-bootstrap-fix` | Fix RLS bootstrap deadlock with `SECURITY DEFINER` staff helper |
| `schema-13-catalog-rls` | Staff-scoped RLS for catalog manager and inventory |
| `schema-14-parcel-monitor-rls` | PII-masking VIEW for parcel departure board + staff RLS |
| `schema-15-job-applications` | Job applications table with anon INSERT, staff SELECT/UPDATE RLS |
| `schema-16-cleanup` | Missing columns (profiles.email, orders.paid_at), FK constraints |
| `schema-17-product-category` | Add `category` column (menu/merch) to `merch_products` |
| `schema-18-ground-truth-reconciliation` | Missing columns from CSV-vs-code cross-reference audit |
| `schema-19-fix-duplicate-fk` | Drop duplicate unnamed FK on `coffee_orders.order_id` |
| `schema-20-catalog-delete-rls` | Missing DELETE RLS policy for `merch_products` |
| `schema-21-resume-url-rls` | Strict `WITH CHECK` on `resume_url` to prevent injection |
| `schema-22-security-hardening` | Atomic loyalty with `SELECT … FOR UPDATE` locking |
| `schema-23-security-hardening` | Storage bucket upload lockdown + `price_cents > 0` constraint |
| `schema-24-rbac-idor-hardening` | Manager-only write policies + parcels IDOR fix for residents |
| `schema-25-order-timeout-cleanup` | Abandon stale pending orders after 15 min + prune webhooks |
| `schema-26-soft-delete-payroll-refund` | Soft-delete guard, payroll validation, refund inventory restore |
| `schema-27-audit-fixes` | Revoke dangerous RPCs from anon, fix triggers, add indexes/RLS |
| `schema-28-audit-fixes-2` | Restore price guard, fix completion trigger, harden storage & summary |
| `schema-29-catalog-archive` | Two-tier hide/archive with `archived_at` and partial index |
| `schema-30-inventory-ssot` | Inventory SSOT: `cups_decremented`, row-locking trigger |
| `schema-31-drop-redundant-customer-cols` | Migrate legacy `name` → `full_name`, `address` → `address_street` |
| `schema-32-kds-update-rls` | Staff UPDATE policy on orders for KDS status workflow |
| `schema-33-receipt-realtime` | Anon SELECT on receipt_queue for Supabase Realtime |
| `schema-34-comp-audit` | Complimentary order audit table with deny-all RLS |
| `schema-35-voucher-hardening` | Cryptographic `code_hash` (SHA-256), circuit breaker, daily redemption cap |
| `schema-36-security-hardening` | Profile column guard, `staff_directory_safe` VIEW, refund lock |
| `schema-37-audit-critical-fixes` | NOT NULL/UNIQUE enforcement, indexes, `inventory_audit_log` |
| `schema-38-loyalty-ssot-sync` | Loyalty sync trigger: profiles → customers |
| `schema-39-total-defense-audit` | Temporal jitter on parcels, statement timeouts, IP hashing |
| `schema-40-loyalty-ssot-bulletproof` | Advisory-locked loyalty sync, system_sync_logs, reconciliation |
| `schema-41-order-status-remediation` | `safe_update_order_status` RPC, trigger EXCEPTION handlers |
| `schema-42-atomic-staff-clock` | `atomic_staff_clock()` — sole clock-in/out path with advisory lock |
| `schema-43-payroll-adjustment-audit` | IRS-compliant `atomic_payroll_adjustment()`, `v_payroll_summary` VIEW |
| `schema-free-coffee` | Manual voucher INSERT snippet (not a migration) |

---

## Voice Usage Policy
Voice features are limited to the public-facing chatbot only.
- **Allowed:** Homepage voice chat via Claude AI + ElevenLabs TTS
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
| `IP_HASH_SALT` | Salt for SHA-256 IP hashing in audit logs |
| `WORKER_SECRET` | Cron/worker authentication |
| `CRON_SECRET` | Scheduled function authentication |

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
| `GEMINI_API_KEY` | Google Gemini (alternate AI model) |
| `ELEVENLABS_API_KEY` | Voice synthesis (TTS) |
| `RESEND_API_KEY` | Transactional email |
| `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` | Twilio SMS |
| `TWILIO_MESSAGING_SERVICE_SID` | Twilio messaging service |
| `GOOGLE_SCRIPT_URL` | Google Sheets sync |

---

## 🚀 Development

```bash
npm install          # Install dependencies
npm run dev          # Next.js dev server
npm test             # Run Jest tests
npm run lint         # ESLint
```

## Notes
- All Square functions use `SQUARE_PRODUCTION_TOKEN` with hardcoded `SquareEnvironment.Production`.
- All pages are served by Next.js App Router. Legacy HTML has been permanently deleted.
- KDS, manager dashboard, and all ops pages are under `src/app/(ops)/` with PIN-based auth.
- API rate limiting is enforced via `src/lib/rateLimit.ts` on App Router API routes.
- Email templates use `escapeHtml()` to prevent HTML injection in user-supplied fields.
