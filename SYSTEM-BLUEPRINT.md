# SYSTEM-BLUEPRINT.md

**Updated:** March 2026  
**Scope:** Architecture, security layers, operational hardening, and all schema migrations (1–79 + Unified CRM)

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
  - **merch_products extended columns**: `long_description` (TEXT) for origin stories / tasting notes; `allowed_modifiers` (JSONB, default `[]`) for per-item modifier group keys (`milks`, `sweeteners`, `standard_syrups`, `specialty_addins`).
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

---

## Part 6: Unified CRM & Schedule Management (March 2026)

### Unified CRM Migration (`20260302_unified_crm`)
- **Single Customer Table**: Merged the legacy `profiles` and `residents` tables into a single `customers` table.
  - `auth_id` (nullable UUID): Links to `auth.users` for app users; `NULL` for walk-ins.
  - `unit_number`: Absorbs the residents mailbox field for mailbox renters.
  - `is_vip`, `barcode_id`, `favorite_drink`, `total_orders`: Profile-originated fields backfilled and migrated.
- **Trigger Rewrite**: `handle_new_user()` now targets `customers` directly on `auth.users` INSERT.
- **RLS Rewrite**: All policies rewritten for the unified table; staff SELECT, manager writes, service-role bypass.
- **FK Migration**: `orders`, `coffee_orders`, `vouchers` FKs all point to `customers.id`.
- **Legacy Cleanup**: `profiles` and `residents` tables dropped after verified backfill.

### CRM Insights RPC (`20260302_crm_insights_rpc`)
- **`crm_insights()`**: Stable SECURITY DEFINER function returning a single JSONB row with:
  - Total customers, app users, walk-ins, mailbox renters, VIPs, loyalty-active count
  - Top 5 favorite drinks, 30-day active users, 7-day new signups, mailbox-cafe crossover rate

### Manager CRM Dashboard (`CrmInsights.tsx`)
- **Visual Breakdown**: Stat cards displaying CRM metrics with color-coded accents.
- **Top Drinks**: Ranked list of favorite drinks across the customer base.
- **Data Source**: Calls `get-crm-insights` Netlify function (manager-only, rate-limited).

### Schedule Management (`manage-schedule.js`)
- **Shift CRUD**: Full create/update/delete for `scheduled_shifts` via manager PIN auth.
- **Batch Operations**: POST, PATCH, and DELETE all support batch mode — `user_ids[]` for creating multiple shifts, `shift_ids[]` for moving grouped shifts, and `ids[]` for batch deletion. Single-item backward compatibility maintained.
- **Server-Side Role Lookup**: Batch POST looks up each employee's role from `staff_directory` rather than trusting client-provided `role_id`.
- **Date-Windowed GET**: Accepts optional `start_date` and `end_date` query params; defaults to now → +30 days. Hard limit of 500 rows prevents unbounded result sets.
- **Error Logging**: All catch paths call `logSystemError()` for persistent error tracking.
- **Calendar Integration**: `AdminCalendar.tsx` uses server-side `manage-schedule` endpoint with CSRF + rate limits. Shifts sharing the same time slot are grouped into a single calendar event with pill-based employee badges.
- **Multi-Employee Scheduling**: Managers can assign multiple employees to a single time slot in one action via checkbox multi-select in the shift creation modal.
- **Pill Rendering**: Overlapping shifts render as compact colored pills (initials for 2+ employees, full name for solo). A "+X more" badge appears when a slot has more than 3 assignees.
- **Hover Peek**: Hovering over a multi-employee shift block displays a tooltip with the full roster, avoiding the need to open the edit modal.

### Scheduled Shifts FK Repair (`20260302_scheduled_shifts_staff_fk`)
- **Constraint Correction**: Drops the incorrect `scheduled_shifts_user_id_fkey` pointing at `auth.users`.
- **Data Cleanup**: Removes orphaned `scheduled_shifts` rows where `user_id` has no matching record in `staff_directory`.
- **Safe Re-bind**: Re-adds `scheduled_shifts_user_id_fkey` to `staff_directory(id)` with `ON DELETE CASCADE`.

### Function Updates for Unified CRM
- `create-customer.js`, `upsert-guest.js`, `search-residents.js`, `get-loyalty.js`, `get-staff-loyalty.js`, `process-quick-add.js`, `parcel-check-in.js`, `order-announcer.js`, `daily-pulse.js`: All updated to query `customers` instead of `profiles`/`residents`.

---

## Part 7: Error Handling Hardening, Specialty Menu & Staff Management (March 2026)

### Supabase Error Handling Compliance Sweep
- **Scope:** 25+ Netlify functions audited and patched to enforce the #1 architectural non-negotiable: explicit `if (error)` checks after every Supabase query.
- **Problem:** Supabase JS does not throw on query failures. Many functions used bare `await` or relied solely on `try/catch`, silently swallowing database errors.
- **Fix Pattern:** Every Supabase call now destructures `{ data, error }` and explicitly checks `if (error)` before proceeding. All catch paths call `logSystemError()` for persistent tracking.
- **Functions patched:** `_auth.js`, `_process-payment.js`, `_sms.js`, `_system-errors.js`, `cafe-checkout.js`, `claude-chat.js`, `daily-pulse.js`, `fix-clock.js`, `get-arrived-parcels.js`, `get-loyalty.js`, `get-manager-stats.js`, `get-menu.js`, `get-shift-status.js`, `get-staff-loyalty.js`, `manage-catalog.js`, `manage-schedule.js`, `manager-challenge.js`, `oauth/callback.js`, `parcel-check-in.js`, `parcel-pickup.js`, `process-merch-payment.js`, `queue-processor.js`, `reconcile-pending-payments.js`, `square-webhook.js`, `update-hours.js`, `update-order-status.js`.
- **Key pattern changes:**
  - `.single()` → `.maybeSingle()` where zero results are valid (receipts, payment reuse checks).
  - Rollback operations (`orders.delete`, `coffee_orders.delete`) now capture and log errors instead of silently discarding.
  - Comp audit inserts converted from `try/catch` to explicit `{ error }` destructuring.

### Square Webhook Refund Lock Safety
- **Problem:** If refund processing threw an exception, the advisory lock was never released, permanently locking the order.
- **Fix:** Refund lock release moved to `finally` block in `square-webhook.js`, guaranteeing cleanup regardless of processing outcome.
- **Additional:** All Supabase operations in `handleRefund` and `handleOfflineDecline` now check `if (error)` explicitly.

### Queue Processor Concurrent Pipeline (`queue-processor.js`)
- **Before:** Sequential `for` loop processing one notification at a time.
- **After:** 4-phase concurrent pipeline:
  1. **Phase 1 — Send:** `Promise.allSettled()` fires all notifications concurrently.
  2. **Phase 2 — Batch Update:** Single `.in()` query updates all successful parcels (replaces per-task updates).
  3. **Phase 3 — Complete:** Concurrent `complete_notification` RPC calls for succeeded tasks.
  4. **Phase 4 — Fail:** Records failures via `fail_notification` RPC for automatic retry.
- **Impact:** Throughput scales linearly with notification volume; one failure no longer blocks the entire batch.

### Claude Chat — `check_parcels` Tool + Security Hardening (`claude-chat.js`)
- **New Tool:** `check_parcels` searches the `parcels` table by resident name (fuzzy `ilike`) and/or unit number (exact `eq`).
  - Input sanitized: LIKE wildcards (`%`, `_`) stripped, 2-char minimum for name searches.
  - Separate parameterized queries prevent PostgREST filter injection (previously used vulnerable `.or()` composition).
  - Returns only carrier + arrival time — no PII (tracking numbers, sender details, recipient names, unit numbers never exposed to the LLM).
- **System Prompt:** Updated with `check_parcels` usage instructions and ButterflyMX physical-access reminder.
- All Supabase queries (loyalty lookups, order rollbacks, coffee_orders cancellation) now check `if (error)` explicitly.

### Specialty Coffee Menu (`20260302_specialty_coffee_menu`)
- **New Columns:** `long_description` (TEXT) and `allowed_modifiers` (JSONB, default `[]`) added to `merch_products`.
- **Legacy Archival:** All existing `category='menu'` items set to `is_active = false` before inserting new curated items.
- **7 Curated Items:** Alfaro Master Roast, Coffee Balam Congo, Coffee Balam Coyote Cold Brew, Gran Crema Espresso, Mocha, Gusto Classico Cortado, Coffee Balam Cornizuelo Latte.
- **Modifier Groups:** Each item specifies its allowed modifier groups (`milks`, `sweeteners`, `standard_syrups`, `specialty_addins`) via the JSONB column.

### POS Modifier System (`(ops)/pos/page.tsx`)
- **Modifier Groups:** New `MODIFIER_GROUPS` constant defines 4 groups with per-modifier pricing (`milks`, `sweeteners`, `standard_syrups`, `specialty_addins`).
- **Quantity-Aware:** Cart modifiers carry a `quantity` field; totals multiply `price_cents * quantity`. Display renders "Sugar (x3)" notation.
- **Per-Item Resolution:** `getModifiersForItem()` reads the item's `allowed_modifiers` JSONB and resolves to a flat modifier list, so items only show relevant customizations.
- **Double-Tap Prevention:** `payingRef` lock prevents concurrent payment calls.
- **Memory Leak Prevention:** Timer refs (`orderSuccessTimerRef`, `recoveryTimerRef`) with proper `useEffect` cleanup.
- **Cancel Safety:** Cart only clears on successful cancel to prevent ghost KDS cards.

### ShopClient Specialty Menu Overhaul (`ShopClient.tsx`)
- Extended `Product` type with `long_description` and `allowed_modifiers`.
- Cart items track `base_price_cents` + `customizations[]` with per-modifier quantity.
- Modifier group definitions mirror the POS system for consistency.

### Staff Phone Migration (`20260302_add_staff_phone`)
- Adds nullable `phone TEXT` column to `staff_directory`.
- Automatically inherited by the `v_staff_status` view (uses `sd.*`).

### CRM Customer Endpoint (`get-crm-customers.js`)
- **New:** Manager-only, rate-limited GET endpoint returning filtered `customers` rows.
- **8 Filter Modes:** `all`, `app_users`, `walk_in`, `mailbox`, `vip`, `loyalty`, `active_30d`, `new_7d`.
- **Guards:** Origin-validated CORS, 500-row page limit, 15-second cache, CSRF + rate limiting.

### Staff Management UI
- **StaffSection.tsx:** Data-fetching wrapper loading staff from `v_staff_status` view (respects the "never read `is_working` directly" rule).
- **StaffTable.tsx:** ~470-line interactive staff directory table with search, role filtering (Manager/Barista/Admin/Owner), portal-based action menus, colored role badges, working-status indicators.
- **CustomerTable.tsx:** ~465-line CRM customer table with 8 filter presets, deferred search (`useDeferredValue`), portal-based action menus (Check-in Package, Add Loyalty, Log Manual Order), VIP/loyalty badges.
- **ExportOrdersButton.tsx:** Client-side CSV export of `coffee_orders` — fetches from Supabase, builds CSV, triggers browser download.

### Admin Dashboard — `fetchOps` Migration
- Replaced 4 raw `fetch()` calls with `fetchOps()` for `/sales-report`, `/get-manager-stats`, `/get-inventory`, `/get-payroll`.
- Functions converted to `useCallback` for correct dependency tracking.

### Cafe Page Removal
- `src/app/(site)/cafe/page.tsx` deleted — ordering consolidated into `/shop`.

### ESLint Flat Config Migration
- `.eslintignore` file deleted; entries migrated into `globalIgnores()` in `eslint.config.mjs`.
- Added `.netlify/**`, `node_modules/**`, `dist/**` to ignored patterns.

### Test Infrastructure
- **New npm scripts:** `test:unit` (vitest), `test:functions` (jest), `test:e2e` (playwright), `test:all` (runs all three).
- **New config:** `tests/jest.config.functions.js` — dedicated Jest config for Netlify function tests.
- Updated `tests/vitest.config.ts` and `tests/setup-tests.ts`.