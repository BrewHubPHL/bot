# SYSTEM-BLUEPRINT.md

**Updated:** February 22, 2026  
**Scope:** Architecture, security layers, operational hardening, and all schema migrations (1–43)

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
- **Note**: Anon SELECT policy exists on `receipt_queue` for Realtime subscriptions — review exposure risk.

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
- **Known Gap**: `log-time.js` and `fix-clock.js` bypass immutable model with direct mutations.

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

## Part 4: Operational Hardening (Feb 2026)

### POS Double-Tap Guard
- **Target**: `src/app/(ops)/pos/page.tsx` — "Send to KDS" button.
- **Fix**: `isSubmitting` state flag disables the button immediately on click, shows "Processing…".
- **Known Gap**: Uses async `setState` — two ultra-fast taps can race. Should use `useRef` lock.

### Scanner Barcode Cooldown
- **Target**: `src/app/(ops)/scanner/page.tsx` — `handleScan()`.
- **Fix**: `lastScannedCode` + `lastScannedTime` refs enforce 3-second dedup window.

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

## Part 6: Known Architecture Gaps

| Area | Gap | Severity |
|---|---|---|
| Auth | `/admin/*` pages not in middleware `OPS_PATHS` — accessible unauthenticated | CRITICAL |
| Auth | `oauth/initiate.js` bypasses `_auth.js` centralized auth | HIGH |
| Payments | `collect-payment.js` uses random idempotency key — double-charge risk | CRITICAL |
| Payments | `process-merch-payment.js` has zero authentication | CRITICAL |
| Audit Trail | `log-time.js` and `fix-clock.js` bypass immutable time_logs model | CRITICAL |
| Vouchers | Schema-39 `atomic_redeem_voucher` regresses schema-35 hash-first lookup | CRITICAL |
| PII | `/parcels` page exposes resident PII without authentication | CRITICAL |
| CSRF | 3 endpoints missing CSRF header validation | HIGH |
| KDS | Case-sensitive status keys — no normalization | HIGH |
| Rate Limits | 6 public endpoints with zero rate limiting | HIGH |
| Tests | <5% function test coverage; zero payment/frontend/edge function tests | HIGH |
| Docs | `README_SECURITY.md` linked but does not exist | HIGH |
| Docs | 15 schemas (29–43), ~30 functions, ~13 pages undocumented in README | HIGH |