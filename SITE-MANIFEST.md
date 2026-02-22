# SITE-MANIFEST.md — BrewHub PHL Full-Stack Audit & Reference

**Generated:** February 22, 2026  
**Status:** Production — Post-Forensic Audit  
**Stack:** Next.js 16 · Netlify Functions · Supabase (Postgres + Realtime) · Square · Claude AI · ElevenLabs

---

## Table of Contents

1. [Environment Variables](#1-environment-variables)
2. [3rd Party API Dependencies](#2-3rd-party-api-dependencies)
3. [Shared Utilities](#3-shared-utilities-srclib)
4. [Complete Netlify Functions Inventory](#4-complete-netlify-functions-inventory)
5. [Complete SQL Schema Inventory (1–43)](#5-complete-sql-schema-inventory-143)
6. [Complete Frontend Page Inventory](#6-complete-frontend-page-inventory)
7. [Frontend Components Inventory](#7-frontend-components-inventory)
8. [Supabase Edge Functions](#8-supabase-edge-functions)
9. [Scripts & Tooling](#9-scripts--tooling)
10. [Security Architecture Summary](#10-security-architecture-summary)
11. [Full-Stack Audit Findings](#11-full-stack-audit-findings)
12. [Fix Options for Severe Gaps](#12-fix-options-for-severe-gaps)

---

## 1. Environment Variables

### Supabase
| Variable | Purpose |
|---|---|
| `SUPABASE_URL` | Project URL (server-side) |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-side admin key (bypasses RLS) |
| `SUPABASE_ANON_KEY` | Client-side anon key |
| `NEXT_PUBLIC_SUPABASE_URL` | Client-side URL (exposed to browser) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Client-side anon key (exposed to browser) |

### Square (Production)
| Variable | Purpose |
|---|---|
| `SQUARE_PRODUCTION_TOKEN` | Server API access token |
| `SQUARE_PRODUCTION_APPLICATION_ID` | Client-side app ID |
| `SQUARE_LOCATION_ID` | Point Breeze location ID |
| `SQUARE_WEBHOOK_SIGNATURE` | HMAC key for webhook validation |
| `SQUARE_WEBHOOK_URL` | Base URL for signature computation |
| `SQUARE_TERMINAL_DEVICE_ID` | Hardware terminal device code |

### Auth & Security
| Variable | Purpose |
|---|---|
| `BREWHUB_API_KEY` | Internal API auth for AI/tool endpoints |
| `OPS_HMAC_SECRET` | HMAC key for PIN session tokens |
| `INTERNAL_SYNC_SECRET` | HMAC for internal webhooks |
| `ALLOWED_IPS` | Comma-separated IP allowlist for PIN login |
| `SERVICE_SECRET` | Internal service-to-service auth |
| `IP_HASH_SALT` | Salt for SHA-256 IP hashing (GDPR) |
| `CRON_SECRET` | Secret for scheduled function auth |
| `WORKER_SECRET` | Auth for Supabase Edge Function workers |

### AI & Voice
| Variable | Purpose |
|---|---|
| `CLAUDE_API_KEY` | Anthropic Claude chat |
| `ELEVENLABS_API_KEY` | ElevenLabs voice synthesis |
| `ELEVENLABS_AGENT_ID` | Elise voice agent ID |
| `GEMINI_API_KEY` | Google Generative AI (scripts/marketing) |

### Communications
| Variable | Purpose |
|---|---|
| `TWILIO_ACCOUNT_SID` | Twilio SMS |
| `TWILIO_AUTH_TOKEN` | Twilio SMS |
| `TWILIO_MESSAGING_SERVICE_SID` | Twilio messaging service |
| `RESEND_API_KEY` | Transactional email |

### Infrastructure
| Variable | Purpose |
|---|---|
| `SITE_URL` / `URL` | Site base URL for CORS + redirects |
| `GOOGLE_SCRIPT_URL` | Google Sheets sync endpoint |

---

## 2. 3rd Party API Dependencies

| API | Purpose | Key Required |
|---|---|---|
| Square | Payments, Terminal, Webhooks, Checkout | `SQUARE_PRODUCTION_TOKEN` |
| Supabase | Postgres, Realtime, Auth, Storage | `SUPABASE_SERVICE_ROLE_KEY` |
| Anthropic Claude | AI text chat with tool use | `CLAUDE_API_KEY` |
| ElevenLabs | Text-to-Speech (Elise voice) | `ELEVENLABS_API_KEY` |
| Twilio | SMS notifications | `TWILIO_ACCOUNT_SID` |
| Resend | Transactional email | `RESEND_API_KEY` |
| Google Sheets | Marketing data sync | `GOOGLE_SCRIPT_URL` |
| Google Gemini | AI testing scripts, marketing | `GEMINI_API_KEY` |
| Facebook Business SDK | Marketing sync | `FB_ACCESS_TOKEN` |
| barcodeapi.org | Barcode generation (portal) | None (public) |
| qrserver.com | QR code generation (portal) | None (public) |

---

## 3. Shared Utilities (`src/lib/`)

| File | Purpose |
|---|---|
| `supabase.ts` | Supabase client singleton + factory (anon + service role) |
| `rateLimit.ts` | In-memory sliding-window IP rate limiter (zero-dependency) |
| `escapeHtml.ts` | HTML entity escaper for transactional email templates |
| `tokenBucket.ts` | Token bucket rate limiter (used by API routes) |

### Shared Netlify Modules (not HTTP endpoints)

| Module | Purpose |
|---|---|
| `_auth.js` | Central auth: JWT validation + PIN HMAC tokens + role enforcement + token versioning |
| `_csrf.js` | CSRF header validation (`X-BrewHub-Action`) |
| `_gdpr.js` | Tombstone-based deletion + zombie resurrection prevention |
| `_ip-guard.js` | Rate limiting with timing-safe comparison |
| `_ip-hash.js` | SHA-256 IP hashing with salt for GDPR-compliant logging |
| `_receipt.js` | 32-column thermal receipt generator |
| `_sanitize.js` | Input sanitization (strip tags, scripts, event handlers) |
| `_token-bucket.js` | In-memory token bucket for chat/TTS/order rate limiting |
| `_usage.js` | DB-backed daily API quota tracking (circuit breaker) |

---

## 4. Complete Netlify Functions Inventory

### Orders & Payments

| Function | Methods | Auth | CSRF | Rate Limit | Description |
|---|---|---|---|---|---|
| `cafe-checkout.js` | POST | JWT/PIN/guest | Yes | Daily quota (guest) | POS checkout → Supabase order + line items |
| `collect-payment.js` | POST | Manager PIN | Yes | No | Send payment to Square Terminal hardware |
| `create-checkout.js` | POST | Optional JWT | Yes | Daily quota | Generate Square payment links |
| `create-order.js` | POST | JWT/PIN | Yes | Order bucket | Generic order creation, server-side prices |
| `ai-order.js` | POST | API key | Yes | Order bucket + DB | AI agent order placement |
| `process-merch-payment.js` | POST | **None** | Yes | Daily quota | Merch checkout → Square payment link |
| `square-webhook.js` | POST | Square HMAC | N/A | Payload size | payment.updated → mark paid, loyalty, inventory, receipt |
| `square-sync.js` | POST | Service secret | No | No | Sync Supabase orders to Square |
| `update-order-status.js` | POST | Staff PIN | Yes | No | KDS status transitions via `safe_update_order_status` RPC |
| `redeem-voucher.js` | POST | JWT/PIN | **No** | Circuit breaker | Loyalty voucher redemption via `atomic_redeem_voucher` |

### AI & Voice

| Function | Methods | Auth | CSRF | Rate Limit | Description |
|---|---|---|---|---|---|
| `claude-chat.js` | POST | Optional JWT | Yes | Chat bucket + DB | Claude AI with identity-bound tool use |
| `text-to-speech.js` | POST | Optional | Yes | TTS bucket + DB | ElevenLabs TTS for voice responses |

### Staff Auth

| Function | Methods | Auth | CSRF | Rate Limit | Description |
|---|---|---|---|---|---|
| `pin-login.js` | POST | None (IS auth) | Yes | In-memory + DB lockout | PIN authentication → HMAC session cookie |
| `pin-logout.js` | POST | None | Yes | No | Clear session cookie |
| `pin-verify.js` | POST | Staff PIN | Yes | No | Verify active session |
| `pin-clock.js` | POST | Staff PIN | Yes | No | Clock in/out via `atomic_staff_clock` RPC |

### Operations

| Function | Methods | Auth | CSRF | Rate Limit | Description |
|---|---|---|---|---|---|
| `parcel-check-in.js` | POST | Staff PIN | Yes | No | Register incoming parcel |
| `parcel-pickup.js` | POST | Staff/JWT | Yes | No | Mark parcel collected |
| `register-tracking.js` | POST | Staff PIN | **No** | No | Register tracking number |
| `adjust-inventory.js` | POST | Manager PIN | Yes | No | Adjust stock levels |
| `create-inventory-item.js` | POST | Manager PIN | Yes | No | Create new inventory item |
| `manage-catalog.js` | GET/POST/PUT/DEL | Staff/Manager | Yes (writes) | No | Menu/merch catalog CRUD |
| `upload-menu-image.js` | POST | Manager PIN | Yes | No | Upload menu item images |
| `update-hours.js` | POST | Manager PIN | Yes | No | Payroll adjustments via `atomic_payroll_adjustment` RPC |
| `fix-clock.js` | POST | Manager PIN | Yes | No | Fix missing clock-out (direct UPDATE — audit gap) |
| `log-time.js` | POST | Staff PIN | Yes | No | Legacy clock endpoint (direct INSERT/UPDATE — audit gap) |

### Data Retrieval

| Function | Methods | Auth | Rate Limit | Description |
|---|---|---|---|---|
| `get-kds-orders.js` | GET | Staff PIN | No | KDS order board |
| `get-menu.js` | GET | None | **No** | Public menu |
| `get-merch.js` | GET | None | **No** | Public product catalog |
| `get-queue.js` | GET | None | **No** | Public lobby order board (first names only) |
| `get-loyalty.js` | GET | API key | Daily quota | Loyalty lookup (returns PII) |
| `get-manager-stats.js` | GET | Manager PIN | No | Manager dashboard stats |
| `get-payroll.js` | GET | Manager PIN | No | Payroll data |
| `get-receipts.js` | GET | Staff PIN | No | Receipt history |
| `get-recent-activity.js` | GET | Staff PIN | No | Activity feed |
| `get-inventory.js` | GET | Staff PIN | No | Inventory levels |
| `get-applications.js` | GET | Staff (any) | No | Job applications (PII) |
| `sales-report.js` | GET | Manager PIN | No | Daily sales aggregation |
| `export-csv.js` | GET | Manager PIN | No | CSV data export |
| `shop-data.js` | GET | None | **No** | Public shop data |
| `public-config.js` | GET | None | **No** | Square public IDs |
| `health.js` | GET | None | **No** | System health check |

### Hiring

| Function | Methods | Auth | CSRF | Description |
|---|---|---|---|---|
| `submit-application.js` | POST | None | Yes | Public job application (honeypot + timing defense) |
| `get-applications.js` | GET | Staff (any) | No | View all applications (should be manager-only) |
| `update-application-status.js` | PATCH | Staff (any) | **No** | Change application status (should be manager-only) |

### Communications & Marketing

| Function | Methods | Auth | Description |
|---|---|---|---|
| `send-sms-email.js` | POST | Service secret | Twilio + Resend notifications |
| `marketing-bot.js` | POST | Service secret | Marketing content generation |
| `marketing-sync.js` | POST | Service secret | Facebook Business SDK sync |
| `supabase-to-sheets.js` | POST | Service secret | Google Sheets data sync |
| `order-announcer.js` | POST | Service secret | Order notification dispatch |

### Scheduled

| Function | Schedule | Description |
|---|---|---|
| `cancel-stale-orders.js` | `*/5 * * * *` | Cancel orders stuck >30 min |
| `queue-processor.js` | Periodic | Process parcel notification queue |

### Other

| Function | Methods | Auth | Description |
|---|---|---|---|
| `navigate-site.js` | POST | None | Site navigation helper |
| `search-residents.js` | GET | PIN + 15-min freshness | Resident search |
| `create-customer.js` | POST | JWT | Create customer record |
| `site-settings-sync.js` | POST | Service secret | Shop/cafe mode toggle |
| `ops-diagnostics.js` | POST | Manager PIN | System diagnostics |
| `tool-check-waitlist.js` | POST | API key | AI tool: waitlist check |
| `supabase-webhook.js` | POST | IP allowlist + secret | Supabase event handler |
| `apify-to-supabase.js` | POST | Service secret | Web scraper data import |
| `oauth/initiate.js` | GET | Raw JWT (bypasses `_auth.js`) | OAuth initiation |
| `oauth/callback.js` | GET | State token | OAuth callback |

---

## 5. Complete SQL Schema Inventory (1–43)

| Schema | Purpose |
|---|---|
| `schema-1-tables` | Core tables: staff_directory, time_logs, revoked_users, site_settings, waitlist, customers, profiles, orders, coffee_orders, vouchers, merch_products, inventory |
| `schema-2-tables` | Extended tables: parcels, residents, api_usage, marketing, webhook_events, refund_locks, notification_queue, deletion_tombstones, property management |
| `schema-3-functions` | Triggers: handle_new_user, prevent_order_amount_tampering, handle_order_completion, inventory functions |
| `schema-4-rpcs` | RPCs: atomic_parcel_checkin, increment_loyalty, atomic_redeem_voucher, daily_sales_report VIEW |
| `schema-5-rls` | RLS enable + deny-all on all tables, public SELECT for settings/products/waitlist |
| `schema-6` | Rewrites handle_order_completion trigger |
| `schema-7` | sync_coffee_order_status trigger (order → line items cascade) |
| `schema-8-pin` | PIN auth: staff_directory.pin with UNIQUE + 6-digit CHECK |
| `schema-9-receipts` | receipt_queue table, orders.completed_at column |
| `schema-10-payment-hardening` | cancel_stale_orders RPC, orders.paid_amount_cents |
| `schema-11-medium-fixes` | pin_attempts table (brute-force lockout), staff-scoped RLS |
| `schema-12-rls-bootstrap-fix` | is_brewhub_staff() SECURITY DEFINER helper |
| `schema-13-catalog-rls` | Staff RLS for merch_products and inventory |
| `schema-14-parcel-monitor-rls` | PII-masking parcel_departure_board VIEW + anon GRANT |
| `schema-15-job-applications` | job_applications table with anon INSERT, staff SELECT/UPDATE |
| `schema-16-cleanup` | Missing columns: profiles.email, orders.paid_at, vouchers.status; FK constraints |
| `schema-17-product-category` | merch_products.category (menu/merch) with CHECK |
| `schema-18-ground-truth-reconciliation` | Ghost column fixes from CSV audit |
| `schema-19-fix-duplicate-fk` | Drop duplicate FK on coffee_orders.order_id |
| `schema-20-catalog-delete-rls` | Staff DELETE policy for merch_products |
| `schema-21-resume-url-rls` | Strict WITH CHECK on resume_url |
| `schema-22-security-hardening` | Atomic loyalty with SELECT…FOR UPDATE locking |
| `schema-23-security-hardening` | Storage bucket policies, price_cents > 0 CHECK |
| `schema-24-rbac-idor-hardening` | is_brewhub_manager(), manager-only writes, parcels IDOR fix |
| `schema-25-order-timeout-cleanup` | abandon_stale_orders() cron, webhook cleanup |
| `schema-26-soft-delete-payroll-refund` | Soft-delete guard, needs_manager_review, refund inventory restore |
| `schema-27-audit-fixes` | REVOKE dangerous RPCs, voucher bypass GUC, UNIQUE voucher codes |
| `schema-28-audit-fixes-2` | Restore price guard, fix trigger to exact '12oz Cups', storage hardening |
| `schema-29-catalog-archive` | Two-tier hide/archive: archived_at, partial index |
| `schema-30-inventory-ssot` | Inventory SSOT: cups_decremented, row-locking trigger |
| `schema-31-drop-redundant-customer-cols` | Drop legacy name → full_name, address → address_street |
| `schema-32-kds-update-rls` | Staff UPDATE policy on orders for KDS workflow |
| `schema-33-receipt-realtime` | Anon SELECT on receipt_queue for Realtime |
| `schema-34-comp-audit` | comp_audit table for complimentary order audit trail |
| `schema-35-voucher-hardening` | Cryptographic code_hash, plaintext scrub, circuit breaker, daily cap |
| `schema-36-security-hardening` | Profile column guard, staff_directory_safe VIEW, refund lock |
| `schema-37-audit-critical-fixes` | NOT NULL/UNIQUE enforcement, indexes, inventory_audit_log |
| `schema-38-loyalty-ssot-sync` | Loyalty sync trigger: profiles → customers |
| `schema-39-total-defense-audit` | Temporal jitter on parcels, statement timeouts, IP hashing |
| `schema-40-loyalty-ssot-bulletproof` | Advisory-locked loyalty sync, system_sync_logs, reconciliation |
| `schema-41-order-status-remediation` | safe_update_order_status RPC, trigger EXCEPTION handlers |
| `schema-42-atomic-staff-clock` | atomic_staff_clock() — sole clock-in/out path with advisory lock |
| `schema-43-payroll-adjustment-audit` | IRS-compliant atomic_payroll_adjustment(), v_payroll_summary VIEW |
| `schema-free-coffee` | Manual voucher INSERT snippet (not a migration) |

---

## 6. Complete Frontend Page Inventory

### Public Pages (`(site)` route group)

| Route | Auth | Description |
|---|---|---|
| `/` | None | Homepage — hero, waitlist, AI chat |
| `/about` | None | About page |
| `/cafe` | None | Customer cafe ordering |
| `/shop` | None | Merch storefront |
| `/checkout` | None | Cart checkout with Square |
| `/waitlist` | None | Join waitlist |
| `/privacy` | None | Privacy policy |
| `/terms` | None | Terms of service |
| `/thank-you` | None | Post-checkout confirmation |
| `/portal` | Supabase JWT | Resident portal (loyalty + parcels) |
| `/resident` | Supabase JWT | Resident profile |
| `/parcels` | **None (gap)** | Parcel lookup (PII exposure risk) |
| `/parcels/monitor` | None | Smart TV kiosk (PII-masked VIEW) |
| `/manager` | Middleware PIN | Manager dashboard |
| `/admin/dashboard` | **None (gap)** | Revenue, payroll, staff data |
| `/admin/inventory` | **None (gap)** | Inventory management |

### Ops Pages (`(ops)` route group)

| Route | Auth | Description |
|---|---|---|
| `/pos` | Middleware + OpsGate | 3-column POS with Square Terminal |
| `/kds` | Middleware + OpsGate | Kitchen Display System (realtime) |
| `/scanner` | Middleware + OpsGate | Inventory barcode scanner |

### API Routes

| Route | Auth | Description |
|---|---|---|
| `/api/check-in` | Rate-limited proxy | Parcel check-in (10 req/60s) |
| `/api/revalidate` | Secret | Cache revalidation |

---

## 7. Frontend Components Inventory

| Component | Location | Purpose |
|---|---|---|
| `OpsGate.tsx` | `src/components/` | PIN session gate for ops pages |
| `StaffNavigation.tsx` | `src/components/` | Staff nav bar for ops |
| `ScrollToTop.tsx` | `src/components/` | Scroll-to-top button |
| `SwipeCartItem.tsx` | `src/components/` | Swipeable cart item (mobile POS) |
| `CatalogManager.tsx` | `(site)/components/manager/` | Menu/merch catalog CRUD |
| `InventoryTable.tsx` | `(site)/components/manager/` | Inventory stock table |
| `KdsSection.tsx` | `(site)/components/manager/` | KDS overview in dashboard |
| `ManagerNav.tsx` | `(site)/components/manager/` | Manager dashboard navigation |
| `PayrollSection.tsx` | `(site)/components/manager/` | Payroll management |
| `RecentActivity.tsx` | `(site)/components/manager/` | Activity feed |
| `StatsGrid.tsx` | `(site)/components/manager/` | Revenue/metrics grid |
| `MobileNav.tsx` | `(site)/components/` | Mobile navigation drawer |

---

## 8. Supabase Edge Functions

| Function | Purpose |
|---|---|
| `notification-worker` | Process notification queue |
| `parcel-pickup` | Parcel pickup handler (dual: also Netlify function) |
| `welcome-email` | Send welcome email on user signup (XSS risk — unescaped HTML) |

---

## 9. Scripts & Tooling

| Script | Purpose |
|---|---|
| `check-models.js` | Verify AI model availability |
| `generate-apple-file.js` | Generate Apple Pay merchant verification |
| `register-apple-pay.js` | Register Apple Pay domain |
| `rotate-secrets.mjs` | Rotate environment secrets |
| `rotate-secrets.sh` | Shell wrapper for secret rotation |
| `simulate-rush.js` | Fire simulated webhooks (dev only — no prod guard) |
| `test-ai-personality.js` | Test Claude AI personality |
| `test-hype.js` | Test marketing copy generation |

---

## 10. Security Architecture Summary

### Auth Layers
- **Supabase JWT**: Token versioning via `version_updated_at`, revocation checks
- **PIN HMAC Sessions**: 8-hour expiry, timing-safe comparison, IP allowlist
- **Service Secrets**: Server-to-server auth for webhooks and background jobs
- **Square HMAC**: Timing-safe webhook verification with 5-min replay window
- **CSRF**: `X-BrewHub-Action` header on all POST endpoints (3 endpoints missing)

### RLS Strategy
- Deny-all by default on every table
- Scoped SELECT for staff via `is_brewhub_staff()`
- Service role bypasses for backend operations
- Manager-only writes via `is_brewhub_manager()`

### Data Protection
- PII-masked `parcel_departure_board` VIEW (first initial, no unit, stable jitter)
- GDPR tombstone system (zombie resurrection prevention)
- SHA-256 IP hashing with salt in audit logs
- Cryptographic voucher hashing (SHA-256, daily redemption cap)
- Server-side price lookup on all payment endpoints

---

## 11. Full-Stack Audit Findings

### CRITICAL (P0)

| ID | Layer | Finding | Impact |
|---|---|---|---|
| **FE-C1** | Frontend | `/admin/*` pages have no authentication. `/admin` is not in middleware `OPS_PATHS`. | Full data exposure |
| **FE-C2** | Frontend | Admin dashboard reads staff_directory/time_logs with anon key. | Staff PII leak |
| **FE-C3** | Frontend | `/parcels` page unauthenticated search returns name, phone, email, unit. | Resident PII leak |
| **FE-C4** | Frontend | Checkout sends client-provided `price_cents` to `process-merch-payment`. | Revenue loss |
| **API-C1** | Functions | `log-time.js`: `openShift` block-scoped → ReferenceError on clock-out (500). | Clock-out broken |
| **API-C2** | Functions | `collect-payment.js`: Random idempotency key → duplicate Square charges on retry. | Double charges |
| **API-C3** | Functions | `process-merch-payment.js`: Zero authentication. Any origin can create payments. | Unauthorized payments |
| **SQL-C1** | Schema | `log-time.js` bypasses `atomic_staff_clock()` with direct INSERT/UPDATE. | Audit trail broken |
| **SQL-C2** | Schema | `fix-clock.js` directly UPDATEs time_logs rows (IRS compliance violation). | IRS audit broken |
| **SQL-C3** | Schema | `schema-all-combined.sql` missing schemas 31–43. | Incomplete bootstrap |
| **SQL-C4** | Schema | `atomic_redeem_voucher` in schema-39 drops hash-first lookup from schema-35. | Voucher crypto regression |

### HIGH (P1)

| ID | Layer | Finding |
|---|---|---|
| **FE-H1** | Frontend | KDS case-sensitive status keys — no `.toLowerCase()` normalization |
| **FE-H2** | Frontend | POS `handleSendToKDS` uses async setState instead of useRef lock — race condition |
| **FE-H3** | Frontend | Checkout wallet payment request uses stale total after cart changes |
| **FE-H4** | Frontend | Portal auth has no rate limiting beyond Supabase defaults |
| **API-H1** | Functions | 6 public endpoints with zero rate limiting (get-menu, get-merch, etc.) |
| **API-H2** | Functions | Hiring endpoints lack `requireManager` — any barista can view/change applications |
| **API-H3** | Functions | `register-tracking.js` missing CSRF protection |
| **API-H4** | Functions | `oauth/initiate.js` bypasses `_auth.js` centralized auth |
| **API-H5** | Functions | `create-checkout.js` quota check before CORS preflight exhausts quota |
| **API-H6** | Functions | `get-loyalty.js` returns PII for any customer with shared API key |
| **SQL-H1** | Schema | `receipt_queue` anon SELECT exposes receipt data to any user |
| **SQL-H2** | Schema | `daily_sales_report` VIEW has no REVOKE for anon |
| **SQL-H3** | Schema | `v_payroll_summary` may miss legacy rows with mixed-case emails |
| **SQL-H4** | Schema | `pin_attempts.ip` stores raw IPs (inconsistent with schema-39 hashing) |

### MEDIUM (P2)

| ID | Layer | Finding |
|---|---|---|
| **FE-M1** | Frontend | Portal leaks user email to barcodeapi.org and qrserver.com |
| **FE-M2** | Frontend | No error.tsx boundaries for ops or site routes |
| **FE-M3** | Frontend | Cafe page submit stays enabled during fetch → duplicate orders |
| **FE-M4** | Frontend | Scanner/POS useCallback stale closures (empty dependency arrays) |
| **FE-M5** | Frontend | Admin dashboard zero error handling on Supabase queries |
| **FE-M6** | Frontend | Portal/admin console.error leaks Supabase schema details |
| **API-M1** | Functions | In-memory rate limiters reset on cold start, multi-container buckets |
| **API-M2** | Functions | claude-chat.js accepts fake assistant messages in client history |
| **API-M3** | Functions | order-announcer.js logs customer name + amount in plaintext |
| **API-M4** | Functions | text-to-speech.js allows unauthenticated access under quota |
| **API-M5** | Functions | Missing _sanitize.js on register-tracking, submit-application, create-customer |
| **SQL-M1** | Schema | sync_coffee_order_status trigger has no EXCEPTION handler |
| **SQL-M2** | Schema | comp_audit table has no FK constraints |
| **SQL-M3** | Schema | handle_order_completion trigger defined 6 times — fragile on re-run |
| **SQL-M4** | Schema | Missing index on lower(time_logs.employee_email) for payroll queries |

### LOW (P3)

| ID | Layer | Finding |
|---|---|---|
| **FE-L1** | Frontend | Pervasive `any` types in admin/parcels/portal |
| **FE-L2** | Frontend | Clock ticks every 1s but displays hours:minutes only |
| **FE-L3** | Frontend | No ARIA landmarks or skip-links on POS |
| **API-L1** | Functions | Hardcoded fallback menu prices in claude-chat.js / ai-order.js |
| **API-L2** | Functions | _ip-hash.js falls back to empty salt → trivial rainbow table |
| **API-L3** | Functions | tool-check-waitlist.js returns 200 on errors |
| **SQL-L1** | Schema | time_logs.employee_id orphaned column (unused, no FK) |
| **SQL-L2** | Schema | orders.user_id has no FK to auth.users |
| **SQL-L3** | Schema | customers.address_city defaults to 'Philadelphia' |

### Documentation Gaps

| ID | Finding |
|---|---|
| **DOC-1** | `README_SECURITY.md` does not exist — README links to it (broken) |
| **DOC-2** | README lists schemas 1–28 only; 15 schemas (29–43) undocumented |
| **DOC-3** | ~30 Netlify functions missing from README |
| **DOC-4** | ~13 pages missing from README |
| **DOC-5** | `tokenBucket.ts` undocumented everywhere |
| **DOC-6** | SYSTEM-BLUEPRINT.md stops at schema ~28 |
| **DOC-7** | `GEMINI_API_KEY`, `WORKER_SECRET`, `TWILIO_MESSAGING_SERVICE_SID` missing from env docs |
| **DOC-8** | sitemap.xml only has 6 of 15+ public pages |

### Config & Testing Gaps

| ID | Finding |
|---|---|
| **CFG-1** | ESLint ignores entire `netlify/**` — serverless functions never linted |
| **CFG-2** | No `package-lock.json` — non-deterministic builds |
| **CFG-3** | `express@5.2.1` dead dependency (deleted `local-server.js`) |
| **CFG-4** | `node-fetch` redundant on Node 18+ |
| **CFG-5** | X-Frame-Options SAMEORIGIN vs DENY inconsistency (next.config vs _headers) |
| **TST-1** | Only 3/65+ functions tested (<5% coverage). Zero payment/order/frontend tests. |
| **TST-2** | `welcome-email` edge function has unescaped HTML injection |

---

## 12. Fix Options for Severe Gaps

### P0-A: Admin Route Authentication (FE-C1, FE-C2)

| Option | Description | Effort |
|---|---|---|
| **A1** ★ | Add `/admin` to `OPS_PATHS` in middleware.ts + wrap admin pages with `<OpsGate requireManager>` | 30 min |
| **A2** | Move admin pages from `(site)` to `(ops)` route group | 1 hour |
| **A3** | Server-side Supabase auth check in admin components | 2 hours |

### P0-B: Parcels PII Leak (FE-C3)

| Option | Description | Effort |
|---|---|---|
| **B1** ★ | Require Supabase JWT; only show parcels for authenticated user | 1 hour |
| **B2** | Require PIN session; restrict to staff only | 30 min |
| **B3** | Remove direct search; redirect to `/parcels/monitor` | 15 min |

### P0-C: Checkout Client-Side Prices (FE-C4)

| Option | Description | Effort |
|---|---|---|
| **C1** ★ | Modify `process-merch-payment.js` to look up prices by product_id server-side | 1 hour |
| **C2** | Add HMAC-signed cart hash for backend verification | 2 hours |

### P0-D: Duplicate Terminal Payments (API-C2)

| Option | Description | Effort |
|---|---|---|
| **D1** ★ | Derive idempotency key as `SHA-256(orderId + "terminal")` | 30 min |
| **D2** | Cache random key per orderId in Supabase; reuse on retry | 1 hour |

### P0-E: Legacy time_logs Mutation Paths (SQL-C1, SQL-C2)

| Option | Description | Effort |
|---|---|---|
| **E1** ★ | Rewrite log-time.js → `atomic_staff_clock()`. Rewrite fix-clock.js → `atomic_payroll_adjustment()`. | 2 hours |
| **E2** | Delete log-time.js if pin-clock.js is sole UI path. Add fix to update-hours.js. | 1.5 hours |
| **E3** | DB trigger on time_logs rejecting direct INSERT/UPDATE not from a known RPC | 3 hours |

### P0-F: Voucher Crypto Regression (SQL-C4)

| Option | Description | Effort |
|---|---|---|
| **F1** ★ | Update atomic_redeem_voucher to use code_hash lookup first, plaintext fallback for legacy | 1 hour |
| **F2** | Create schema-44 with corrected function preserving hash-first lookup | 30 min |

### P0-G: Unauthenticated Merch Payments (API-C3)

| Option | Description | Effort |
|---|---|---|
| **G1** ★ | Add HMAC-signed payment-intent token (cart hash + timestamp) | 2 hours |
| **G2** | Require Supabase JWT for merch checkout (blocks guests) | 30 min |

### P1: KDS Case Normalization (FE-H1)

| Option | Description | Effort |
|---|---|---|
| **H1** ★ | `.toLowerCase()` at KDS render + `BEFORE INSERT/UPDATE` trigger normalizing orders.status | 1 hour |

### P1: Missing Rate Limits (API-H1)

| Option | Description | Effort |
|---|---|---|
| **I1** ★ | Add token bucket rate limit to all 6 unprotected public endpoints | 1 hour |

### P1: Documentation Overhaul (DOC-1 – DOC-8)

| Option | Description | Effort |
|---|---|---|
| **J1** ★ | Regenerate all markdown docs with complete inventories from this audit | 3 hours |
| **J2** | Also create README_SECURITY.md with auth matrix and threat model | 2 hours |

★ = Recommended option

---

*End of SITE-MANIFEST.md — February 22, 2026*