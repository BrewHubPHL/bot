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