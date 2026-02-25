# SITE-MANIFEST.md — BrewHub PHL Full-Stack Audit & Reference

**Generated:** February 23, 2026  
**Last Updated:** February 23, 2026 (Post-Audit #51)  
**Status:** Production — Active Remediation  
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
| `_ip-hash.js` | SHA-256 IP hashing with salt for GDPR-compliant logging ✅ *Audit #24: startup warning + random hash on empty salt* |
| `_receipt.js` | 32-column thermal receipt generator |
| `_sanitize.js` | Input sanitization (strip tags, scripts, event handlers) |
| `_token-bucket.js` | In-memory token bucket for chat/TTS/order rate limiting |
| `_usage.js` | DB-backed daily API quota tracking (circuit breaker) |

---

## 4. Complete Netlify Functions Inventory

### Orders & Payments

| Function | Methods | Auth | CSRF | Rate Limit | Description |
|---|---|---|---|---|---|
| `cafe-checkout.js` | POST | JWT/PIN/guest | Yes | Daily quota (guest) | POS checkout → Supabase order + line items ✅ *Audit #26: CORS strict allowlist, safe error logging (5 sites), email cap 320, removed double JSON.parse* |
| `collect-payment.js` | POST | Manager PIN | Yes | No | Send payment to Square Terminal hardware |
| `create-checkout.js` | POST | Optional JWT | Yes | IP bucket + daily quota | Generate Square payment links ✅ *Audit #11: preflight before rate limit, qty/cart validation, input sanitization* |
| `create-order.js` | POST | JWT/PIN | Yes | Order bucket | Generic order creation, server-side prices ✅ *Audit #26: method guard before auth, safe JSON parse, safe error logging (2 sites)* |
| `ai-order.js` | POST | API key | Yes | Order bucket + DB | AI agent order placement ✅ *Audit #24: fail-closed on DB error (reject order vs stale fallback prices)* |
| `process-merch-payment.js` | POST | HMAC intent | Yes | Daily quota | Merch checkout → Square payment link ✅ *Audit #4: HMAC idempotency key, qty cap 50, localhost guard* |
| `square-webhook.js` | POST | Square HMAC | N/A | Payload size | payment.updated → mark paid, loyalty, inventory, receipt ✅ *Audit #26: safe error logging (6 sites across handler chain)* |
| `square-sync.js` | POST | Service secret | No | No | Sync Supabase orders to Square ✅ *Audit #26: method guard, safe JSON parse, BigInt input validation, UUID check, safe error logging* |
| `update-order-status.js` | POST | Staff PIN | Yes | No | KDS status transitions via `safe_update_order_status` RPC ✅ *Audit #18: CORS strict allowlist, safe error logging* |
| `redeem-voucher.js` | POST | JWT/PIN | Yes | Circuit breaker | Loyalty voucher redemption via `atomic_redeem_voucher` ✅ *Audit #13: CSRF added, input caps, safe parse, CORS headers* |

### AI & Voice

| Function | Methods | Auth | CSRF | Rate Limit | Description |
|---|---|---|---|---|---|
| `claude-chat.js` | POST | Optional JWT | Yes | Chat bucket + DB | Claude AI with identity-bound tool use ✅ *Audit #17: user-only history filter, CORS allowlist, safe logging, per-item length cap, opaque QR, PII-redacted tool logs* |
| `text-to-speech.js` | POST | Optional | Yes | TTS bucket + DB | ElevenLabs TTS for voice responses ✅ *Audit #20: CORS strict allowlist, safe JSON parse, safe error logging, voiceId cap* |

### Staff Auth

| Function | Methods | Auth | CSRF | Rate Limit | Description |
|---|---|---|---|---|---|
| `pin-login.js` | POST | None (IS auth) | Yes | In-memory + DB lockout | PIN authentication → HMAC session cookie |
| `pin-logout.js` | POST | None | Yes | No | Clear session cookie ✅ *Audit #25: verified clean* |
| `pin-verify.js` | POST | Staff PIN | Yes | No | Verify active session ✅ *Audit #25: safe error logging* |
| `pin-clock.js` | POST | Staff PIN | Yes | No | Clock in/out via `atomic_staff_clock` RPC ✅ *Audit #25: IP hash in logs, safe error logging* |

### Operations

| Function | Methods | Auth | CSRF | Rate Limit | Description |
|---|---|---|---|---|---|
| `parcel-check-in.js` | POST | Staff PIN | Yes | No | Register incoming parcel ✅ *Audit #27: CORS strict allowlist, method guard, safe JSON parse, input caps (tracking 100, carrier 50, resident_id 36), PII redacted from logs, safe error logging* |
| `parcel-pickup.js` | POST | Staff/JWT | Yes | No | Mark parcel collected ✅ *Audit #27: CORS strict allowlist, UUID validation on parcel_id, safe error logging (4 sites), hashed IP in audit log (GDPR), hashIP import* |
| `register-tracking.js` | POST | Staff PIN | Yes | No | Register tracking number ✅ *Audit #10: CSRF added, atomic upsert, input length caps* |
| `adjust-inventory.js` | POST | Manager PIN | Yes | No | Adjust stock levels ✅ *Audit #27: method guard before auth, CORS strict allowlist + OPTIONS, safe JSON parse, UUID validation on itemId, safe error logging (2 sites)* |
| `create-inventory-item.js` | POST | Manager PIN | Yes | No | Create new inventory item ✅ *Audit #27: method guard before auth, CORS strict allowlist + OPTIONS, sanitizeInput on name, safe error logging* |
| `manage-catalog.js` | GET/POST/PATCH/DEL | Staff/Manager | Yes (writes) | No | Menu/merch catalog CRUD ✅ *Audit #28: CORS strict allowlist + OPTIONS preflight, sanitizeInput on name/description, input length caps (name 200, description 2000, image_url 2048), UUID validation on id (PATCH/DELETE), Number.isInteger on price_cents* |
| `upload-menu-image.js` | POST | Manager PIN | Yes | No | Upload menu item images |
| `update-hours.js` | POST | Manager PIN | Yes | No | Payroll adjustments via `atomic_payroll_adjustment` RPC |
| `fix-clock.js` | POST | Manager PIN + TOTP | Yes | No | Fix missing clock-out ✅ *Audit #5: compensating controls verified (manager PIN + TOTP + 3 audit trails)* |
| `log-time.js` | POST | Staff PIN | Yes | No | Clock endpoint ✅ *Audit #5: delegates to `atomic_staff_clock` RPC* |

### Data Retrieval

| Function | Methods | Auth | Rate Limit | Description |
|---|---|---|---|---|
| `get-kds-orders.js` | GET | Staff PIN | No | KDS order board |
| `get-menu.js` | GET | None | publicBucket | Public menu ✅ *Audit #14: safe error logging* |
| `get-merch.js` | GET | None | publicBucket | Public product catalog ✅ *Audit #14: CORS + method guard + error handling* |
| `get-queue.js` | GET | None | publicBucket | Public lobby order board (first names only) |
| `get-loyalty.js` | GET | API key | Daily quota + publicBucket | Loyalty lookup (PII masked, opaque QR) |
| `get-manager-stats.js` | GET | Manager PIN | No | Manager dashboard stats |
| `get-receipts.js` | GET | Staff PIN | No | Receipt history |
| `get-recent-activity.js` | GET | Staff PIN | No | Activity feed |
| `get-inventory.js` | GET | Staff PIN | No | Inventory levels |
| `get-applications.js` | GET | Manager PIN | No | Job applications (PII) ✅ *Audit #9: requireManager added* |
| `sales-report.js` | GET | Manager PIN | No | Daily sales aggregation |
| `export-csv.js` | GET | Manager PIN | No | CSV data export |
| `shop-data.js` | GET | None | publicBucket | Public shop data ✅ *Audit #14: safe error logging* |
| `public-config.js` | GET | None | publicBucket | Square public IDs |
| `health.js` | GET | None | publicBucket | System health check ✅ *Audit #14: CORS headers added* |

### Hiring

| Function | Methods | Auth | CSRF | Description |
|---|---|---|---|---|
| `submit-application.js` | POST | None | Yes | Public job application (honeypot + timing + sanitization) ✅ *Audit #9: sanitizeInput added* |
| `get-applications.js` | GET | Manager PIN | No | View all applications ✅ *Audit #9: requireManager added* |
| `update-application-status.js` | PATCH | Manager PIN | Yes | Change application status ✅ *Audit #9: requireManager + CSRF added* |

### Communications & Marketing

| Function | Methods | Auth | Description |
|---|---|---|---|
| `send-sms-email.js` | POST | Service secret | Twilio + Resend notifications |
| `marketing-bot.js` | POST | Service secret | Marketing content generation |
| `marketing-sync.js` | POST | Service secret | Facebook Business SDK sync |
| `supabase-to-sheets.js` | POST | Service secret | Google Sheets data sync |
| `order-announcer.js` | POST | Service secret | Order notification dispatch ✅ *Audit #20: PII redacted from logs, safe error logging, record validation* |

### Scheduled

| Function | Schedule | Description |
|---|---|---|
| `cancel-stale-orders.js` | `*/5 * * * *` | Cancel orders stuck >30 min |
| `queue-processor.js` | Periodic | Process parcel notification queue — Audit in-progress: added fail-closed env checks, added `fetchWithTimeout()` (AbortController) for edge calls, reduced Supabase claim batch size to 3, bounded RPCs (`complete_notification`, `fail_notification`) with `withTimeout()`, phone masking in logs, and safe error logging. A malformed `fail_notification` wrapper was fixed; further linting remains pending. |

### Other

| Function | Methods | Auth | Description |
|---|---|---|---|
| `navigate-site.js` | POST | None | Site navigation helper |
| `search-residents.js` | GET | PIN + 15-min freshness | Resident search ✅ *Audit #25: CORS allowlist, safe error logging* |
| `get-staff-loyalty.js` | POST | Staff PIN | Staff-only loyalty lookup (profiles + customers + vouchers via service role) ✅ *Audit #25: replaces broken anon-client queries in POS/Scanner* |
| `create-customer.js` | POST | JWT | Create customer record ✅ *Audit #16: input caps, CORS allowlist, safe error logging* |
| `site-settings-sync.js` | POST | Service secret | Shop/cafe mode toggle |
| `ops-diagnostics.js` | POST | Manager PIN | System diagnostics |
| `tool-check-waitlist.js` | POST | API key | AI tool: waitlist check ✅ *Audit #24: proper HTTP status codes (500/502), input cap, safe error logging* |
| `supabase-webhook.js` | POST | IP allowlist + secret | Supabase event handler |
| `apify-to-supabase.js` | POST | Service secret | Web scraper data import |
| `oauth/initiate.js` | GET | Centralized `authorize()` | OAuth initiation ✅ *Audit #2: replaced hand-rolled JWT with `_auth.js`* |
| `oauth/callback.js` | GET | State token | OAuth callback |

---

## 5. Complete SQL Schema Inventory (1–53)

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
| `schema-50-tracking-unique` | UNIQUE constraint on `expected_parcels.tracking_number` (Audit #10: RT-1 TOCTOU fix) |
| `schema-51-receipt-view-hardening` | Time-scoped anon receipt_queue SELECT, REVOKE on daily_sales_report + v_payroll_summary (Audit #16) |
| `schema-52-trigger-hardening` | sync_coffee_order_status EXCEPTION handler, comp_audit FK constraints, lower(employee_email) index (Audit #23) |
| `schema-53-shop_settings` | `shop_settings` table for OAuth tokens/state and RLS deny-all policy (added to support worker OAuth persistence) |

**`schema-all-combined.sql`** has been regenerated to include all schemas 1–53 (Audit #23+): a regenerated combined file was written at `supabase/schema-all-combined.regenerated.sql` and the earlier unified diff was removed from the repo for review purposes. Individual migration `supabase/schema-53-shop_settings.sql` was added to introduce the `shop_settings` table.

---

## 6. Complete Frontend Page Inventory

### Public Pages (`(site)` route group)

| Route | Auth | Description |
|---|---|---|
| `/` | None | Homepage — hero, waitlist, AI chat |
| `/about` | None | About page |
| `/cafe` | None | Customer cafe ordering ✅ *Audit #22: submit guard, qty/cart caps, menu error state, safe logging* |
| `/shop` | None | Merch storefront |
| `/checkout` | None | Cart checkout with Square |
| `/waitlist` | None | Join waitlist |
| `/privacy` | None | Privacy policy |
| `/terms` | None | Terms of service |
| `/thank-you` | None | Post-checkout confirmation |
| `/portal` | Supabase JWT | Resident portal (loyalty + parcels) ✅ *Audit #21: opaque QR/barcode (no email leak), auth rate limiting, input caps, safe logging* |
| `/resident` | Supabase JWT | Resident registration ✅ *Audit #21: input caps, generic errors, bot timing guard* |
| `/parcels` | Supabase JWT + RLS | Parcel lookup ✅ *Audit #6: auth gate + scoped query + RLS defense-in-depth* |
| `/manager/parcels/monitor` | Middleware PIN | Smart TV kiosk (PII-masked VIEW) — moved under ops-gate (C3 fix) |
| `/manager` | Middleware PIN | Manager dashboard |
| `/admin/dashboard` | Middleware + OpsGate (manager) | Revenue, payroll, staff data ✅ *Audit #8: FE-C1/FE-C2 verified resolved* |
| `/admin/inventory` | Middleware + OpsGate (manager) | Inventory management ✅ *Audit #8: rewritten to use PIN auth + Netlify functions* |

### Ops Pages (`(ops)` route group)

| Route | Auth | Description |
|---|---|---|
| `/pos` | Middleware + OpsGate | 3-column POS with Square Terminal ✅ *Audit #25: loyalty lookup via get-staff-loyalty.js (was broken anon client)* |
| `/kds` | Middleware + OpsGate | Kitchen Display System (realtime) ✅ *Audit #18: status normalization, safe logging, date guards, stale closure fix* |
| `/scanner` | Middleware + OpsGate | Inventory barcode scanner ✅ *Audit #25: loyalty lookup via get-staff-loyalty.js (was broken anon client); dead supabase import removed* |

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
- **CSRF**: `X-BrewHub-Action` header on all POST endpoints ✅ All previously-missing endpoints now covered (`redeem-voucher` fixed Audit #13, `register-tracking` verified Audit #10)

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
| ~~**FE-C1**~~ | Frontend | ~~`/admin/*` pages have no authentication.~~ | ✅ Verified resolved (Audit #8) — `/admin` in middleware `OPS_PATHS` + `<OpsGate requireManager>` |
| ~~**FE-C2**~~ | Frontend | ~~Admin dashboard reads staff_directory/time_logs with anon key.~~ | ✅ Verified resolved (Audit #8) — all reads via PIN-auth'd Netlify functions |
| ~~**FE-C3**~~ | Frontend | ~~`/parcels` page unauthenticated search.~~ | ✅ Verified resolved (Audit #6) — JWT auth gate + scoped query + RLS |
| ~~**FE-C4**~~ | Frontend | ~~Checkout sends client-provided `price_cents` to `process-merch-payment`.~~ | ✅ Verified resolved (Audit #15) — `process-merch-payment.js` already does full server-side price lookup from `merch_products`; client `price_cents` is never read |
| ~~**API-C1**~~ | Functions | ~~`log-time.js`: `openShift` block-scoped → ReferenceError.~~ | ✅ Verified resolved (Audit #5) — delegates to `atomic_staff_clock` RPC |
| ~~**API-C2**~~ | Functions | ~~`collect-payment.js`: Random idempotency key.~~ | ✅ Verified resolved (Audit #3) — deterministic SHA-256 key in current code |
| ~~**API-C3**~~ | Functions | ~~`process-merch-payment.js`: Zero authentication.~~ | ✅ Fixed (Audit #4) — HMAC idempotency, qty cap, localhost guard |
| ~~**SQL-C1**~~ | Schema | ~~`log-time.js` bypasses `atomic_staff_clock()`.~~ | ✅ Verified resolved (Audit #5) — delegates to RPC |
| ~~**SQL-C2**~~ | Schema | ~~`fix-clock.js` directly UPDATEs time_logs.~~ | ✅ Verified resolved (Audit #5) — compensating controls (PIN + TOTP + 3 audit trails) |
| ~~**SQL-C3**~~ | Schema | ~~`schema-all-combined.sql` missing schemas 31–43.~~ | ✅ Fixed (Audit #15) — schemas 44, 47, 48, 49, 50 appended (31–43 were already present; 44–50 were missing) |
| ~~**SQL-C4**~~ | Schema | ~~`atomic_redeem_voucher` in schema-39 drops hash-first lookup from schema-35.~~ | ✅ Already remediated by `schema-44-voucher-hash-restore.sql` (verified Audit #13) |

### HIGH (P1)

| ID | Layer | Finding |
|---|---|---|
| ~~**FE-H1**~~ | Frontend | ~~KDS case-sensitive status keys — no `.toLowerCase()` normalization~~ ✅ Fixed (Audit #18) — `ns()` normalizer applied to all status lookups; `elapsed()` and `urgencyClass()` guard against falsy/invalid dates |
| ~~**FE-H2**~~ | Frontend | ~~POS `handleSendToKDS` uses async setState instead of useRef lock — race condition~~ ✅ Fixed (Audit #19) — `submittingRef` as primary guard; `isSubmitting` kept for UI only |
| ~~**FE-H3**~~ | Frontend | ~~Checkout wallet payment request uses stale total after cart changes~~ ✅ Fixed (Audit #15) — `walletPaymentRequestRef` + `useEffect` syncs total on change |
| ~~**FE-H4**~~ | Frontend | ~~Portal auth has no rate limiting beyond Supabase defaults~~ ✅ Fixed (Audit #21) — client-side attempt counter (5 max) + 30s cooldown + `signupDone` flag |
| ~~**API-H1**~~ | Functions | ~~6 public endpoints with zero rate limiting (get-menu, get-merch, etc.)~~ ✅ Already resolved (Audit #14) — all 6 already use `publicBucket` rate limiting; CORS + error handling hardened |
| ~~**API-H2**~~ | Functions | ~~Hiring endpoints lack `requireManager`.~~ ✅ Fixed (Audit #9) — both endpoints now require manager PIN + CSRF on writes |
| ~~**API-H3**~~ | Functions | ~~`register-tracking.js` missing CSRF protection~~ ✅ Verified already fixed (Audit #10) — CSRF header present in current code |
| ~~**API-H4**~~ | Functions | ~~`oauth/initiate.js` bypasses `_auth.js` centralized auth.~~ ✅ Fixed (Audit #2) — replaced with centralized `authorize()` |
| ~~**API-H5**~~ | Functions | ~~`create-checkout.js` quota check before CORS preflight exhausts quota~~ ✅ Fixed (Audit #11) — OPTIONS handled before rate limiting |
| ~~**API-H6**~~ | Functions | ~~`get-loyalty.js` returns PII for any customer with shared API key~~ ✅ Fixed (Audit #12) — email masked, full_name removed, opaque UUID QR, input caps, safe error logging |
| ~~**SQL-H1**~~ | Schema | ~~`receipt_queue` anon SELECT exposes receipt data to any user~~ ✅ Fixed (Audit #16) — anon SELECT scoped to 30-minute window |
| ~~**SQL-H2**~~ | Schema | ~~`daily_sales_report` VIEW has no REVOKE for anon~~ ✅ Fixed (Audit #16) — REVOKE SELECT from anon, authenticated; also REVOKE on `v_payroll_summary` |
| ~~**SQL-H3**~~ | Schema | ~~`v_payroll_summary` may miss legacy rows with mixed-case emails~~ ✅ Verified resolved (Audit #16) — all CTEs + JOINs already use `lower()` |
| ~~**SQL-H4**~~ | Schema | ~~`pin_attempts.ip` stores raw IPs (inconsistent with schema-39 hashing)~~ ✅ Verified resolved (Audit #16) — schema-39 already migrated to `hash_ip()` + rewrote all RPCs |

### MEDIUM (P2)

| ID | Layer | Finding |
|---|---|---|
| ~~**FE-M1**~~ | Frontend | ~~Portal leaks user email to barcodeapi.org and qrserver.com~~ ✅ Fixed (Audit #21) — both URLs now use `user.id` (UUID) instead of email |
| ~~**FE-M2**~~ | Frontend | ~~No error.tsx boundaries for ops or site routes~~ ✅ Fixed (Audit #23) — `error.tsx` created for both `(ops)` (dark theme) and `(site)` (light theme) route groups; safe `error?.message` logging |
| ~~**FE-M3**~~ | Frontend | ~~Cafe page submit stays enabled during fetch → duplicate orders~~ ✅ Fixed (Audit #22) — `submitting` state disables button + guards `handleOrder`; per-item qty cap 50, cart cap 25; menu error state; safe error logging |
| ~~**FE-M4**~~ | Frontend | ~~Scanner/POS useCallback stale closures (empty dependency arrays)~~ ✅ Fixed (Audit #23) — Scanner: `handleScanRef` pattern (same as POS `handleLoyaltyScanRef` from Audit #19); detection loop calls `handleScanRef.current` instead of stale `handleScan` *(POS fixed Audit #19)* |
| ~~**FE-M5**~~ | Frontend | ~~Admin dashboard zero error handling on Supabase queries.~~ ✅ Fixed (Audit #8) — dashboard has try/catch; inventory page rewritten |
| ~~**FE-M6**~~ | Frontend | ~~Portal/admin console.error leaks Supabase schema details~~ ✅ Fixed (Audit #21) — Portal switched to `err?.message` pattern; resident page uses generic user-facing errors *(POS fixed Audit #19; admin still open)* |
| **API-M1** | Functions | In-memory rate limiters reset on cold start, multi-container buckets |
| ~~**API-M2**~~ | Functions | ~~claude-chat.js accepts fake assistant messages in client history~~ ✅ Fixed (Audit #17) — client history filtered to `role: 'user'` only; per-item length cap; CORS allowlist; safe error logging; opaque QR URL; redacted tool logs |
| ~~**API-M3**~~ | Functions | ~~order-announcer.js logs customer name + amount in plaintext~~ ✅ Fixed (Audit #20) — PII redacted to initials only, dollar amount removed, order ID truncated |
| ~~**API-M4**~~ | Functions | ~~text-to-speech.js allows unauthenticated access under quota~~ ✅ Hardened (Audit #20) — CORS strict allowlist, safe JSON parse, safe error logging; unauthenticated access kept intentional (public TTS with bucket + daily quota) |
| ~~**API-M5**~~ | Functions | ~~Missing _sanitize.js on~~ ~~register-tracking~~, ~~submit-application~~, ~~create-customer~~ ✅ *submit-application fixed (Audit #9)* ✅ *register-tracking verified already present (Audit #10)* ✅ *create-customer already uses sanitizeInput (verified Audit #16); input caps + CORS + safe logging added* |
| ~~**SQL-M1**~~ | Schema | ~~sync_coffee_order_status trigger has no EXCEPTION handler~~ ✅ Fixed (Audit #23) — EXCEPTION WHEN OTHERS with nested error-safe logging to `system_sync_logs`; statement/lock timeouts added |
| ~~**SQL-M2**~~ | Schema | ~~comp_audit table has no FK constraints~~ ✅ Fixed (Audit #23) — FK REFERENCES added for `order_id → orders.id` and `staff_id → staff_directory.id` (ON DELETE RESTRICT) |
| ~~**SQL-M3**~~ | Schema | ~~handle_order_completion trigger defined 6 times — fragile on re-run~~ ✅ Verified resolved (Audit #23) — `CREATE OR REPLACE` is idempotent; latest definition (schema-41) already has full EXCEPTION handling |
| ~~**SQL-M4**~~ | Schema | ~~Missing index on lower(time_logs.employee_email) for payroll queries~~ ✅ Fixed (Audit #23) — functional index `idx_time_logs_email_lower` on `lower(employee_email)` |

### LOW (P3)

| ID | Layer | Finding |
|---|---|---|
| **FE-L1** | Frontend | Pervasive `any` types in admin/parcels/portal |
| ~~**FE-L2**~~ | Frontend | ~~Clock ticks every 1s but displays hours:minutes only~~ ✅ Fixed (Audit #19) — interval changed to 60s |
| **FE-L3** | Frontend | No ARIA landmarks or skip-links on POS |
| ~~**API-L1**~~ | Functions | ~~Hardcoded fallback menu prices in claude-chat.js / ai-order.js~~ ✅ Fixed (Audit #24) — claude-chat.js fallback messages warn "prices may not be current"; ai-order.js place_order rejects when DB unreachable (fail-closed); ai-order.js getMenuPrices returns null on failure |
| ~~**API-L2**~~ | Functions | ~~_ip-hash.js falls back to empty salt → trivial rainbow table~~ ✅ Fixed (Audit #24) — startup warning logged; hashIP returns random hex when salt is empty (fail-open for rate limiting, never stores deterministic unsalted hash) |
| ~~**API-L3**~~ | Functions | ~~tool-check-waitlist.js returns 200 on errors~~ ✅ Fixed (Audit #24) — missing env returns 500; DB error returns 502; email input capped to 254 chars; error logging uses safe err?.message |
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

### ~~P0-A: Admin Route Authentication (FE-C1, FE-C2)~~ ✅ RESOLVED

Verified resolved in Audit #8 — `/admin` already in middleware `OPS_PATHS` + `<OpsGate requireManager>` in layout. Inventory page rewritten to use PIN auth.

### ~~P0-B: Parcels PII Leak (FE-C3)~~ ✅ RESOLVED

Verified resolved in Audit #6 — JWT auth gate + scoped query + RLS defense-in-depth.

### ~~P0-C: Checkout Client-Side Prices (FE-C4)~~ ✅ RESOLVED

Verified resolved in Audit #15 — `process-merch-payment.js` already performs full server-side price lookup from `merch_products` table. Client-provided `price_cents` is never used in the payment calculation.

### ~~P0-D: Duplicate Terminal Payments (API-C2)~~ ✅ RESOLVED

Verified resolved in Audit #3 — deterministic SHA-256 idempotency key already in current code.

### ~~P0-E: Legacy time_logs Mutation Paths (SQL-C1, SQL-C2)~~ ✅ RESOLVED

Verified resolved in Audit #5 — `log-time.js` delegates to `atomic_staff_clock()` RPC. `fix-clock.js` has compensating controls (manager PIN + TOTP + 3 audit trails).

### ~~P0-F: Voucher Crypto Regression (SQL-C4)~~ ✅ RESOLVED

Verified resolved in Audit #13 — `schema-44-voucher-hash-restore.sql` already restores hash-first lookup + plaintext fallback + opportunistic backfill + timeout guards from schema-39.

### P0-G: Unauthenticated Merch Payments (API-C3)

| Option | Description | Effort |
|---|---|---|
| **G1** ★ | Add HMAC-signed payment-intent token (cart hash + timestamp) | 2 hours |
| **G2** | Require Supabase JWT for merch checkout (blocks guests) | 30 min |

### ~~P1: KDS Case Normalization (FE-H1)~~ ✅ RESOLVED\n\nFixed in Audit #18 — `ns()` normalizer applied to all status lookups in KDS page. `elapsed()` and `urgencyClass()` guard against falsy/NaN dates. Stale closure fixed via `ordersRef`.

### ~~P1: Missing Rate Limits (API-H1)~~ ✅ RESOLVED

Already resolved — all 6 endpoints already import and use `publicBucket` from `_token-bucket.js`. CORS and error handling hardened in Audit #14.

### P1: Documentation Overhaul (DOC-1 – DOC-8)

| Option | Description | Effort |
|---|---|---|
| **J1** ★ | Regenerate all markdown docs with complete inventories from this audit | 3 hours |
| **J2** | Also create README_SECURITY.md with auth matrix and threat model | 2 hours |

★ = Recommended option

---

---

## 13. Remediation Log

| Audit # | Scope | Files Modified | Issues Resolved |
|---|---|---|---|
| 1 | SMS Pipeline | `twilio-webhook.js`, `_sms.js`, `send-sms-email.js` | Source mismatch, phone masking, quiet-hours audit |
| 2 | Auth System | `_auth.js`, `middleware.ts`, `oauth/initiate.js`, `pin-login.js` | **API-H4**: centralized auth for OAuth; SHA-256 digest comparison; removed service-role fallback |
| 3 | collect-payment.js | *(none — verified)* | **API-C2**: already resolved (deterministic idempotency key) |
| 4 | process-merch-payment.js | `process-merch-payment.js` | **API-C3**: HMAC idempotency key, localhost guard, qty cap 50 |
| 5 | Time/Clock | *(none — verified)* | **API-C1/SQL-C1/SQL-C2**: already resolved (RPC delegation + compensating controls) |
| 6 | Parcels Frontend | *(verified, 3 minor fixes pending)* | **FE-C3**: already resolved (JWT auth + scoped query + RLS) |
| 7 | *(session boundary)* | | |
| 8 | Admin Dashboard | `admin/inventory/page.tsx` | **FE-C1/FE-C2**: verified resolved; inventory page rewritten (PIN auth + typed + error handling) |
| 9 | Hiring Endpoints | `get-applications.js`, `update-application-status.js`, `submit-application.js`, `HiringViewer.tsx` | **API-H2**: requireManager on both endpoints; CSRF on status updates; sanitizeInput on submissions |
| 10 | register-tracking.js | `register-tracking.js`, `schema-50-tracking-unique.sql` | **API-H3**: CSRF already present (verified); **RT-1**: atomic upsert + UNIQUE constraint; **RT-2**: input length caps on all PII fields |
| 11 | create-checkout.js | `create-checkout.js` | **API-H5**: preflight before rate limiting; **CC-1**: quantity validation (int 1–50); **CC-2**: cart cap (25); **CC-3/CC-4**: sanitize customer details + error responses; **CC-5**: consistent CORS headers |
| 12 | get-loyalty.js | `get-loyalty.js` | **API-H6**: PII masked (email redacted, full_name removed, UUID instead); **GL-1**: opaque QR URL (no email leak to qrserver.com); **GL-2**: phone lookup min-length guard; **GL-3**: input length caps (email 254, phone 20); **GL-4**: SMS body uses opaque QR; **GL-5**: error logging redacted |
| 13 | redeem-voucher.js | `redeem-voucher.js` | **RV-1**: CSRF header check added; **RV-2**: input length caps (code 100, orderId 36); **RV-3**: safe JSON parse with 400 on failure; **RV-4**: consistent CORS headers + preflight; **SQL-C4**: verified already fixed by schema-44 |
| 14 | 6 Public GET Endpoints | `get-merch.js`, `health.js`, `get-menu.js`, `shop-data.js` | **API-H1**: already resolved (all 6 use `publicBucket`); **PE-1**: CORS allowlist + method guard + try/catch on `get-merch.js`; **PE-2**: CORS headers on `health.js`; **PE-3**: safe error logging on `get-menu.js`; **PE-4**: safe error logging on `shop-data.js`; **PE-5**: error handling on `get-merch.js` |
| 15 | Checkout + Schema Bootstrap | `checkout/page.tsx`, `schema-all-combined.sql` | **FE-C4**: verified resolved (server-side price lookup already in place); **FE-H3**: wallet payment request stale total fixed (`walletPaymentRequestRef` + `useEffect` sync); **SQL-C3**: appended schemas 44, 47, 48, 49, 50 to combined file; **A15-3**: input length caps on name/email; **A15-4**: safe error logging in cart load |
| 16 | SQL Schema Batch + create-customer.js | `schema-51-receipt-view-hardening.sql`, `create-customer.js`, `schema-all-combined.sql` | **SQL-H1**: anon receipt_queue SELECT scoped to 30-min window; **SQL-H2**: REVOKE SELECT on `daily_sales_report` + `v_payroll_summary` from anon/authenticated; **SQL-H3**: verified resolved (lower() already used); **SQL-H4**: verified resolved (schema-39 hash_ip migration); **API-M5**: create-customer already uses sanitizeInput (verified); **CC-1**: input length caps (email 254, name 100, address 200, phone 20); **CC-2**: safe error logging (err?.message only); **CC-3**: CORS strict allowlist + headers on all responses |
| 17 | claude-chat.js | `claude-chat.js` | **API-M2/CC-1**: client history filtered to `role: 'user'` only (blocks fake assistant injection); **CC-2**: CORS strict allowlist (SITE_URL + brewhubphl.com + www); **CC-3**: Claude API error logging no longer dumps response body; **CC-4**: 7 `console.error` calls switched to `err?.message`; **CC-5**: per-item content length cap (`MAX_TEXT_LENGTH`) on history; **CC-6**: QR image URL uses portal URL instead of leaking email to qrserver.com; **CC-7**: tool call logs redacted (name only, no PII input) |
| 18 | KDS page + update-order-status.js | `kds/page.tsx`, `update-order-status.js` | **FE-H1/KDS-1**: `ns()` status normalizer applied to all status lookups (STATUS_FLOW, BORDER_COLOR, STATUS_BADGE, BUTTON_LABEL, urgencyClass, cancel guard); **KDS-2**: safe error logging (`err.message` instead of full object); **KDS-3**: `elapsed()` and `urgencyClass()` guard against falsy/NaN dates; **KDS-4**: `ordersRef` fixes stale closure in `fetchOrders` cache fallback; **KDS-5**: CORS strict allowlist on `update-order-status.js`; **KDS-6**: final catch block uses `err?.message` |
| 19 | POS page | `pos/page.tsx` | **FE-H2/POS-1**: `submittingRef` as primary guard prevents duplicate `handleSendToKDS` calls (race condition fix); **POS-2/POS-3**: safe error logging (`e?.message` only — 2 sites); **POS-4**: QR email input capped to 254 chars before DB query; **POS-5**: flagged — loyalty lookup via anon Supabase client (architectural refactor deferred); **POS-6**: `handleLoyaltyScanRef` stabilizes stale closure in `startLoyaltyDetection`; **POS-7/FE-L2**: clock interval 1s → 60s |
| 20 | order-announcer + text-to-speech | `order-announcer.js`, `text-to-speech.js` | **API-M3/OA-1**: PII redacted — log initials + truncated order ID only (no full name, no dollar amount); **OA-2**: response no longer returns customer name; **OA-3**: safe error logging; **OA-4**: record shape validation; **TTS-1**: CORS strict allowlist (URL + brewhubphl.com + www); **TTS-2**: 2x safe error logging; **TTS-3**: voiceId env capped to 50 chars; **TTS-4**: safe JSON parse with 400 |
| 21 | Portal + Resident pages | `portal/page.tsx`, `resident/page.tsx` | **FE-M1/P21-1**: QR + barcode URLs use `user.id` (UUID) instead of email — no PII leak to 3rd parties; **FE-M6/P21-2**: all `console.error` calls use `err?.message` pattern; **P21-3**: input length caps (name 100, email 254, phone 20, password 128); **FE-H4/P21-5**: client-side auth rate limiting (5 attempts + 30s cooldown); **P21-4**: `signupDone` flag disables form after successful signup; **P21-6**: `any` type replaced with `SupaUser`; **P21-7/P21-8/P21-9**: resident page — input caps, bot timing guard (2s minimum), generic error messages |
| 22 | Cafe page | `cafe/page.tsx` | **FE-M3/P22-1**: `submitting` state flag disables button + guards handler (prevents duplicate orders); **P22-2**: `catch (err: unknown)` with safe message filtering (no Supabase internals); **P22-3**: per-item qty cap (50) + cart distinct-item cap (25); **P22-4**: `menuError` state with user-friendly fallback UI; **P22-5**: `loadLoyalty` wrapped in try/catch with safe logging; **P22-6**: `err: any` → `err: unknown` |
| 23 | Scanner + SQL triggers + Error boundaries | `scanner/page.tsx`, `schema-52-trigger-hardening.sql`, `schema-all-combined.sql`, `(ops)/error.tsx`, `(site)/error.tsx` | **FE-M4/SC-1**: `handleScanRef` fixes stale closure in barcode detection loop; **SC-4**: clock 1s → 60s; **SC-6**: manual input + scan value capped to 254 chars; **SC-3**: loyalty email capped + status message no longer leaks raw email; **SQL-M1**: `sync_coffee_order_status` EXCEPTION handler + timeouts; **SQL-M2**: comp_audit FK constraints (order_id, staff_id); **SQL-M3**: verified resolved (CREATE OR REPLACE idempotent); **SQL-M4**: functional index `idx_time_logs_email_lower`; **FE-M2**: error.tsx boundaries for ops (dark) + site (light) |
| 24 | API LOW batch | `_ip-hash.js`, `claude-chat.js`, `ai-order.js`, `tool-check-waitlist.js` | **API-L2**: startup warning + random hash on empty salt; **API-L1**: claude-chat fallback warns prices may not be current; ai-order + claude-chat place_order fail-closed on DB error; **API-L3**: proper HTTP status codes (500/502) + email input cap + safe error logging |
| 25 | Staff PIN functions + Loyalty refactor | `pin-clock.js`, `pin-verify.js`, `search-residents.js`, `get-staff-loyalty.js` *(new)*, `pos/page.tsx`, `scanner/page.tsx` | **A25-1**: pin-clock IP hash in warn log (GDPR consistency); **A25-2**: pin-clock safe error logging (2 sites); **A25-3**: pin-verify safe error logging; **A25-4**: search-residents safe error logging; **A25-5**: search-residents CORS strict allowlist; **POS-5/A25-6**: POS loyalty lookup moved from broken anon client → PIN-auth'd `get-staff-loyalty.js`; **SC-3/A25-7**: Scanner loyalty lookup moved from broken anon client → `get-staff-loyalty.js`; **A25-8**: pin-logout verified clean |
| 26 | Core payment pipeline | `cafe-checkout.js`, `create-order.js`, `square-webhook.js`, `square-sync.js` | **A26-1**: cafe-checkout CORS strict allowlist (was single `SITE_URL` origin); **A26-2**: cafe-checkout safe error logging (5 sites — `prodErr`, `orderErr`, `itemErr`, `err` → `?.message`); **A26-3**: removed double `JSON.parse` for email — reuses already-extracted `ce`/`cn`; **A26-4**: `customer_email` capped to 320 chars (RFC 5321), `customer_name` capped to 100; **A26-5**: create-order method guard moved before `authorize()` (no wasted auth on non-POST); **A26-6**: create-order `JSON.parse` wrapped in try/catch with 400; **A26-7**: create-order safe error logging (2 sites); **A26-8**: square-webhook safe error logging (6 sites across main handler + refund + payment handlers); **A26-9**: square-sync `JSON.parse` wrapped in try/catch with 400; **A26-10**: square-sync POST method guard added; **A26-11**: square-sync `BigInt()` input validated as positive integer before conversion; **A26-12**: square-sync safe error logging; **A26-13**: square-sync `record.id` UUID validation + `record` shape check |
| 27 | Operations batch | `parcel-check-in.js`, `parcel-pickup.js`, `adjust-inventory.js`, `create-inventory-item.js` | **PCI-1**: method guard (POST-only) before auth; **PCI-2**: safe JSON parse with 400; **PCI-3**: safe error logging (`err?.message`); **PCI-4**: CORS strict allowlist (URL + brewhubphl.com + www); **PCI-5**: PII redacted from PRO-MATCH + PHILLY log lines; **PCI-6**: input caps (tracking 100, carrier 50, resident_id 36); **PP-1**: safe error logging (4 sites — `finalizeErr`, `verifyErr`, `finalErr`, audit `e` → `?.message`); **PP-2**: CORS strict allowlist; **PP-3**: raw IP → `hashIP()` in audit log (GDPR consistency); **PP-4**: UUID regex validation on `parcel_id`; **AI-1**: method guard moved before auth; **AI-2**: safe error logging (2 sites); **AI-3**: CORS headers + OPTIONS preflight added; **AI-4**: safe JSON parse with 400; **AI-5**: UUID validation on `itemId`; **CII-1**: method guard moved before auth; **CII-2**: safe error logging; **CII-3**: CORS headers + OPTIONS preflight added; **CII-4**: `sanitizeInput` applied to item name |
| 28 | manage-catalog.js | `manage-catalog.js` | **MC-1**: CORS strict allowlist (URL + brewhubphl.com + www) + OPTIONS preflight with proper CORS headers; **MC-2**: input length caps — name 200, description 2000; **MC-3**: `sanitizeInput()` on name/description (POST + PATCH); **MC-4**: UUID regex validation on `id` (PATCH + DELETE); **MC-5**: `image_url` length cap 2048; **MC-6**: `Number.isInteger()` check on `price_cents` (POST + PATCH) |

| 32 | KDS PII Reduction | `netlify/functions/get-kds-orders.js` | Removed full `customer_name` exposure from KDS responses; now derive and expose `first_name` only (split on whitespace), reducing PII surface for kitchen displays; ensured response shape remains compatible with KDS clients |

**Files modified to date (60):** `twilio-webhook.js`, `_sms.js`, `send-sms-email.js`, `oauth/initiate.js`, `_auth.js`, `pin-login.js`, `middleware.ts`, `process-merch-payment.js`, `admin/inventory/page.tsx`, `get-applications.js`, `update-application-status.js`, `submit-application.js`, `HiringViewer.tsx`, `register-tracking.js`, `schema-50-tracking-unique.sql`, `create-checkout.js`, `get-loyalty.js`, `redeem-voucher.js`, `get-merch.js`, `health.js`, `get-menu.js`, `shop-data.js`, `checkout/page.tsx`, `schema-all-combined.sql`, `create-customer.js`, `schema-51-receipt-view-hardening.sql`, `claude-chat.js`, `kds/page.tsx`, `update-order-status.js`, `pos/page.tsx`, `order-announcer.js`, `text-to-speech.js`, `portal/page.tsx`, `resident/page.tsx`, `cafe/page.tsx`, `scanner/page.tsx`, `schema-52-trigger-hardening.sql`, `(ops)/error.tsx`, `(site)/error.tsx`, `_ip-hash.js`, `ai-order.js`, `tool-check-waitlist.js`, `pin-clock.js`, `pin-verify.js`, `search-residents.js`, `get-staff-loyalty.js`, `cafe-checkout.js`, `create-order.js`, `square-webhook.js`, `square-sync.js`, `parcel-check-in.js`, `parcel-pickup.js`, `adjust-inventory.js`, `create-inventory-item.js`, `manage-catalog.js`, `upload-menu-image.js`, `update-hours.js`, `log-time.js`, `netlify/functions/get-kds-orders.js`

| 33 | SW & Image Upload | `public/sw.js`, `netlify/functions/upload-menu-image.js` | **SW-1**: added postMessage origin validation to service worker (CWE-20); **UM-1**: added image magic-byte validation (PNG/JPEG/WebP/GIF) in upload-menu-image.js; **UM-2**: added fail-closed env presence check for Supabase vars; **UM-3**: per-IP `formBucket` rate-limiting on uploads; **UM-4**: filename sanitization fallback with random suffix to avoid empty names; **UM-5**: robust base64 decode guard and min-length check; **UM-6**: validate generated public URL before returning to client |

| 34 | Update Hours Hardening | `netlify/functions/update-hours.js` | **UH-1**: added pre-parse body-size cap (8 KB) to prevent large payloads; **UH-2**: per-manager/IP token-bucket rate-limit to limit abusive submissions; **UH-3**: CORS origin echo with `Vary: Origin` for safe cross-origin clients; **UH-4**: `sanitizeInput()` + PII-redaction applied to `reason` before RPC and audit logging; **UH-5**: added fail-closed env presence check for Supabase vars; **UH-6**: enforced `employee_email` max length (254) in Zod schema; **UH-7**: fixed origin resolution in top-level error handler. |

| 35 | Get Menu Hardening | `netlify/functions/get-menu.js` | Applied `sanitizeInput()` to `name` and `description`, truncated `name` to 100 chars and `description` to 500 chars, validated and clamped `price_cents`, limited DB query to 200 rows, and ensured public rate-limiting remains in place to reduce payload size and PII exposure. |

| 36 | Get Merch Hardening | `netlify/functions/get-merch.js` | Applied `sanitizeInput()` to `name` and `description`, truncated `name` to 200 chars and `description` to 500 chars, validated and clamped `price_cents`, limited DB query to 200 rows, capped image_url to 2048 chars, and removed returning `checkout_url` in public responses (expose `checkout_available` boolean instead). |

| 37 | Get Queue Hardening | `netlify/functions/get-queue.js` | Apply `sanitizeInput()` to `customer_name` and coffee item fields; cap DB query to 200 orders and 20 items per order; truncate names/descriptions; remove `isPaid`/`payment_id` exposure; make tag generation robust and minutes-ag0 calculation safe to avoid leaking payment or identifier details. |

| 38 | Log Time Hardening | `netlify/functions/log-time.js` | **LT-1**: added fail-closed env presence check for Supabase vars; **LT-2**: added pre-parse request body size cap (8 KB); **LT-3**: removed reliance on client-supplied `employee_email` (use authenticated `user.id` for RPC); **LT-4**: per-user+IP `formBucket` rate-limiting to prevent abuse; **LT-5**: replaced single-origin CORS with strict allowlist + `Vary: Origin` and echoing validated origin. |

| 39 | Get Queue Hardening | `netlify/functions/get-queue.js` | **UQ-1**: added fail-closed env presence check for Supabase vars; **UQ-2**: strict CORS allowlist with origin echo + `Vary: Origin`; **UQ-3**: removed `payment_id` from selected columns to avoid reading sensitive fields; **UQ-4**: safe error logging `err?.message`. |

| 40 | Get Manager Stats Hardening | `netlify/functions/get-manager-stats.js` | **GM-1**: added fail-closed env presence check for Supabase vars; **GM-2**: strict CORS allowlist with origin echo + `Vary: Origin`; **GM-3**: per-manager+IP rate-limiting via `formBucket` to prevent scraping; **GM-4**: sanitise `full_name` for downstream display and limit to 60 chars; **GM-5**: validate and cap `hourly_rate` to plausible range (0–200) before aggregation; **GM-6**: ensure all responses include CORS headers and safe error messages (no DB internals). |

| 41 | Get Payroll Hardening | `netlify/functions/get-payroll.js` | **GP-1**: added fail-closed env presence check for Supabase vars; **GP-2**: strict CORS allowlist with origin echo + `Vary: Origin`; **GP-3**: per-manager+IP rate-limiting via `formBucket` to prevent scraping; **GP-4**: mask employee emails in `openShifts` and `logs` responses; **GP-5**: include `id` in `time_logs` select and limit row counts for heavy queries; **GP-6**: use explicit UTC timestamps and validate `start <= end`; **GP-7**: safe error logging and ensure responses include consistent CORS headers. |
 | 41 | Get Payroll Hardening | `netlify/functions/get-payroll.js` | **GP-1**: added fail-closed env presence check for Supabase vars; **GP-2**: strict CORS allowlist with origin echo + `Vary: Origin` (removed silent origin fallback); **GP-3**: per-manager+IP rate-limiting via `formBucket` to prevent scraping; **GP-4**: mask employee emails in `openShifts` and `logs` responses; **GP-5**: include `id` in `time_logs` select and limit row counts for heavy queries (`openShifts.limit(200)`, `time_logs.limit(5000)`); **GP-6**: sanitize and truncate returned strings (`full_name` 200, `action_type` 50, email caps 254) to prevent PII/length abuse; **GP-7**: normalize `hourly_rate` to numeric or `null` for invalid values; **GP-8**: use explicit UTC timestamps and validate `start <= end`; **GP-9**: safe error logging and ensure responses include consistent CORS headers. |

| 42 | Get Receipts Hardening | `netlify/functions/get-receipts.js` | **GR-1**: added fail-closed env presence check for Supabase vars; **GR-2**: strict CORS allowlist with origin echo + `Vary: Origin` (removed silent origin fallback); **GR-3**: per-staff+IP `formBucket` rate-limiting to prevent scraping; **GR-4**: sanitize and truncate `receipt_text` (2k chars) and redact PII; **GR-5**: create Supabase client inside handler; **GR-6**: added `Cache-Control: no-cache` to responses; **GR-7**: safer `limit` parsing with bounds (default 10, 1–100); **GR-8**: ensure error responses include consistent CORS headers. |
| 42 | Get Receipts Hardening | `netlify/functions/get-receipts.js` | **GR-1**: added fail-closed env presence check for Supabase vars; **GR-2**: strict CORS allowlist with origin echo + `Vary: Origin` (removed silent origin fallback); **GR-3**: per-staff+IP `formBucket` rate-limiting to prevent scraping; **GR-4**: sanitize and truncate `receipt_text` (2k chars) and redact PII; **GR-5**: create Supabase client inside handler; **GR-6**: added `Cache-Control: no-cache` to responses; **GR-7**: safer `limit` parsing with bounds (default 10, 1–100); **GR-8**: ensure error responses include consistent CORS headers. |

| 43 | Get Recent Activity Hardening | `netlify/functions/get-recent-activity.js` | **RA-1**: added fail-closed env presence check for Supabase vars; **RA-2**: require `requireManager: true` in `authorize()`; **RA-3**: strict CORS allowlist with origin echo + `Vary: Origin` (removed silent origin fallback); **RA-4**: per-manager+IP `formBucket` rate-limiting to prevent scraping; **RA-5**: sanitize and mask `customer_name` and `item_name` to reduce PII; **RA-6**: create Supabase client inside handler; **RA-7**: added `Cache-Control: no-cache`; **RA-8**: deterministic `maskCustomerName()` returns empty string when missing and uses `sanitizeInput()`; **RA-9**: normalize `current_stock` to numeric or `null`; **RA-10**: central `RECENT_LIMIT` constant used for `.limit()` (default 5); **RA-11**: safe error logging and consistent response headers. |

| 44 | Get Inventory Hardening | `netlify/functions/get-inventory.js` | **GI-1**: added fail-closed env presence check for Supabase vars; **GI-2**: require `requireManager: true` in `authorize()`; **GI-3**: strict CORS allowlist with origin echo + `Vary: Origin` (removed silent origin fallback); **GI-4**: per-manager+IP `formBucket` rate-limiting to prevent scraping; **GI-5**: sanitize and truncate `item_name`/`category`/`unit`; **GI-6**: normalize numeric fields (`current_stock`, `min_threshold`) to Number or `null`; **GI-7**: introduced `INVENTORY_LIMIT` constant used for `.limit()` (500); **GI-8**: added `Cache-Control: no-cache`; **GI-9**: create Supabase client inside handler; **GI-10**: safe error logging and consistent response headers. |

| 45 | Get Sales Report Hardening | `netlify/functions/sales-report.js` | **SR-1**: added fail-closed env presence check for Supabase vars; **SR-2**: CORS allowlist + origin echo + `Vary: Origin`; **SR-3**: per-manager+IP `formBucket` rate-limiting to prevent scraping; **SR-4**: safe normalization of `gross_revenue` (handle bigint/string/number); **SR-5**: create Supabase client inside handler; **SR-6**: use `sanitizedError()` for consistent error responses and include CORS headers. |
 | 45 | Get Sales Report Hardening | `netlify/functions/sales-report.js` | **SR-1**: added fail-closed env presence check for Supabase vars; **SR-2**: strict CORS allowlist with origin echo + `Vary: Origin` (removed silent origin fallback); **SR-3**: per-manager+IP `formBucket` rate-limiting to prevent scraping; **SR-4**: safe normalization of `gross_revenue` (handle bigint/string/number, detect decimal dollars vs integer cents); **SR-5**: create Supabase client inside handler; **SR-6**: add `Cache-Control: no-cache` and consistent CORS headers on `OPTIONS` responses; **SR-7**: `sanitizedError()` responses now include CORS headers. |


| 46 | Export CSV Hardening | `netlify/functions/export-csv.js` | **EC-1**: added fail-closed env presence check for Supabase vars; **EC-2**: strict CORS allowlist with origin echo + `Vary: Origin` (removed silent origin fallback); **EC-3**: require `requireManager: true` in `authorize()`; **EC-4**: per-manager+IP `formBucket` rate-limiting to prevent scraping/export abuse; **EC-5**: validate `start`/`end` (YYYY-MM-DD) and enforce `start <= end` using UTC boundaries; **EC-6**: create Supabase client inside handler; **EC-7**: `EXPORT_ROW_LIMIT` env clamp used for `.limit()` (default 5000, max 5000); **EC-8**: neutralize CSV injection by prefixing formula-leading cells with apostrophe; **EC-9**: sanitize and truncate output fields; **EC-10**: safe numeric normalization and `sanitizedError()` + consistent CORS headers; **EC-11**: `Content-Disposition` filename sanitized for unsafe chars and `Cache-Control: no-cache` added. |

| 47 | Public Config Hardening | `netlify/functions/public-config.js` | **PC-1**: echo validated origin only (no silent hardcoded fallback) and include `Vary: Origin`; **PC-2**: per-IP rate-limiting uses a global shared bucket when IP not present (`public-config:global`) to avoid unbounded 'unknown' keys; **PC-3**: warn on missing public envs (`SQUARE_PRODUCTION_APPLICATION_ID`, `SQUARE_LOCATION_ID`) and return safe placeholders (no secrets leaked); **PC-4**: preserved short cache TTL (5m) and consistent CORS headers. |

| 48 | Marketing Bot Hardening | `netlify/functions/marketing-bot.js` | **MB-1**: moved Supabase `createClient` and Gemini client creation into handler to avoid long-lived service-role objects at module scope; **MB-2**: added fail-closed env presence guard for `SUPABASE_*` and `GEMINI_API_KEY`; **MB-3**: added per-IP/global `formBucket` rate-limiting to protect downstream Gemini quota; **MB-4**: defensive model response extraction and sanitization + truncate (1000 chars) before DB insert; **MB-5**: safe logging of only truncated preview; **MB-6**: consistent sanitized error logging. |

| 49 | Queue Processor Hardening | `netlify/functions/queue-processor.js` | **QP-1**: moved Supabase service-role client creation into handler (avoid long-lived service-role objects); **QP-2**: added explicit fail-closed presence checks for `CRON_SECRET` and other required envs; **QP-3**: replaced raw Resend `fetch` with `fetchWithTimeout` and guarded `RESEND_API_KEY`; **QP-4**: truncate & sanitize RPC error messages before calling `fail_notification`; **QP-5**: mask/truncate sensitive values in logs; **QP-6**: introduced `QUEUE_BATCH_SIZE` env with safe clamp and replaced hardcoded batch size. |

| 50 | Marketing Sync Hardening | `netlify/functions/marketing-sync.js` | **MS-1**: moved Supabase `createClient` to per-request handler instantiation; **MS-2**: added env guards for `MARKETING_SHEET_URL` and `GOOGLE_SHEETS_AUTH_KEY`; **MS-3**: replaced raw `fetch` with `fetchWithTimeout` (15s) and added timeouts for bulk exports (30s); **MS-4**: sanitize and truncate incoming `record` before logging and sending to Sheets; **MS-5**: safe JSON.parse with 400 on invalid JSON; **MS-6**: added `EXPORT_ROW_LIMIT` env to cap bulk exports and use ISO timestamps for consistency. |

| 51 | Supabase → Sheets Hardening | `netlify/functions/supabase-to-sheets.js` | **SS-1**: moved Supabase `createClient` into per-request handler (avoid module-scope service-role client); **SS-2**: added fail-closed env guards for `GOOGLE_SHEETS_AUTH_KEY`, `MARKETING_SHEET_URL`, and `INTERNAL_SYNC_SECRET`; **SS-3**: replaced raw outbound `fetch` with `fetchWithTimeout` (10–15s) for Google Sheets and marketing-sync forwarding; **SS-4**: safe `JSON.parse` with 400 on invalid payloads; **SS-5**: sanitize and truncate incoming record fields (emails, captions, names) before forwarding or logging; **SS-6**: GDPR-friendly deletion propagation to Sheets with guarded email handling; **SS-7**: neutralized and truncated Google responses in logs; **SS-8**: truncated error messages in logs and used sanitized previews for PII; **SS-9**: guarded welcome-email invocation with per-request Supabase client and safe error handling. |
| 54 | Supabase → Sheets Hardening (post-fix) | `netlify/functions/supabase-to-sheets.js` | **SS-10**: added `GOOGLE_SCRIPT_URL` to fail-closed env guard; **SS-11**: added CORS preflight + strict origin echo + `Vary: Origin` and `Cache-Control: no-store`; **SS-12**: ensured `OPTIONS` preflight handling and `POST` method guard; **SS-13**: replaced returned upstream `google_response` with neutral `{ success: true }` and logged truncated upstream text only; **SS-14**: consistent JSON error responses and consistent response headers; **SS-15**: preserved optional per-request `supabase` behaviour for welcome-email with clearer logs. |

| 52 | Marketing Bot Hardening (post-fix) | `netlify/functions/marketing-bot.js` | **MB-7**: added HTTP method guard (`POST` only) and proper `405` for other methods; **MB-8**: strict CORS allowlist + preflight `OPTIONS` handling with echoed `Access-Control-Allow-Origin` + `Vary: Origin`; **MB-9**: wrapped model generation with 12s timeout and graceful `502` on timeout; **MB-10**: added `Cache-Control: no-store` and consistent headers on success/errors; **MB-11**: preserved per-request client creation, service-secret verification, per-IP rate-limiting, and `sanitizeInput()` + truncation of generated captions. |

| 53 | Marketing Sync Hardening (post-fix) | `netlify/functions/marketing-sync.js` | **MS-1**: added CORS preflight + strict origin echo + `Vary: Origin`; **MS-2**: method guard (`POST` only) with `OPTIONS` handling and `405` for other methods; **MS-3**: consistent `Content-Type: application/json` + `Cache-Control: no-store` headers on all responses; **MS-4**: fail-closed `SUPABASE` requirement when `mode=export` (500 if missing); **MS-5**: keep `fetchWithTimeout()` for Sheets calls and neutralize upstream responses in logs; **MS-6**: return JSON responses and `exported` count uses filtered `safeMentions.length`; **MS-7**: preserved tombstone filtering (`filterTombstoned`) for GDPR safety. |

**Files modified to date (84):** `twilio-webhook.js`, `_sms.js`, `send-sms-email.js`, `oauth/initiate.js`, `_auth.js`, `pin-login.js`, `middleware.ts`, `process-merch-payment.js`, `admin/inventory/page.tsx`, `get-applications.js`, `update-application-status.js`, `submit-application.js`, `HiringViewer.tsx`, `register-tracking.js`, `schema-50-tracking-unique.sql`, `create-checkout.js`, `get-loyalty.js`, `redeem-voucher.js`, `get-merch.js`, `health.js`, `get-menu.js`, `shop-data.js`, `checkout/page.tsx`, `schema-all-combined.sql`, `create-customer.js`, `schema-51-receipt-view-hardening.sql`, `claude-chat.js`, `kds/page.tsx`, `update-order-status.js`, `pos/page.tsx`, `order-announcer.js`, `text-to-speech.js`, `portal/page.tsx`, `resident/page.tsx`, `cafe/page.tsx`, `scanner/page.tsx`, `schema-52-trigger-hardening.sql`, `(ops)/error.tsx`, `(site)/error.tsx`, `_ip-hash.js`, `ai-order.js`, `tool-check-waitlist.js`, `pin-clock.js`, `pin-verify.js`, `search-residents.js`, `get-staff-loyalty.js`, `cafe-checkout.js`, `create-order.js`, `square-webhook.js`, `square-sync.js`, `parcel-check-in.js`, `parcel-pickup.js`, `adjust-inventory.js`, `create-inventory-item.js`, `manage-catalog.js`, `upload-menu-image.js`, `public/sw.js`, `update-hours.js`, `log-time.js`, `netlify/functions/get-kds-orders.js`, `netlify/functions/get-queue.js`, `netlify/functions/queue-processor.js`, `netlify/functions/get-manager-stats.js`, `netlify/functions/get-payroll.js`, `netlify/functions/get-receipts.js`, `netlify/functions/get-recent-activity.js`, `netlify/functions/get-inventory.js`, `netlify/functions/sales-report.js`, `netlify/functions/export-csv.js`, `netlify/functions/public-config.js`, `netlify/functions/marketing-sync.js`, `netlify/functions/marketing-bot.js`, `netlify/functions/supabase-to-sheets.js`, `netlify/functions/cancel-stale-orders.js`, `netlify/functions/navigate-site.js`, `netlify/functions/site-settings-sync.js`, `netlify/functions/ops-diagnostics.js`, `netlify/functions/supabase-webhook.js`, `netlify/functions/apify-to-supabase.js`, `netlify/functions/oauth/callback.js`, `netlify/functions/collect-payment.js`

## Recent Remediations

- `netlify/functions/oauth/callback.js` — February 23, 2026: Hardened OAuth callback flow. Changes: moved Supabase and Square clients into per-request instantiation, added fail-closed environment checks (supporting both `SQUARE_APP_ID` and `SQUARE_PRODUCTION_APPLICATION_ID` names), normalized header handling and per-IP rate-limit normalization, wrapped Square token exchange in a 15s timeout, validated token shape before use, avoided logging secrets/stacks, masked merchant id in browser response, and added a TODO to consider application-layer token encryption. 

- `netlify/functions/collect-payment.js` — February 23, 2026: Hardened terminal checkout. Changes: moved Supabase and Square clients into per-request instantiation, added fail-closed env checks (`SUPABASE_*`, `SQUARE_PRODUCTION_TOKEN`, `SQUARE_LOCATION_ID`), validated and clamped `total_amount_cents` with `MAX_CHARGE_CENTS`, added `withTimeout()` (15s) around `terminal.checkouts.create()`, used `BigInt()` on validated cents, returned masked `checkout_id` (no raw upstream object), sanitized/truncated logs, and treated DB update failures as non-fatal. 

## Recent Remediations

- `netlify/functions/apify-to-supabase.js` — February 23, 2026: Hardened webhook handler. Changes: moved Supabase service client to per-request instantiation, added fail-closed environment checks (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `APIFY_TOKEN`), safe JSON parsing with 400 on malformed input, replaced Apify token-in-query with `Authorization: Bearer` header and `fetchWithTimeout` (AbortController), capped large datasets via `APIFY_MAX_ITEMS` and chunked upserts using `UPSERT_CHUNK`, neutralized leading CSV formula characters and truncated long strings, added a short in-memory dedupe window to reduce duplicate processing, and improved logging and error codes.

---

## 14. SCA / SAST Workspace Scan (Feb 23, 2026)

- Note: SCA/SAST scans (e.g., Snyk) are executed outside the audit workflow when CI or org quota allows. Scans are not required after every small manifest or code edit — run targeted or CI-driven scans as appropriate.

---

*End of SITE-MANIFEST.md — February 23, 2026 (Post-Audit #51)*