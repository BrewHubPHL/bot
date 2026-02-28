# SYSTEM-BLUEPRINT.md

**Updated:** February 23, 2026  
**Scope:** Architecture, security layers, operational hardening, and all schema migrations (1–53)

## Part 1: Core Systems

### Order Flow with Transactional Integrity
- **Transactional Integrity**: Prevents "Infinite Coffee" loops via refund cycling or concurrent voucher redemptions.
  - **Advisory Locking Logic**: Postgres advisory locks ensure mutual exclusion for sensitive operations (e.g., refunds, point redemptions).
  - Mechanism: `pg_try_advisory_xact_lock(hashtext(customer_id::text))` prevents simultaneous modifications.

### Payment Loop Hardening
- **Square Webhook Handler**: Implements multiple layers of payment safety.
  - **Idempotency Lock**: Records webhook event IDs to prevent duplicate processing.
  - **Self-Heal Guard**: Ensures safe retries by clearing idempotency records.
  - **Amount Tolerance**: Validates paid amount against order total with a 2¢ tolerance.
- **Server-Side Price Validation**: All payment endpoints (`create-checkout`, `cafe-checkout`, `create-order`, `process-merch-payment`) look up prices from the database. Client-provided prices are never trusted.

### Virtual Receipt System
- **Thermal Receipt Formatter**: Shared 32-column receipt generator (`_receipt.js`).
- **Receipt Queue**: Persistent `receipt_queue` table, real-time updates via Supabase Realtime (schema-33).
- **Note**: Anon SELECT on `receipt_queue` time-scoped to last 30 minutes (schema-51) — sufficient for Realtime subscriptions without exposing full receipt history.

---

## Part 2: Dual-Auth Perimeter

### IP Guard + PIN HMAC + Supabase JWT
- **Hybrid Auth Perimeter**: Combines Supabase JWTs and PIN-based HMAC tokens.
  - **Supabase JWTs**: Validated against `staff_directory` with token versioning (`version_updated_at`).
  - **PIN HMAC Tokens**: Generated via `pin-login.js`, timing-safe comparisons, 8-hour session expiry.
- **Rate Limiting**: Dual-layer protection (in-memory + DB-backed).
  - **DB Lockout**: `pin_attempts` table tracks failed attempts, enforces lockouts.
  - **Token Bucket**: `_token-bucket.js` for chat/TTS/order rate limiting (resets on cold start, mitigated by DB quota).
  - **IP Allowlist**: Enforced for PIN login; bypassable for managers.

### Role-Based Access Control
- **Role Hierarchy**:
  - `staff`: POS, KDS, Scanner, basic data reads.
  - `manager`: Adds dashboard, reports, payroll, inventory writes, hiring.
  - `admin`: Full access, including settings and diagnostics.
- **DB Enforcement**: `is_brewhub_staff()` and `is_brewhub_manager()` SECURITY DEFINER helpers for RLS policies.

### CSRF Protection
- **Mechanism**: `X-BrewHub-Action` header required on all POST/PATCH/PUT/DELETE endpoints.
- **Module**: `_csrf.js` — enforced on ~16 endpoints.
- **Known Gaps**: `redeem-voucher.js`, `register-tracking.js`, `update-application-status.js` missing CSRF.

---

## Part 3: Data Integrity

### RLS Strategy
- **Row Level Security**: Deny-all by default, scoped SELECT for authenticated staff.
  - **Staff SELECT Policies**: Authenticated users can access operational tables via `is_brewhub_staff()`.
  - **Manager Write Policies**: `is_brewhub_manager()` gates writes on merch_products, payroll_runs.
  - **Service Role**: Backend functions bypass RLS for INSERT/UPDATE/DELETE.

### Parcel View Logic
- **Parcel Monitor**: Smart TV kiosk with zero-PII `parcel_departure_board` VIEW (schema-39).
  - **Masking**: First initial only, no unit_number, opaque ID suffix, carrier + last 4 tracking digits.
  - **Temporal Jitter**: MD5-seeded stable ±3 min jitter on `received_at` (prevents side-channel tracking).
  - **Polling**: 10-second intervals for compatibility.

### Immutable Payroll Audit Trail (IRS Compliance)
- **Schema-42**: `atomic_staff_clock()` — sole code path for clock-in/out + `is_working` toggle.
  - Advisory locking, idempotency, 16h shift flag.
- **Schema-43**: `atomic_payroll_adjustment()` — never edits existing rows; inserts immutable adjustment records.
  - Mandatory reason, manager_id, audit note with UTC timestamp.
  - `v_payroll_summary` aggregated VIEW per staff per ISO week.
- **Note**: `log-time.js` and `fix-clock.js` still bypass immutable model with direct mutations — tracked in gaps below.

### Loyalty Point SSoT (Single Source of Truth)
- **Schema-38/40**: `trg_sync_loyalty_to_customers` trigger syncs `profiles.loyalty_points` → `customers.loyalty_points`.
  - Advisory locking per email for concurrency serialization.
  - `EXCEPTION WHEN OTHERS` handler with fallback logging to `system_sync_logs`.
  - One-time batched reconciliation at migration time.

---

### "Fired is Fired" Logic
- **Token Versioning**: Incrementing `token_version` invalidates all active JWTs/PIN sessions.
- **Fail-Closed Logic**: Default to 401 Unauthorized if `staff_directory` is unreachable.
- **Revocation**: `revoked_users` table checked on every auth verification.

---

## Part 3b: AI / Chatbot Ordering

### Bot Order Flow
- **Endpoint**: `ai-order.js` — authenticated via `X-API-Key` header, key stored in env.
  - Server-side price lookup from `merch_products` (fail-closed — rejects if DB unreachable).
  - Rate-limited via `_token-bucket.js` + daily quota via `_usage.js`.
  - Creates order with `status: 'unpaid'`; customer pays on arrival at the counter.
- **KDS Display**: `unpaid` orders appear on KDS with orange border/badge and "Prepare (Collect on Pickup)" button label.
  - State machine allows `unpaid → preparing / paid / cancelled`.
- **Queue Display**: `unpaid` orders appear in the public queue "In Queue" section with red border and animated "⚠️ UNPAID" badge alerting staff to collect payment.
- **Fallback Prices**: Hardcoded `FALLBACK_PRICES` constant exists but is no longer used — endpoint is fail-closed; rejects orders if DB is unreachable.

---

## Part 4: Operational Hardening (Feb 2026)

### POS Double-Tap Guard
- **Target**: `src/app/(ops)/pos/page.tsx` — "Send to KDS" button.
- **Fix**: `isSubmitting` state flag disables the button immediately on click, shows "Processing…".
- **Known Gap**: Uses async `setState` — two ultra-fast taps can race. Should use `useRef` lock.

### Scanner Barcode Cooldown
- **Target**: `src/app/(ops)/scanner/page.tsx` — `handleScan()`.
- **Fix**: `lastScannedCode` + `lastScannedTime` refs enforce 3-second dedup window.

### KDS Status Normalization
- **Target**: `src/app/(ops)/kds/page.tsx` — `ns()` helper function.
- **Fix**: All status comparisons run through `ns(status)` (`.toLowerCase()`), eliminating silent case-sensitive key mismatches from mixed-case DB data.

### Kiosk Fullscreen Mode
- **Queue** (`src/app/(site)/queue/page.tsx`) and **Monitor** (`src/app/(ops)/manager/parcels/monitor/page.tsx`) auto-request fullscreen on mount via `document.documentElement.requestFullscreen()`.
- `fullscreenchange` event tracked to set `isFullscreen` state.
- A tiny `×` escape button is fixed bottom-right (`opacity-30`, fades to full on hover) — rendered only while in fullscreen, invisible during normal kiosk display.
- Burn-in prevention on monitor: `antiburn` CSS keyframe shifts layout ±1px every 240s; 4K scaling breakpoints at 2560px and 3840px.

### API Rate Limiting
- **Utility**: `src/lib/rateLimit.ts` — sliding-window `Map<IP, timestamps[]>` limiter.
- **Token Bucket**: `src/lib/tokenBucket.ts` — token bucket for API routes.
- **DB Quota**: `_usage.js` — daily circuit breaker surviving cold starts.
- **Known Gap**: 6 public endpoints (`get-menu`, `get-merch`, `get-queue`, `health`, `shop-data`, `public-config`) have zero rate limiting.

### Email Injection Prevention
- **Utility**: `src/lib/escapeHtml.ts` — escapes `& < > " '` to HTML entities.
- **Applied**: `send-sms-email.js` escapes recipient fields in Resend HTML templates.
- **Known Gap**: `welcome-email` Supabase edge function interpolates user input into HTML unescaped.

### Legacy Amputation (Feb 2026)
- **Deleted**: `dead/` directory, `legacy/`, `local-server.js`, `dev-config.js`, `deno.lock`.
- **Cleaned**: `public/_redirects`, `sonar-project.properties`.
- **Remaining Dead Weight**: `express@5.2.1` still in `package.json` for deleted `local-server.js`.

---

## Part 5: Schema Evolution (29–43)

### Catalog & Inventory (Schemas 29–30)
- **Schema-29** (`catalog-archive`): Two-tier hide/archive with `archived_at` column, partial index, updated public SELECT policy.
- **Schema-30** (`inventory-ssot`): Inventory single source of truth — `cups_decremented` column, row-locking trigger, exact-match `decrement_inventory`.

### Data Cleanup (Schema 31)
- **Schema-31** (`drop-redundant-customer-cols`): Migrates `customers.name` → `full_name`, `address` → `address_street` with data backfill.

### KDS & Receipts (Schemas 32–33)
- **Schema-32** (`kds-update-rls`): Staff UPDATE policy on `orders` for KDS status workflow (previously silently failing).
- **Schema-33** (`receipt-realtime`): Anon SELECT on `receipt_queue` for Supabase Realtime subscription.

### Audit & Compliance (Schemas 34–37)
- **Schema-34** (`comp-audit`): `comp_audit` table for complimentary order audit trail with deny-all RLS.
- **Schema-35** (`voucher-hardening`): Cryptographic `code_hash` (SHA-256), plaintext scrub, `voucher_redemption_fails` circuit breaker, daily 3-redemption cap.
- **Schema-36** (`security-hardening`): Profile UPDATE column guard trigger, `staff_directory_safe` VIEW (excludes pin/hourly_rate), `restore_inventory_on_refund` FOR UPDATE lock.
- **Schema-37** (`audit-critical-fixes`): `staff_directory.email` NOT NULL + UNIQUE, `customers.email` UNIQUE, missing indexes, `inventory_audit_log` table, `coffee_orders.order_id` NOT NULL.

### Loyalty & Status (Schemas 38–41)
- **Schema-38** (`loyalty-ssot-sync`): Loyalty sync trigger: `profiles.loyalty_points` → `customers.loyalty_points`.
- **Schema-39** (`total-defense-audit`): Temporal jitter on parcel VIEW, statement/lock timeouts on all critical RPCs, IP hashing.
- **Schema-40** (`loyalty-ssot-bulletproof`): Advisory-locked loyalty sync, `system_sync_logs` table, scoped timeouts, batched reconciliation.
- **Schema-41** (`order-status-remediation`): `safe_update_order_status` RPC, `handle_order_completion` EXCEPTION handler, `prevent_order_amount_tampering` skip on status-only updates.

### Staff Operations (Schemas 42–43)
- **Schema-42** (`atomic-staff-clock`): `atomic_staff_clock()` — sole clock-in/out path with advisory locking, idempotency, 16h shift flag.
- **Schema-43** (`payroll-adjustment-audit`): IRS-compliant `atomic_payroll_adjustment()` RPC (insert-only, never edits), `v_payroll_summary` aggregated VIEW.

---

## Part 5b: Schema Evolution (44–53)

### Voucher & Webhook Resilience (Schemas 44–45)
- **Schema-44** (`voucher-hash-restore`): Restores hash-first voucher lookup regressed by schema-39. Preserves schema-39 timeout guards (5s statement, 3s lock). Re-adds plaintext fallback + opportunistic hash backfill.
- **Schema-45** (`webhook-resilience`): Fixes "Phantom Orders" — Square webhook delays (5–15+ min) left paid terminal orders stuck in `pending`. Adds `square_checkout_id` column to `orders` with index; enables active Square API polling instead of passive webhook wait.

### Parcel Security (Schema 46)
- **Schema-46** (`parcel-handoff-hardening`): Fixes "Fake SMS Walk-Out" vulnerability.
  - Cryptographic 6-digit pickup codes (SHA-256 hashed in DB, never stored plaintext).
  - Value-tier escalation: `standard` vs `high_value` (requires ID check at handoff).
  - Immutable `parcel_pickup_audit` log for every pickup attempt.
  - Brute-force lockout after repeated failed code attempts.
  - Bug fix: `atomic_parcel_checkin` now correctly inserts `recipient_email`.

### Manager PIN Hardening (Schema 47)
- **Schema-47** (`manager-pin-hardening`): Fixes "Shoulder-Surfed God Mode".
  - `pin_hash` column (bcrypt) — plaintext PINs eliminated from `staff_directory`.
  - Forced PIN rotation (configurable, default 30 days) via `pin_changed_at` + `pin_rotation_days`.
  - Per-action TOTP challenge for sensitive manager operations (`totp_secret` column).
  - Immutable `manager_override_log` with device fingerprint + witness tracking.
  - Anomaly detection: comp velocity, overtime spikes, session abuse patterns.

### SMS Compliance (Schema 48)
- **Schema-48** (`tcpa-sms-compliance`): Full TCPA / 10DLC compliance layer.
  - `sms_opt_outs` — application-level registry, honored instantly (not just via Twilio built-in).
  - `sms_consent_audit` — immutable opt-in/out event history.
  - `sms_delivery_log` — every outbound message tracked for audit.
  - `check_sms_send_allowed(phone)` RPC — atomic pre-send gate before every send.
  - Quiet hours: blocks messages 9 PM – 9 AM recipient local time.

### Offline & Race Condition Hardening (Schemas 49–50)
- **Schema-49** (`offline-payment-guard`): Fixes "Square Offline Mode Trap" (30–40% batch decline rate after outages).
  - `offline_sessions` table tracks every connectivity outage event.
  - `offline_payment_loss_ledger` records each declined charge with staff accountability.
  - Cash-only exposure caps during outages; post-recovery aggressive decline reconciliation.
- **Schema-50** (`tracking-unique`): Fixes TOCTOU race on `register-tracking.js`.
  - Replaces non-unique `idx_expected_tracking` with `UNIQUE CONSTRAINT` on `expected_parcels.tracking_number`.
  - Enables atomic `INSERT … ON CONFLICT` (upsert) instead of SELECT-then-INSERT.

### View & Trigger Hardening (Schemas 51–52)
- **Schema-51** (`receipt-view-hardening`): Audit #16.
  - Time-scopes `receipt_queue` anon SELECT to last 30 minutes — prevents full receipt history exposure via anon key.
  - REVOKEs SELECT on `daily_sales_report` from anon/authenticated (service_role only via Netlify functions).
  - REVOKEs SELECT on `v_payroll_summary` (PII: emails, hourly rates, gross pay).
- **Schema-52** (`trigger-hardening`): Audit #23.
  - `sync_coffee_order_status`: EXCEPTION handler prevents coffee_orders UPDATE failure from blocking parent order status change; errors logged to `system_sync_logs`.
  - `comp_audit`: FK constraints added on `order_id` and `staff_id`.
  - `time_logs`: functional index added on `lower(employee_email)`.

### OAuth Token Storage (Schema 53)
- **Schema-53** (`shop_settings`): `shop_settings` table for Square OAuth tokens + shop metadata.
  - Deny-all RLS policy (`USING (false)`) — accessible only via service_role.
  - Columns: `id`, `access_token`, `refresh_token`, `merchant_id`, `updated_at`.

### Advanced Tracking & Triggers (Schemas 54–60)
- **Schema-54** (`guest-order-ip`): Hashes guest IPs for abuse tracking without storing raw PII.
- **Schema-55/56** (`guest-order-denylist` / `auto-ban`): Auto-bans IPs that spam guest orders (5+ in 24 hours).
- **Schema-57** (`outbound-parcels`): Adds FedEx/UPS drop-off flows for residents to the departure board.
- **Schema-58** (`kds-item-sync`): Item-level syncing (`completed_at`) and barista claiming (`claimed_by`) for the KDS.
- **Schema-59** (`inventory-shrinkage-log`): IRS-compliant audit trail for retail write-offs (breakage/theft).
- **Schema-60** (`system-errors`): Dead-letter queue for orphan payments and webhook failures.

### Automated Accountability & Security (Schemas 61–68)
- **Schema-61/62/63** (`scheduled-shifts`): Adds the calendar system, RLS, and overlapping shift guards.
- **Schema-64** (`no-show-alert`): Database cron job to catch late staff and trigger the Twilio SMS watchdog.
- **Schema-65** (`shift-audit-log` / `webauthn-credentials`): Immutable black-box recorder for schedule changes, plus biometric passkey setup.
- **Schema-66** (`staff-deactivation` / `receipt-leak-fix`): Revokes anon access to receipts (closing the PII leak) and adds one-click staff deactivation that nukes PINs and Passkeys.
- **Schema-67** (`waitlist-lockdown`): Drops anon insert policies on the waitlist, routing all signups through the server-side bot fortress.
- **Schema-68** (`receipt-claim`): Adds atomic `FOR UPDATE SKIP LOCKED` claims so concurrent iPads do not print duplicate receipts.
---

## Part 6: Known Architecture Gaps

| Area | Gap | Severity | Status |
|---|---|---|---|
| Auth | `/admin/*` pages not in middleware `OPS_PATHS` — accessible unauthenticated | CRITICAL | Open |
| Auth | `oauth/initiate.js` bypasses `_auth.js` centralized auth | HIGH | Open |
| Payments | `collect-payment.js` uses random idempotency key — double-charge risk | CRITICAL | Open |
| Payments | `process-merch-payment.js` has zero authentication | CRITICAL | Open |
| Audit Trail | `log-time.js` and `fix-clock.js` bypass immutable time_logs model | CRITICAL | Open |
| Vouchers | Schema-39 `atomic_redeem_voucher` regressed schema-35 hash-first lookup | CRITICAL | ✅ Fixed (schema-44) |
| PII | `/parcels` page exposed resident PII without authentication | CRITICAL | ✅ Fixed (parcel_departure_board VIEW + schema-14 RLS) |
| Parcels | "Fake SMS Walk-Out" — no cryptographic pickup code verification | CRITICAL | ✅ Fixed (schema-46) |
| Staff Auth | Manager PIN stored in plaintext | CRITICAL | ✅ Fixed (schema-47, bcrypt hash) |
| SMS | No application-level STOP/opt-out enforcement — TCPA exposure | HIGH | ✅ Fixed (schema-48) |
| Payments | Square Offline Mode — batch declines eat revenue with no trace | HIGH | ✅ Fixed (schema-49) |
| DB Race | `expected_parcels` TOCTOU allows duplicate tracking rows | HIGH | ✅ Fixed (schema-50, UNIQUE constraint) |
| Receipt PII | `receipt_queue` anon SELECT exposed all historical receipt text | HIGH | ✅ Fixed (schema-51, 30-min time window) |
| Views | `daily_sales_report` and `v_payroll_summary` readable by anon | HIGH | ✅ Fixed (schema-51, REVOKE) |
| KDS | Case-sensitive status keys — silent mismatches | HIGH | ✅ Fixed (`ns()` normalizer in kds/page.tsx) |
| CSRF | `redeem-voucher.js`, `register-tracking.js`, `update-application-status.js` missing CSRF | HIGH | ✅ Fixed (Audit #13, #10, #9) |
| Rate Limits | 6 public endpoints with zero rate limiting (`get-menu`, `get-merch`, `get-queue`, `health`, `shop-data`, `public-config`) | HIGH | Open |
| POS | Double-tap guard uses `setState` — ultra-fast race still possible, should use `useRef` | MEDIUM | Open |
| Tests | <5% function test coverage; zero payment/frontend/edge function tests | HIGH | Open |
| Docs | `README_SECURITY.md` linked but does not exist | HIGH | Open |