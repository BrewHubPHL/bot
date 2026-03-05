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

### Manager Dashboard Alert Hierarchy
- **AlertManager Provider** (`src/context/AlertManager.tsx`): Centralized alert state with prioritized queue (P0 → P1 → P2), push/dismiss/clear operations. Wraps the manager dashboard in a React context.
- **P0 (Critical / Red)**: Schema mismatches (`get-schema-health`), DB connection failures. Rendered as a **blocking modal overlay** (`AlertModal.tsx`) with focus trap — the dashboard is non-interactive until all P0 alerts are acknowledged.
- **P1 (High / Amber)**: Maintenance-overdue equipment (`get-asset-analytics`), Staff exhaustion (>16h shift from `LiveStaffPulse`). Rendered as stacking banners below the header.
- **P2 (Medium / Blue)**: Low stock warnings, pending agreement signatures. Rendered as stacking banners below P1.
- **SystemHealthBadge**: Header badge showing total alert count with color-coded severity. Clicking scrolls to the banner stack.
- **Rendering**: `AlertRenderer.tsx` orchestrates both `AlertModal` and `AlertBannerStack`. Placed between the sticky header and main content area in `manager/page.tsx`.

---

## Part 3: Data Integrity

### RLS Strategy
- **Row Level Security**: Deny-all by default, scoped SELECT for authenticated staff.
  - **Staff SELECT Policies**: Authenticated users can access operational tables via `is_brewhub_staff()`.
  - **Manager Write Policies**: `is_brewhub_manager()` gates writes on merch_products, payroll_runs, equipment, maintenance_logs.
  - **merch_products extended columns**: `long_description` (TEXT) for origin stories / tasting notes; `allowed_modifiers` (JSONB, default `[]`) for per-item modifier group keys (`milks`, `sweeteners`, `standard_syrups`, `specialty_addins`).
  - **Equipment Asset Tables** (Schema-82): `equipment` (name, category, purchase_price, install_date, maint_frequency_days, last_maint_date) and `maintenance_logs` (equipment_id FK, performed_at, cost, notes, performed_by). RLS via `is_brewhub_manager()`. `get_asset_analytics()` RPC computes TCO, daily operating cost, and overdue health status.
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

## Part 5c: Dynamic Views & Performance (Schemas 54–80)

### The View-ification Shift
- **`v_staff_status` (Schema 77)**: Deprecated the legacy `is_working` column. A staff member's working state is now computed entirely dynamically on the fly by checking for an open `time_logs` row.
- **`v_items_to_pickup` (Schema 78)**: Consolidated read-layer unifying `orders`, `parcels`, and `outbound_parcels` under one unified interface for front-of-house pickup tracking.

### Security-Definer View Audit (Schema 80)
- **Converted to SECURITY INVOKER**: `staff_directory_safe` (service_role only), `v_attendance_report` (no consumers).
- **Intentionally retained as SECURITY DEFINER**: `v_items_to_pickup`, `v_staff_status`, `parcel_departure_board` — these provide masked data windows to anon browser clients. Grants hardened to SELECT-only.

### Comprehensive Lint Remediation (Schema 81)
- **Function search_path pinning**: All public-schema functions pinned to `SET search_path = 'public'` via dynamic DO block.
- **Extension hygiene**: `btree_gist` moved from `public` to `extensions` schema.
- **RLS policy tightening**: 4 INSERT policies with `WITH CHECK(true)` scoped to proper predicates (`is_brewhub_staff()`, `auth.uid()` matching, email validation).

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

### Equipment & Maintenance Assets (`20260304_schema82_equipment_assets`)
- **New Tables:** `equipment` (asset registry with purchase_price, install_date, maint_frequency_days, last_maint_date) and `maintenance_logs` (journal of maintenance events with cost, notes, performed_by FK).
- **Trigger:** `trg_update_last_maint_date` auto-updates `equipment.last_maint_date` on new maintenance log insert.
- **RLS:** Full manager-only CRUD via `is_brewhub_manager()` on both tables.
- **RPC:** `get_asset_analytics()` — SECURITY DEFINER function returning TCO (purchase + sum of maintenance costs), daily operating cost, and boolean overdue health status per asset.
- **RPC:** `agg_maintenance_costs(start_date date, end_date date)` — STABLE SQL function returning `(total_cost_cents bigint, event_count bigint)`. Uses `COALESCE(cost, 0)` to guarantee NULL safety at the SQL level. Called by `_profit-report.js` for profit computation.
- **RPC:** `calculate_projected_asset_spend(months_ahead int)` (Schema-83) — SECURITY DEFINER function that identifies all active equipment with a next maintenance date within `months_ahead` months, averages the cost of each item's last 3 maintenance logs, and returns a JSON object `{ total_projected_cost, flagged_equipment[] }`. Input clamped to 1–24 months.
- **Netlify Function:** `get-asset-analytics.js` — manager-only GET endpoint using the RPC, includes rate limiting (`staffBucket`) and error logging.
- **Netlify Function:** `get-projected-maintenance.js` — manager-only GET endpoint (`?months=3`). Calls `calculate_projected_asset_spend` RPC. Rate-limited via `staffBucket`, no CSRF (idempotent GET).
- **Netlify Function:** `log-maintenance-action.js` — manager-only POST endpoint that inserts into `maintenance_logs`; the existing `trg_update_last_maint_date` trigger atomically updates `equipment.last_maint_date` in the same transaction. Validates UUID, date (no future), cost bounds, and sanitizes notes via `sanitizeInput()`.
- **Frontend:** `/manager/assets` page with sortable equipment table, summary cards (Total Assets, Total TCO, Overdue, Projected Maintenance Spend), and overdue badges. The Finance card shows "Est. Maint. Spend (Next 90d)" with an expandable flagged equipment list. Each row has a "Log Maint." button that opens the `MaintenanceLogger` portal modal. Manager dashboard shows a persistent toast notification on mount when any asset is overdue.
- **MaintenanceLogger Component:** `src/components/ops/MaintenanceLogger.tsx` — portal-based modal for logging completed maintenance. Posts via `fetchOps()` (auto CSRF header), refreshes asset table on success and clears overdue status.
- **Shared Module:** `_profit-report.js` — extracts `computeProfitReport(supabase, monthStr)` so both the HTTP endpoint and the cron job share identical business logic. Returns revenue, maintenance cost, operating expenses (OpEx from `property_expenses`), total expenses, net profit, ratio, and event counts. Net Profit is computed as Revenue − Maintenance − OpEx, aligning with the Employee Addendum definition: "Revenue minus all Operating Expenses (OpEx), including rent, payroll, COGS, and Equipment Maintenance Costs." Also exports `centsToDisplay(cents)` (locale-formatted via `Intl.NumberFormat`), `monthBounds(monthStr)`, `MONTH_RE`, `checkVestingEligibility(hireDateStr, asOf?)`, `VESTING_MONTHS` (6), and `PROBATION_DAYS` (90). `checkVestingEligibility` validates whether a staff member's hire date clears both the 90-day probation and 6-month vesting requirements — returns `{ eligible, reason }`. **Maintenance cost aggregation** uses the `agg_maintenance_costs(start_date, end_date)` Postgres RPC which applies `COALESCE(cost, 0)` at the SQL level — never relies on JavaScript `Number() || 0`. Falls back to a row-level fetch with `.not('cost', 'is', null)` filter if the RPC is not yet deployed.
- **Netlify Function:** `get-true-profit-report.js` — manager-only GET endpoint (`?month=YYYY-MM`, defaults to current month). Calls `computeProfitReport()` from `_profit-report.js`. Powers the "Profitability" card on the Manager Dashboard. Rate-limited via `staffBucket`, PIN session required.
- **Netlify Function:** `get-profit-share-preview.js` — manager-only GET endpoint (`?month=YYYY-MM`, defaults to current month). Reuses `computeProfitReport()`, then subtracts a $5,000 Profit Floor (`500_000` cents) and computes a 10% Staff Pool via **integer basis-point arithmetic** (`(surplusCents × 1000) / 10000` — no floating-point multiplication on money). Joins `time_logs` with `staff_directory` on `staff_id` and only counts **integer minutes** (`Math.floor`) for employees whose `hire_date` is on or before the 6-month vesting date; employees within the 90-day probation window are hard-excluded from all pool calculations. Derives a Bonus-per-Hour via **cents-per-minute path**: `Math.floor((staffPoolCents × 60) / totalEligibleMinutes)` — avoids the "fractional hour" float trap. If the bonus-per-hour is less than 1¢ or `totalEligibleMinutes` is 0, it returns $0.00 (never Infinity). Response includes `total_staff_minutes` (integer) alongside `total_staff_hours` (display-only) and `staff_pool_rate_bps` (1000) alongside `staff_pool_rate` (0.10, backward compat). Logs an ops-diagnostics info event when no staff are vested yet. Rate-limited via `staffBucket`, PIN session required. Imports `centsToDisplay` and `monthBounds` from `_profit-report.js` (no duplicate helpers).
- **Shared Utility:** `src/utils/currency-utils.ts` — exports `formatCentsToDollars(cents: number): string`. Converts integer cents to a locale-formatted US dollar string via `Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })`. Used by all frontend components that display monetary values; no division or multiplication occurs in React components.
- **Frontend Component:** `ProfitShareCard.tsx` — "Team Profit Share" card rendered on the Manager Dashboard (inside `DashboardOverhaul.tsx`). Displays a progress bar toward the $5,000 monthly Profit Floor, Staff Pool amount, total team hours, Bonus-per-Hour, and an Eligible Staff banner showing `eligible_staff_count` with pending count and a vesting-requirement tooltip ("Calculated based on 6-month vesting requirement per Addendum."). Fetches via `fetchOps("/get-profit-share-preview")`. View-only: receives pre-formatted `_display` strings from the API and uses `formatCentsToDollars()` from `currency-utils.ts` only for derived "to go" text (no raw division in JSX). Only visible to managers (OpsGate-gated).
- **Netlify Function (Scheduled):** `cron-monthly-financial-summary.js` — runs on the 1st of every month at 10:00 AM UTC. Calls `computeProfitReport()` for the previous month, queries all active managers/admins from `staff_directory`, and sends a professional HTML financial summary via Resend. If the Maintenance-to-Revenue ratio exceeds 10%, the email includes a red CTA button linking to `/manager/assets`. Failures are logged via `logSystemError()`.

### Staff Phone Migration (`20260302_add_staff_phone`)
- Adds nullable `phone TEXT` column to `staff_directory`.
- Automatically inherited by the `v_staff_status` view (uses `sd.*`).

### Notion Operations Ledger Sync (`20260304_schema86_notion_sync`)
- **New Netlify Function:** `notion-sync.js` receives POST payloads from internal webhook sources and syncs canonical DB records to Notion via API calls.
- **Strict Security Gate:** Requires both CSRF header (`X-BrewHub-Action: true`) and `INTERNAL_SYNC_SECRET` (`x-brewhub-secret`) validation before any processing.
- **Server-Side Truth Source:** Function re-fetches records from Supabase by ID (`orders`, `manager_override_log`, `customers`) and never trusts inbound payload fields for business data.
- **Routing Rules:**
  - `orders.status = 'completed'` → Notion Sales Ledger database (`NOTION_SALES_DB_ID`). Properties: **Name** (title, order ID), **Status** (select), **Total** (number, dollars).
  - `manager_override_log` inserts → Notion Audit Trail database (`NOTION_AUDIT_DB_ID`). Properties: **Name** (title, action type), **Manager** (rich_text), **Action** (select), **Target Entity** / **Target ID** / **Details** (rich_text).
- **Idempotency Table:** `processed_notion_syncs` (Schema 86) stores unique `sync_key` entries to guarantee at-most-once Notion writes.
- **DB Trigger Webhooks:**
  - `trg_manager_override_notion_sync` (`AFTER INSERT` on `manager_override_log`) — calls `net.http_post` to `/.netlify/functions/notion-sync` with signed internal headers.
  - `trg_orders_notion_sync` (`AFTER UPDATE` on `orders`, Schema 86b) — fires only on the exact `status → 'completed'` transition (`NEW.status = 'completed' AND OLD.status IS DISTINCT FROM 'completed'`). Posts `source_table: 'orders'` + `record_id` so the Netlify function re-fetches the canonical order row for the Sales Ledger. Uses the same `app.settings.*` runtime config and graceful `EXCEPTION` degradation as the manager override trigger.

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

### Agreement Signatures & Schema Health Auditing
- **`agreement_signatures` table:** Immutable audit trail for staff digital signatures on the Mutual Working Agreement. Columns: `id` (uuid PK), `staff_id` (uuid FK → staff_directory), `version_tag` (text), `ip_address` (hashed text), `user_agent` (text), `sha256_hash` (text — SHA-256 of the full agreement text at signing time), `signed_at` (timestamptz), `created_at` (timestamptz). RLS enabled, service-role only. Migration: `20260304_schema84_agreement_signatures.sql`.
- **`record_agreement_signature` RPC:** Atomic Postgres function (`SECURITY DEFINER`, `search_path = public`). Uses `pg_advisory_xact_lock` to serialise concurrent signatures for the same staff member. In a single transaction: (a) inserts into `agreement_signatures`, (b) updates `staff_directory.contract_signed` + `onboarding_complete`, (c) bumps `token_version` + `version_updated_at` to atomically invalidate all existing sessions — forcing a fresh login that picks up the new `onboarding_complete = true` status. Returns `{ signature_id, signed_at }`.
- **`_crypto-utils.js` / `src/lib/crypto-utils.ts`:** Shared canonical normalization utility (`getCanonicalAgreementText`). Converts CRLF/CR → LF, collapses multiple spaces, trims outer whitespace. Used by the backend (record-agreement-signature, get-signed-certificate) and frontend (AgreementViewer) to guarantee identical SHA-256 hashes regardless of OS or browser whitespace differences.
- **`record-agreement-signature.js`:** POST endpoint — verifies PIN via `verify_staff_pin` RPC, validates `staff_id` matches authenticated session, **canonically normalizes** the agreement text via `getCanonicalAgreementText`, computes SHA-256 hash server-side, logs original-vs-normalized length delta to ops diagnostics, then calls the atomic `record_agreement_signature` RPC. **Version pinning:** the `version_tag` stored in the DB is always the server-side constant `CURRENT_VERSION` (`'2027-Q1'`); client-supplied version_tag is logged for drift detection only. Sends manager notification email via Resend.
- **`get-signed-certificate.js`:** GET endpoint (Staff PIN required, `?staff_id=<uuid>`) — returns a Certificate of Agreement payload. Re-hydrates the agreement template for the staff member, applies canonical normalization, re-derives the SHA-256 hash, and compares it against the stored hash to verify integrity. Returns `{ staff_name, version_tag, signed_at, signature_id, stored_hash, derived_hash, integrity_ok }`. Only the employee (or a manager) can view a given certificate.
- **`get-schema-health.js`:** GET endpoint (Manager PIN required) — database schema auditor that queries `information_schema.tables` and `information_schema.columns` to verify table schemas. Checks **multiple tables**: `agreement_signatures` (full column + type verification) and `maintenance_logs` (full column + type verification; `cost` expected as `integer` for cents-based storage). Falls back to column-probing via PostgREST when `information_schema` is not exposed. Returns a structured health report with `healthy` (boolean), `missingColumns`, `typeMismatches`, `extraColumns`, `additional_tables` (array of per-table results with full `typeMismatches` arrays), `overall_healthy` (aggregate boolean), and a human-readable `message`.
- **Manager Dashboard — System Integrity Alert:** On mount, the Manager Dashboard calls `get-schema-health` via `fetchOps()`. If `healthy === false`, a red alert banner renders at the top of the dashboard showing the error message, listing missing columns with expected types, and providing a "Copy Migration SQL" button that generates the appropriate `ALTER TABLE` / `CREATE TABLE` statements to the clipboard.

### Onboarding Gate (Schema 85)
- **Migration:** `20260304_schema85_onboarding_gate.sql` — Ensures `staff_directory.contract_signed` and `staff_directory.onboarding_complete` boolean columns exist. Updates `verify_staff_pin()` RPC to return these fields (plus `token_version`) in the login response.
- **Backend:** `pin-login.js` and `pin-verify.js` now include `contract_signed` and `onboarding_complete` in the `staff` response object. OpsGate reads these from the server on every session verify.
- **Frontend (`OpsGate.tsx`):** After authentication, if `onboarding_complete === false` and the user is not an admin/manager and is not already on `/staff-hub/onboarding`, the gate redirects to `/staff-hub/onboarding`. A persistent amber banner reads: "Action Required: Please review and sign your Mutual Working Agreement to unlock shop operations."
- **`/staff-hub/onboarding` page:** Renders `AgreementViewer` (scroll-to-sign). On successful signature, calls `refreshSession()` which re-fetches the PIN session from the backend, picking up the now-true `onboarding_complete` flag. The gate then automatically unlocks and redirects to the staff landing page. If a 401 occurs mid-signing, AgreementViewer saves the signature attempt to a `recovery_vault` in `localStorage`, displays an inline re-auth modal (mini PIN form), and transparently retries the signature POST with the new session token — no page reload or data loss. Scroll-read progress is persisted to `sessionStorage` so re-mounts after refresh skip re-reading.
- **Security:** The gate uses server-provided state from `pin-verify` (not client-side flags), preventing manual URL bypass to `/pos`, `/kds`, etc.
- **Backend Auth Gate (`requireOnboarded`):** The `authorize()` function in `_auth.js` accepts a `requireOnboarded: true` option. When enabled, it fetches `onboarding_complete` from `staff_directory` and returns `403 { error: 'ONBOARDING_REQUIRED' }` if false. Applied to `collect-payment.js`, `process-inventory-adjustment.js`, and `cafe-checkout.js` (staff PIN path) — ensuring unsigned staff cannot perform financial or inventory operations even with a valid session token.
- **Agreement Version Constant (`src/lib/agreement-constants.ts`):** The `CURRENT_AGREEMENT_VERSION` (e.g. `"2027-Q1"`) is the single source of truth for the version tag. Imported by `AgreementViewer.tsx` and `onboarding/page.tsx`. The frontend sends this tag to the backend RPC, maintaining integrity of the SHA-256 hash. To release a new agreement version, bump this constant — all staff will be required to re-sign.