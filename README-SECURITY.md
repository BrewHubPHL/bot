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