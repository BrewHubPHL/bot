# SYSTEM-BLUEPRINT.md

**Updated:** March 2026  
**Scope:** Architecture, security layers, operational hardening, and all schema migrations (1–79)

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

### WebAuthn/Passkeys
- **Biometric Authentication**: Added WebAuthn/Passkeys (Face ID / Touch ID) for staff login.
  - **Setup**: Staff can register passkeys via `webauthn-credentials` table (Schema-65).
  - **Fallback**: PIN HMAC remains as a backup for non-biometric devices.

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
- **Module**: `_csrf.js` — enforced globally via `fetchOps`.

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
- **Schema-42**: `atomic_staff_clock()` — sole code path for clock-in/out.
- **Schema-43**: `atomic_payroll_adjustment()` — never edits existing rows; inserts immutable adjustment records.

### "Fired is Fired" Logic
- **O(1) Token Versioning**: Stateless JWTs now embed an integer `payload.token_version`.
  - **Revocation Check**: The auth middleware performs an instant O(1) comparison: `payload.token_version !== staff.token_version`.
  - **Instant Logout**: Calling the `invalidate_staff_sessions` RPC increments the database integer, instantly and mathematically bricking every active token the staff member holds.

---

## Part 4: Operational Hardening (Feb/March 2026)

### FetchOps Centralization
- Replaced 48+ raw `fetch()` calls across the `(ops)` and `admin` routes with `fetchOps()`.
- Guarantees `credentials: "include"`, `X-BrewHub-Action`, and the correct `Authorization` headers are sent.
- Enforces a unified 401 interceptor that gracefully redirects expired sessions back to the PIN screen.

### React 19 Hydration Compliance
- Eliminated browser-API hydration mismatches on the root `page.tsx` by implementing `next/dynamic` boundaries with `ssr: false`.

### Kiosk Fullscreen Mode & Realtime Polling
- Implemented memory-safe Supabase Realtime subscriptions (WebSockets) in the KDS and Queue Monitors, replacing traditional HTTP intervals. Unmounts cleanly using `useEffect` cleanup routines.

---

## Part 5a: Schema Evolution (29–43)
*(See previous documentation or SITE-MANIFEST.md for earlier schemas)*

## Part 5b: Schema Evolution (44–53)
*(See previous documentation or SITE-MANIFEST.md for earlier schemas)*

## Part 5c: Dynamic Views & Performance (Schemas 54–79)

### The View-ification Shift
- **`v_staff_status` (Schema 77)**: Deprecated the legacy `is_working` column. A staff member's working state is now computed entirely dynamically on the fly by checking for an open `time_logs` row.
- **`v_items_to_pickup` (Schema 78)**: Consolidated read-layer unifying `orders`, `parcels`, and `outbound_parcels` under one unified interface for front-of-house pickup tracking.

### Additional Features
- **WebAuthn Credentials (Schema 65)**: Tables to support passwordless, biometric staff login.
- **Two-Phase Commit Race Fixes (Schema 72)**: Advanced double `FOR UPDATE` row-locks instituted during parcel intake to strictly prevent "Double Flip" notification glitches.
- **Performance (Schema 79)**: Bound `token_version` directly into the `verify_staff_pin` out params to support instantaneous token revocations.