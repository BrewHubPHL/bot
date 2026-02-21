# SYSTEM-BLUEPRINT.md

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

### Virtual Receipt System
- **Thermal Receipt Formatter**: Shared 32-column receipt generator.
- **Receipt Queue**: Persistent store for receipts, real-time updates via Supabase.

---

## Part 2: Dual-Auth Perimeter

### IP Guard + PIN HMAC + Supabase JWT
- **Hybrid Auth Perimeter**: Combines Supabase JWTs and PIN-based HMAC tokens.
  - **Supabase JWTs**: Validated against `staff_directory` with token versioning.
  - **PIN HMAC Tokens**: Generated via `pin-login.js`, timing-safe comparisons.
- **Rate Limiting**: Dual-layer protection (in-memory + DB-backed).
  - **DB Lockout**: `pin_attempts` table tracks failed attempts, enforces lockouts.

### Role-Based Access Control
- **Role Hierarchy**:
  - `staff`: POS, KDS, Scanner.
  - `manager`: Adds dashboard and reports.
  - `admin`: Full access, including inventory and settings.

---

## Part 3: Data Integrity

### RLS Strategy
- **Row Level Security**: Deny-all by default, scoped SELECT for authenticated staff.
  - **Staff SELECT Policies**: Authenticated users can access operational tables.
  - **Service Role**: Backend functions bypass RLS for INSERT/UPDATE/DELETE.

### Parcel View Logic
- **Parcel Monitor**: Smart TV kiosk with zero-PII `parcel_departure_board` VIEW.
  - **Polling**: 10-second intervals for compatibility.
  - **Security**: PII masked at the SQL level.

---

### "Fired is Fired" Logic
- **Token Versioning**: Incrementing `token_version` invalidates all active JWTs.
- **Fail-Closed Logic**: Default to 401 Unauthorized if `staff_directory` is unreachable.

---

## Part 4: Operational Hardening (Feb 2026)

### POS Double-Tap Guard
- **Target**: `src/app/(ops)/pos/page.tsx` — "Send to KDS" button.
- **Fix**: `isSubmitting` state flag disables the button immediately on click, shows "Processing…", and prevents duplicate `cafe-checkout` API calls.
- **Reset**: `finally { setIsSubmitting(false) }` ensures recovery on both success and error. `clearCart()` also resets.

### Scanner Barcode Cooldown
- **Target**: `src/app/(ops)/scanner/page.tsx` — `handleScan()` function.
- **Fix**: `lastScannedCode` + `lastScannedTime` refs enforce a 3-second dedup window. If the same barcode string fires twice within 3 s, the second scan is silently ignored.
- **Existing guard**: `scanLockRef` (concurrency lock) is preserved; the cooldown sits above it.

### API Rate Limiting
- **Utility**: `src/lib/rateLimit.ts` — sliding-window `Map<IP, timestamps[]>` limiter.
- **Configuration**: `createRateLimiter({ windowMs, max })` factory + `globalLimiter` singleton.
- **Cleanup**: Periodic `setInterval` sweep (unref'd) removes stale keys.
- **Usage**: `src/app/api/check-in/route.ts` wraps parcel check-in with 10 req/60 s per IP, returns 429 + `Retry-After` header.

### Email Injection Prevention
- **Utility**: `src/lib/escapeHtml.ts` — escapes `& < > " '` to HTML entities.
- **Applied**: `netlify/functions/send-sms-email.js` escapes `recipient_name` and `tracking` in Resend HTML templates.
- **Existing**: `netlify/functions/_sanitize.js` strips tags/scripts for DB input (complementary, not overlapping).

### Legacy Amputation (Feb 2026)
- **Deleted**: `dead/` directory (all legacy HTML, CSS, JS, voice-convai, rewards).
- **Deleted**: `legacy/` (empty shell), `local-server.js`, `dev-config.js`, `deno.lock`, `supabase_snippet.csv`.
- **Cleaned**: `public/_redirects` (removed 16 `.html→route` 301s), `sonar-project.properties` (updated suppression paths).
- **Result**: Zero `.html` files in `public/`. All routing handled by Next.js App Router.