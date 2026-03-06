# SITE-MANIFEST.md — BrewHub PHL Full-Stack Audit & Reference

**Generated:** March 2026  
**Status:** Production — Phase 2 Stabilized Architecture  
**Stack:** Next.js 16 · Netlify Functions · Supabase (Postgres + Realtime) · Square · Claude AI · ElevenLabs

---

## Table of Contents

1. [Environment Variables](#1-environment-variables)
2. [3rd Party API Dependencies](#2-3rd-party-api-dependencies)
3. [Shared Utilities](#3-shared-utilities-srclib)
4. [Complete Netlify Functions Inventory](#4-complete-netlify-functions-inventory)
5. [Complete SQL Schema Inventory (1–79 + CRM + Specialty Menu + Staff Phone)](#5-complete-sql-schema-inventory-179--crm)
6. [Complete Frontend Page Inventory](#6-complete-frontend-page-inventory)
7. [Frontend Components Inventory](#7-frontend-components-inventory)
8. [Supabase Edge Functions](#8-supabase-edge-functions)
9. [Scripts & Tooling](#9-scripts--tooling)
10. [Security Architecture Summary](#10-security-architecture-summary)

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
| Anthropic Claude | AI text chat via Vercel AI SDK (`ai` + `@ai-sdk/anthropic`) | `CLAUDE_API_KEY` |
| ElevenLabs | Text-to-Speech (Elise voice) | `ELEVENLABS_API_KEY` |
| Twilio | SMS notifications | `TWILIO_ACCOUNT_SID` |
| Resend | Transactional email | `RESEND_API_KEY` |
| Google Sheets | Marketing data sync | `GOOGLE_SCRIPT_URL` |
| Google Gemini | AI testing scripts, marketing | `GEMINI_API_KEY` |
| Sonner | Toast notifications across ops pages and customer-facing order confirmations (EliseChat) | _(none — client-only)_ |

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
| `_pricing.js` | Tax-inclusive pricing utility (`calculateTaxInclusive`) |
| `_sanitize.js` | Input sanitization (strip tags, scripts, event handlers) |
| `_token-bucket.js` | In-memory token bucket for chat/TTS/order rate limiting |
| `_usage.js` | DB-backed daily API quota tracking (circuit breaker) |

---

## 4. Complete Netlify Functions Inventory

*(Refer to codebase for full HTTP methods and Auth mapping. All authenticated frontend operations now enforce `credentials: "include"` via the central `fetchOps()` wrapper.)*

| Function | Method | Auth | Purpose |
|---|---|---|---|
| `get-crm-customers.js` | GET | Manager PIN | Returns filtered `customers` rows for CRM drill-down (8 filter modes: all, app_users, walk_in, mailbox, vip, loyalty, active_30d, new_7d). Origin-validated CORS, 500-row limit, 15s cache. |
| `get-true-profit-report.js` | GET | Manager PIN | Monthly profitability report: sums completed-order revenue, subtracts maintenance costs, operating expenses (OpEx from `property_expenses`), and automated COGS (from `agg_inventory_cogs` RPC), returns net profit + maintenance-to-revenue ratio. Net Profit = Revenue − Maintenance − OpEx − COGS (aligns with Employee Addendum). Query param `?month=YYYY-MM` (defaults to current month). |
| `get-profit-share-preview.js` | GET | Manager PIN | Team profit share preview: reuses `computeProfitReport()`, subtracts $5k Profit Floor, computes 10% Staff Pool via `Math.floor` (strict integer cents). Joins `time_logs` with `staff_directory` to enforce 6-month vesting and 90-day probation filters — only vested employee hours counted. Derives Bonus-per-Hour via `Math.floor`. If bonus < 1¢/hr or 0 eligible hours returns $0.00. Returns `eligible_staff_count`, `pending_staff_count`, `vesting_months`, `probation_days`. Logs ops-diagnostics info when no staff are vested. All display strings formatted by shared `centsToDisplay()`. |
| `cron-monthly-financial-summary.js` | Scheduled | None (cron) | Runs 1st of every month. Emails the previous month's profitability report to all active managers via Resend. CTA to `/manager/assets` when maintenance ratio > 10%. |
| `record-agreement-signature.js` | POST | Staff PIN | Records a staff member's digital signature on the Mutual Working Agreement. Verifies PIN via `verify_staff_pin` RPC, validates body `staff_id` matches session identity, **canonically normalizes** agreement text via `getCanonicalAgreementText` (`_crypto-utils.js`), hashes (SHA-256) server-side, logs normalization delta, then calls the **atomic** `record_agreement_signature` Postgres RPC (insert + `contract_signed` update in one transaction). Notifies managers via Resend. |
| `get-signed-certificate.js` | GET | Staff PIN | Certificate of Agreement endpoint. Re-hydrates agreement template, canonically normalizes, re-derives SHA-256 hash, compares against stored hash. Returns `{ staff_name, version_tag, signed_at, signature_id, stored_hash, derived_hash, integrity_ok }`. Staff see own cert only; managers may view any. |
| `get-schema-health.js` | GET | Manager PIN | Database schema auditor. Queries `information_schema` to verify `agreement_signatures` and `maintenance_logs` tables with full column + type verification (including `cost` as `integer`). Returns structured health report (`healthy`, `missingColumns`, `typeMismatches`) so managers know if a migration is required. |
| `get-override-log.js` | GET | Manager PIN | Returns paginated `manager_override_log` entries (limit/offset). Redacts IP addresses. Used by the `ManagerOverrideLog` Shadcn Data Table component. |
| `promote-to-production.js` | POST | Manager PIN + CSRF | Batch-promotes rows from `simulation` → `production` in `inventory`, `orders`, `equipment`, or `maintenance_logs`. Validates UUIDs, calls `promote_to_production` RPC (max 500/batch). Rate-limited. |

---

## 5. Complete SQL Schema Inventory (1–79 + CRM + Specialty Menu)

| Schema | Purpose |
|---|---|
| `schema-1` – `schema-5` | Core tables, functions, RPCs, RLS policies |
| `schema-6` – `schema-7` | Trigger rewrites (order completion, coffee status cascade) |
| `schema-8-pin` | PIN auth system |
| `schema-9-receipts` | `receipt_queue` table + `orders.completed_at` column |
| `schema-10` to `schema-14` | Payment hardening, PIN brute-force lockouts, Staff RLS, PII-masking VIEW |
| `schema-15` to `schema-19` | Job applications table, column backfills, dropping duplicate FKs |
| `schema-20` to `schema-24` | Strict `resume_url` checks, atomic loyalty, storage bucket locks, IDOR fixes |
| `schema-25` to `schema-30` | Stale order crons, soft-deletes, exact-match inventory triggers |
| `schema-31` to `schema-35` | KDS UPDATE RLS, comp order audits, cryptographic voucher hashing (SHA-256) |
| `schema-36` to `schema-40` | `staff_directory_safe` VIEW, `system_sync_logs`, advisory-locked loyalty sync |
| `schema-41` to `schema-45` | `safe_update_order_status` RPC, atomic staff clock-in, webhook resilience |
| `schema-46-parcel-handoff-hardening` | Parcel handoff hardening (pickup code hashes, audit logs) |
| `schema-47-manager-pin-hardening` | Manager PIN hardening (bcrypt), forced rotation, TOTP nonces |
| `schema-48-tcpa-sms-compliance` | TCPA SMS opt-outs and quiet hour gates |
| `schema-49-offline-payment-guard` | Square Offline Mode tracking and exposure caps |
| `schema-50` to `schema-53` | UNIQUE tracking constraints, time-scoped receipts, OAuth config |
| `schema-54` to `schema-57` | Guest order IPs, denylist auto-bans, outbound parcel tables |
| `schema-58-kds-item-sync` | KDS realtime item-level checkbox syncing and barista claiming |
| `schema-59-inventory-shrinkage-log` | IRS-compliant retail write-off logging |
| `schema-60` to `schema-64` | Dead-letter queues, scheduled shifts, attendance views, no-show alerts |
| `schema-65-webauthn-credentials` | WebAuthn credentials and ephemeral challenges table |
| `schema-66` to `schema-71` | Staff deactivation protocols, atomic receipt claims, clock-in guards |
| `schema-72-parcel-intake-race-fix` | Safe parcel check-in using double FOR UPDATE row-locks |
| `schema-73` to `schema-76` | Resident phone uniqueness, ghost flags, order tax columns |
| `schema-77-staff-status-view` | Dynamic `v_staff_status` VIEW, deprecating static `is_working` |
| `schema-78-unified-pickup-view` | Unified `v_items_to_pickup` combining orders and parcels |
| `schema-79_performance` | Embedded O(1) token versioning within PIN verifications |
| `20260302_unified_crm` | Unified CRM: merges `profiles` + `residents` → single `customers` table with `auth_id`, `unit_number`, VIP, loyalty |
| `20260302_crm_insights_rpc` | `crm_insights()` RPC: aggregated CRM stats for the manager dashboard |
| `20260302_scheduled_shifts_staff_fk` | Repairs `scheduled_shifts.user_id` FK to reference `staff_directory(id)` and cascades deletes safely |
| `20260302_specialty_coffee_menu` | Adds `long_description` (TEXT) and `allowed_modifiers` (JSONB) to `merch_products`; archives legacy menu items; inserts 7 curated specialty coffee items |
| `20260302_add_staff_phone` | Adds nullable `phone TEXT` column to `staff_directory`; inherited by `v_staff_status` view |
| `20260305_pickup_code_generation` | Adds `code_generated` attempt type + `code_hash` column to `parcel_pickup_log` for secure high-value pickup code generation |
| `agreement_signatures` (table) | Immutable audit trail for staff agreement signatures: `id` (uuid PK), `staff_id` (uuid FK), `version_tag`, `ip_address` (hashed), `user_agent`, `sha256_hash`, `signed_at`, `created_at`. Verified by `get-schema-health.js`. |
| `20260304_schema85_onboarding_gate` | Ensures `contract_signed` + `onboarding_complete` columns on `staff_directory`. Updates `verify_staff_pin()` to return them in login/verify flow for OpsGate onboarding gate. |
| `20260305_add_vector_menu` | Enables pgvector (`CREATE EXTENSION vector`). Adds `embedding` column to `merch_products` with IVFFlat index. Creates `match_menu_items(query_embedding, match_threshold, match_count)` RPC for cosine similarity search. SECURITY INVOKER — respects existing RLS. |
| `20260305_switch_to_cohere_vectors` | Drops old 1536-d embedding column/index and recreates as `embedding vector(1024)` for Cohere `embed-english-v3.0`. Updates `match_menu_items` RPC to accept `vector(1024)`. Re-grants EXECUTE to `authenticated`/`anon`. |
| `20260305_schema94_data_integrity_level` | Adds `data_integrity_level` ENUM (`simulation`/`production`) to `inventory`, `orders`, `equipment`, `maintenance_logs`. Creates `v_accounting_ledger_live` view (production-only profitability). Updates `get_low_stock_items()` with `p_include_simulation` flag. Adds `promote_to_production()` RPC for atomic batch promotion. |

---

## 6. Complete Frontend Page Inventory

### Public Pages (`(site)` route group)
| Route | Auth | Description |
|---|---|---|
| `/` | None | Homepage — hero, AI chat |
| `/about`, `/privacy`, `/terms` | None | Informational Pages |
| ~~`/cafe`~~ | — | *Removed — ordering consolidated into `/shop`* |
| `/shop` | None | Merch storefront |
| `/checkout` | None | Cart checkout with Square |
| `/portal` | Supabase JWT | Resident portal (loyalty + parcels) |
| `/resident` | Supabase JWT | Resident registration |
| `/parcels` | Supabase JWT + RLS | Parcel lookup |
| `/queue` | None | Public lobby order board |
| `/admin/dashboard` | Middleware + OpsGate | Revenue, payroll, staff data |
| `/admin/inventory` | Middleware + OpsGate | Inventory management |

### Ops Pages (`(ops)` route group)
| Route | Auth | Description |
|---|---|---|
| `/pos` | Middleware + OpsGate | 3-column POS with Square Terminal |
| `/kds` | Middleware + OpsGate | Kitchen Display System (realtime). Cancel requires Manager TOTP challenge. |
| `/scanner` | Middleware + OpsGate | Inventory barcode scanner |
| `/manager` | Middleware PIN | Manager dashboard |
| `/manager/calendar` | Middleware PIN | Shift scheduling with multi-employee drag-and-drop |
| `/manager/fulfillment` | Middleware PIN | Order fulfillment management |
| `/manager/parcels/monitor` | Middleware PIN | Smart TV kiosk (PII-masked VIEW) |
| `/manager/assets` | Middleware PIN | Equipment asset TCO & maintenance health dashboard |
| `/staff-hub` | Middleware PIN | Staff portal (clock, orders, inventory) |
| `/staff-hub/onboarding` | Middleware PIN | Onboarding: scroll-to-sign Mutual Working Agreement (AgreementViewer). Unsigned staff are force-redirected here by OpsGate. |
| `/parcels-pickup` | Middleware PIN | Parcel pickup workflow (includes `generatePickupCode` Server Action for high-value parcels) |

### API Routes
| Route | Auth | Description |
|---|---|---|
| `/api/check-in` | Rate-limited proxy | Parcel check-in |
| `/api/revalidate` | Secret | Next.js cache revalidation |

---

## 7. Frontend Components Inventory

| Component | Location | Purpose |
|---|---|---|
| `OpsGate.tsx` | `src/components/` | PIN session gate for ops pages. Includes Onboarding Gate: redirects unsigned staff (`onboarding_complete === false`) to `/staff-hub/onboarding`. |
| `StaffNavigation.tsx` | `src/components/` | Staff nav bar for ops |
| `ScrollToTop.tsx` | `src/components/` | Scroll-to-top button |
| `SwipeCartItem.tsx` | `src/components/` | Swipeable cart item (mobile POS) |
| `CatalogManager.tsx` | `(site)/components/manager/` | Menu/merch catalog CRUD |
| `KdsSection.tsx` | `(site)/components/manager/` | KDS overview in dashboard |
| `ManagerNav.tsx` | `(site)/components/manager/` | Manager dashboard navigation |
| `LiveStaffPulse.tsx` | `(site)/components/manager/` | Persistent header badge showing on-site staff with live duration timers. Pushes P1 "Staff Exhaustion" alert into `AlertManager` when any staff member exceeds 16h. |
| `AlertManager.tsx` | `src/context/` | Centralized alert state provider. Defines P0/P1/P2 priority hierarchy with push/dismiss/clear operations. P0 alerts render as blocking modal overlays; P1/P2 as stacking banners. |
| `AlertModal.tsx` | `src/components/manager/` | Full-screen blocking overlay for P0 (Critical) alerts. Focus-trapped; user must acknowledge before dashboard interaction resumes. |
| `AlertBannerStack.tsx` | `src/components/manager/` | Stacking banner list for P1 (Amber) and P2 (Blue) alerts. Sorted by priority then age. |
| `SystemHealthBadge.tsx` | `src/components/manager/` | Header badge showing total active alert count with color-coded severity indicator. Scrolls to alert stack on click. |
| `AlertRenderer.tsx` | `src/components/manager/` | Orchestrator: renders AlertModal (P0) and AlertBannerStack (P1/P2) together. |
| `SecurityAlertToaster.tsx` | `src/components/manager/` | Realtime Sonner toast for `rate_limit_triggered` inserts on `manager_override_log`. Subscribes via Supabase Realtime; only active with a valid staff_pin session. |
| `ManagerOverrideLog.tsx` | `src/components/manager/` | Shadcn Data Table view of `manager_override_log`. Sortable, paginated, with dropdown actions. Red Badge on `none_legacy` challenge method. Fetches from `get-override-log`. |
| `PayrollSection.tsx` | `(site)/components/manager/` | Payroll management |
| `ProfitShareCard.tsx` | `(site)/components/manager/` | Team Profit Share card: progress bar to $5k floor, Staff Pool amount, team hours, bonus-per-hour, eligible staff count with vesting tooltip |
| `CrmInsights.tsx` | `(site)/components/manager/` | Unified CRM breakdown (stat cards + top drinks) |
| `AdminCalendar.tsx` | `src/components/` | Shift calendar with multi-select creation, pill-based rendering, hover tooltips, and grouped drag-and-drop |
| `ExportOrdersButton.tsx` | `(ops)/manager/` | Client-side CSV export of all `coffee_orders` |
| `AssetsPage` | `(ops)/manager/assets/` | Equipment TCO dashboard with sortable table, summary cards (inc. projected maintenance spend Finance card), overdue health badges |
| `MaintenanceLogger` | `src/components/ops/` | Portal modal for logging completed maintenance tasks against an equipment asset |
| `StaffSection.tsx` | `(ops)/manager/components/` | Data-fetching wrapper: loads staff from `v_staff_status` view |
| `StaffTable.tsx` | `(ops)/manager/components/` | Interactive staff directory table with search, role filtering, action menus, role badges, working-status indicators |
| `CustomerTable.tsx` | `(site)/components/manager/` | CRM customer table with 8 filter presets, deferred search, action menus, VIP/loyalty badges |
| `AgreementViewer.tsx` | `src/components/` | Renders and manages the Mutual Working Agreement for staff digital signing. Canonically normalizes text via `getCanonicalAgreementText` before sending to backend so the displayed seal matches the stored seal. Persists scroll-read state to sessionStorage. On 401 mid-signing: saves recovery vault to localStorage, shows inline re-auth PIN modal, and transparently retries the signature POST with the new token. |
| `crypto-utils.ts` | `src/lib/` | Shared canonical normalization utility for agreement hashing (`getCanonicalAgreementText`). CJS mirror: `_crypto-utils.js`. |

*(Note: `StatsGrid.tsx`, `InventoryTable.tsx`, `RecentActivity.tsx`, and `MobileNav.tsx` were deprecated and removed during the refactor.)*

---

## 8. Supabase Edge Functions

| Function | Purpose |
|---|---|
| `notification-worker` | Process notification queue |
| `parcel-pickup` | Parcel pickup handler (dual: also Netlify function) |
| `welcome-email` | Send welcome email on user signup |

---

## 9. Scripts & Tooling

| Script | Purpose |
|---|---|
| `check-models.js` | Verify AI model availability |
| `generate-apple-file.js` | Generate Apple Pay merchant verification |
| `register-apple-pay.js` | Register Apple Pay domain |
| `rotate-secrets.mjs` | Rotate environment secrets |
| `simulate-rush.js` | Fire simulated webhooks (dev only) |
| `debug-imports.mjs` | Debug Next.js import resolution |
| `regenerate_schema_and_diff.py` | Regenerate Supabase schema + diff |

### Test Infrastructure
| Script / Config | Purpose |
|---|---|
| `npm run test:unit` | Run Vitest unit tests |
| `npm run test:functions` | Run Jest Netlify function tests |
| `npm run test:e2e` | Run Playwright end-to-end tests |
| `npm run test:all` | Run all three test suites sequentially |
| `tests/jest.config.functions.js` | Dedicated Jest config for Netlify function tests |

---

## 10. Security Architecture Summary

### Auth Layers
- **Supabase JWT**: Validated via `_auth.js` against dynamic directory data.
- **PIN HMAC Sessions**: 8-hour expiry, timing-safe comparison, IP allowlist.
- **WebAuthn / Passkeys**: Hardware-backed biometric authentication (Schema 65).
- **Service Secrets**: Server-to-server auth for webhooks and background jobs.
- **Square HMAC**: Timing-safe webhook verification with 5-min replay window.
- **CSRF**: `X-BrewHub-Action` header required and enforced globally via `fetchOps`.

### RLS Strategy
- Deny-all by default on every table.
- Scoped SELECT for staff via `is_brewhub_staff()`.
- Service role bypasses for backend operations.
- Manager-only writes via `is_brewhub_manager()`.

### Transport Layer Unified
- Every single authenticated staff request relies on `fetchOps()` located at `@/utils/ops-api`.
- Enforces `credentials: "include"` globally to prevent dropped cookies and redirect loops.
- Centralizes 401 interception to automatically bounce invalid sessions back to the PIN screen.

### Data Protection & Revocation
- **Ghost Admin / Revocation Fix**: Achieved via an O(1) integer comparison (`payload.token_version !== staff.token_version`). A single RPC call bumps the database integer, instantly invalidating all outstanding stateless JWTs.
- **PII Masking**: Views like `parcel_departure_board` and `v_items_to_pickup` truncate names, hide units, and supply jittered timestamps to prevent cross-referencing.
- **Atomic Concurrency**: Used heavily via `pg_advisory_xact_lock` for vouchers, and `FOR UPDATE SKIP LOCKED` for KDS item claims and parcel intake limits.