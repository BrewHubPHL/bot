# 🛡️ BrewHub PHL: Security Architecture & Threat Model

This document outlines the defense-in-depth security posture of the BrewHub PHL platform.

## 1. Authentication Matrix
BrewHub uses a dual-perimeter authentication model separating customer identity from staff operations.

| Role | Auth Method | Access |
|---|---|---|
| **Anonymous** | None | Public menu, waitlist, AI chat. |
| **Customer** | Supabase JWT | Portal, loyalty points, own parcel history. |
| **Staff** | PIN → HMAC Cookie, WebAuthn/Passkeys | POS, KDS, Scanner, Inventory reads. |
| **Manager** | PIN + TOTP Challenge | Dashboard, payroll edits, comps, catalog writes. |
| **Service Role** | Netlify Env Secret | Backend webhooks, cron jobs, atomic RPCs. |

*Note: The `anon` Supabase key is public by design. All tables default to `Deny All` Row Level Security (RLS).*

---

## 2. Threat Model & Defenses

### A. Hardware & Kiosk Abuse
* **ESC/POS Injection:** Physical thermal printers are protected from malicious execution commands. `_receipt.js` strips all non-printable ASCII characters (`< 0x20`, excluding newlines) from user-supplied names and notes.
* **Receipt Race Conditions:** `get-receipts.js` uses atomic DB locks (`SELECT ... FOR UPDATE SKIP LOCKED`) to ensure concurrent iPads never print duplicate tickets.

### B. AI & Chatbot Liability
* **Prompt Injection (Allergens):** An impenetrable pre-LLM and pre-Database regex block intercepts medical/allergen terms. It immediately aborts the tool execution and returns a canned safety disclaimer.
* **Denial of Wallet (DoW):** Expensive APIs (ElevenLabs, Claude) are shielded by a dual-layer rate limit: an in-memory IP Token Bucket (`_token-bucket.js`) for burst protection, and a persistent DB daily quota.
* **Parcel Privacy (Physical Security Model):** The chatbot `check_parcels` tool does not require authentication — packages are physically secured behind mailbox keys / ButterflyMX credentials. The tool returns only carrier and arrival time; tracking numbers, sender details, recipient names, and unit numbers are never exposed to the LLM. The system prompt instructs the bot to remind users they need physical credentials to access their mailbox.

### C. Financial & Point-of-Sale
* **Square Webhook Idempotency:** Webhooks write to a `processed_webhooks` table before executing logic. Duplicate events hit a Postgres Unique Constraint and gracefully exit.
* **Phantom Orders / Offline Mode:** Cash-only offline limits prevent catastrophic batch-decline losses.

### D. Compliance & Data Integrity
* **IRS-Compliant Payroll:** `time_logs` are immutable. `atomic_payroll_adjustment()` only inserts new delta rows linked to a manager's UUID and a required reason.
* **GDPR Right to Erasure:** A `deletion_tombstones` table prevents "zombie data" from being resurrected by external Google Sheets syncs.
* **Staff Agreement Signatures:** The `agreement_signatures` table provides an immutable cryptographic audit trail. Each row records a SHA-256 hash of the agreement text at signing time, the hashed IP address (via `hashIP()`), truncated user agent, and a timestamped version tag. The `get-schema-health.js` function allows managers to verify schema integrity on-demand.
* **Backend Onboarding Gate:** `_auth.js` supports `requireOnboarded: true` — blocks staff with `onboarding_complete = false` from calling sensitive endpoints (`collect-payment`, `process-inventory-adjustment`, `cafe-checkout`) with `403 ONBOARDING_REQUIRED`. Enforced on both PIN-session and JWT auth paths.
* **POS Fail-Closed Gate:** `cafe-checkout.js` enforces a dual fail-closed check: (1) payment methods `cash`, `terminal`, and `comp` require `authMode === 'staff'` — customers and guests receive an immediate 403; (2) even authenticated staff must have `onboarding_complete === true` (defense-in-depth, independent of the `_auth.js` gate). This prevents any regression in the auth layer from opening POS financial operations to un-onboarded personnel.
* **Atomic Session Rotation on Signature:** The `record_agreement_signature` RPC atomically bumps `token_version` when an agreement is signed, invalidating all existing sessions and forcing a fresh login that picks up the new `onboarding_complete = true` status.
* **Agreement Version Governance:** The agreement `version_tag` is now pinned server-side via a constant (`CURRENT_VERSION = '2027-Q1'`) in `record-agreement-signature.js`. The frontend-supplied `version_tag` is logged for drift detection but never used in the DB write. This eliminates a class of client-side version spoofing attacks where a tampered frontend could stamp an incorrect version into the immutable audit trail.

### E. Stateless JWT Revocation ("Ghost Admin")
* **Vulnerability:** Stateless JWTs historically remained mathematically valid until expiration even after a staff member was fired and their database row removed.
* **Solution:** An O(1) integer token versioning system implemented in `_auth.js`.
* **Mechanism:** When a session is minted, the database's `token_version` is embedded into the payload. On each request, the middleware compares `payload.token_version !== staff.token_version`. If a manager hits the "Deactivate Staff" button, the DB integer instantly increments, atomically bricking the revoked tokens globally without requiring intensive database scans.

## 3. Network & Transport
* **CSRF:** All mutating Netlify functions require the `X-BrewHub-Action: true` header.
* **Transport:** All authenticated operational calls are routed through the central `fetchOps()` wrapper to rigidly enforce `credentials: "include"`.
* **CORS:** Strict origin allowlisting (`process.env.SITE_URL`, `brewhubphl.com`).
* **IP Gating:** Staff clock-in operations enforce an `ALLOWED_IPS` check to guarantee staff are physically on the shop's Wi-Fi network.

---

## 4. March 2026 Security Hardening

### A. Supabase Error Handling Compliance Sweep
* **Scope:** 25+ Netlify functions audited and patched. Supabase JS does not throw on query failures — many functions previously used bare `await` or relied solely on `try/catch`, silently swallowing DB errors.
* **Fix:** Every Supabase call now destructures `{ data, error }` and explicitly checks `if (error)`. All catch paths call `logSystemError()` for persistent tracking.
* **Impact:** Eliminates an entire class of silent-failure vulnerabilities where database errors (permission denied, constraint violations, RLS denials) were invisible to monitoring.

### B. PostgREST Filter Injection Prevention
* **Vulnerability:** The `claude-chat.js` chatbot used `.or()` filter composition with user-supplied input, which could allow PostgREST filter injection (manipulating query logic via crafted strings).
* **Fix:** Replaced `.or()` with separate parameterized queries. Input sanitized: LIKE wildcards (`%`, `_`) stripped, 2-char minimum enforced for name searches.

### C. Square Webhook Refund Lock Safety
* **Vulnerability:** If refund processing threw an exception, the Postgres advisory lock was never released — permanently locking the order and blocking all future operations on it.
* **Fix:** Lock release moved to a `finally` block, guaranteeing cleanup regardless of processing outcome.

### D. Queue Processor Failure Isolation
* **Before:** Sequential loop — one failed notification blocked the entire batch.
* **After:** `Promise.allSettled()` concurrent pipeline with per-task success/failure tracking. Failed tasks are recorded via `fail_notification` RPC for automatic retry; successful tasks proceed independently.

### E. Payment & Receipt Safety
* **`.single()` → `.maybeSingle()`:** Receipt lookups and payment reuse checks no longer throw on zero results (e.g., when a receipt hasn't been generated yet).
* **Rollback error capture:** Compensation operations (`orders.delete`, `coffee_orders.delete`) now log Supabase errors instead of silently discarding them.

### F. Double-Tap Prevention (POS)
* **`payingRef` lock:** Prevents concurrent Square Terminal payment calls from the POS if a barista double-taps the Pay button.
* **`clockLockRef` lock:** Prevents concurrent clock-in/out calls from the Staff Hub.

### G. SECURITY DEFINER View Audit (Lint 0010)
* **Scope:** Supabase linter flagged 5 views with `SECURITY DEFINER`: `v_items_to_pickup`, `staff_directory_safe`, `v_staff_status`, `v_attendance_report`, `parcel_departure_board`.
* **Fixed (→ SECURITY INVOKER):**
  - `staff_directory_safe` — only consumed by `manage-schedule.js` via service_role (bypasses RLS regardless).
  - `v_attendance_report` — zero active consumers in any application code.
* **Intentionally Retained (SECURITY DEFINER):**
  - `v_items_to_pickup` — provides masked data (first initial, last-4 tracking) to the anon browser client. Switching to INVOKER would require granting `anon` SELECT on `orders`, `parcels`, `outbound_parcels`, exposing full PII.
  - `v_staff_status` — hides `pin_hash` and raw `time_logs` from browser clients while computing `is_working`.
  - `parcel_departure_board` — public departure board with masked names, last-4 tracking, and jittered timestamps. Prevents anon from reading raw parcel tables.
* **Hardening:** All 3 retained views have grants restricted to SELECT-only via explicit `REVOKE ALL` + `GRANT SELECT`.
* **Migration:** `20260304_schema80_security_definer_audit.sql`

### H. Function Search Path Pinning (Lint 0011)
* **Scope:** 68+ functions in the `public` schema had mutable `search_path`, allowing potential schema-confusion attacks.
* **Fix:** Dynamic `DO` block iterates `pg_proc` and sets `search_path = 'public'` on every public-schema function that doesn't already have it pinned. Idempotent and future-proof.
* **Migration:** `20260304_schema81_function_searchpath_audit.sql`

### I. Extension Schema Hygiene (Lint 0014)
* **Issue:** `btree_gist` installed in `public` schema (used by `scheduled_shifts.no_overlapping_shifts` exclusion constraint).
* **Fix:** `ALTER EXTENSION btree_gist SET SCHEMA extensions` — atomic move to Supabase-conventional `extensions` schema.

### J. Overly-Permissive INSERT RLS Policies (Lint 0024)
* **Scope:** 4 policies with `WITH CHECK (true)` on INSERT operations.
* **Fixes:**
  - `coffee_orders` "Staff can add items to orders" → `WITH CHECK (is_brewhub_staff())` — only staff can insert.
  - `orders` "Staff can create orders" → `WITH CHECK (is_brewhub_staff())` — only staff can insert.
  - `customers` "customers_insert" → scoped: authenticated must match `auth.uid()`; anon requires non-null email.
  - `waitlist` "allow_public_inserts" → requires non-empty name + valid email format.

### K. Leaked Password Protection
* **Status:** Dashboard-only setting. Enable in Supabase Dashboard → Authentication → Settings → Password Security → "Leaked password protection" toggle. Not configurable via SQL.

### L. Schema Integrity Auditing (`get-schema-health.js`)
* **Purpose:** Automated database schema auditor for the `agreement_signatures` and `maintenance_logs` tables. Detects missing columns, type mismatches, and extra columns by querying `information_schema.tables` and `information_schema.columns`.
* **Auth:** Manager PIN session required. Rate-limited via `staffBucket`. CORS-locked to `SITE_URL`.
* **Full Type Comparison:** All tables in `TABLES_TO_CHECK` (including `maintenance_logs`) now receive full `information_schema`-based type comparison when available — not just column existence probes. The `maintenance_logs.cost` column is expected to be `integer` (cents), enabling the M-3 Migration Builder to detect type mismatches (e.g. `numeric` → `integer` migration needed).
* **Fallback:** When `information_schema` is not exposed via PostgREST, the function falls back to individual column probes (selecting each expected column with `LIMIT 0`) to determine presence without exposing raw metadata.
* **Frontend integration:** The Manager Dashboard calls this on mount and renders a red System Integrity Alert banner when `healthy === false`, including a "Copy Migration SQL" button that generates the required DDL statements.