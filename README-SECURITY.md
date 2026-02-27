# 🛡️ BrewHub PHL: Security Architecture & Threat Model

This document outlines the defense-in-depth security posture of the BrewHub PHL platform.

## 1. Authentication Matrix
BrewHub uses a dual-perimeter authentication model separating customer identity from staff operations.

| Role | Auth Mechanism | Access Level |
|---|---|---|
| **Anonymous** | None | Public menu, waitlist, AI chat. |
| **Customer** | Supabase JWT | Portal, loyalty points, own parcel history. |
| **Staff** | PIN → HMAC Cookie | POS, KDS, Scanner, Inventory reads. |
| **Manager** | PIN + TOTP Challenge | Dashboard, payroll edits, comps, catalog writes. |
| **Service Role** | Netlify Env Secret | Backend webhooks, cron jobs, atomic RPCs. |

*Note: The `anon` Supabase key is public by design. All tables default to `Deny All` Row Level Security (RLS).*

## 2. Threat Model & Defenses

### A. Hardware & Kiosk Abuse
* **ESC/POS Injection:** Physical thermal printers are protected from malicious execution commands. `_receipt.js` strips all non-printable ASCII characters (`< 0x20`, excluding newlines) from user-supplied names and notes.
* **Receipt Race Conditions:** `get-receipts.js` uses atomic DB locks (`SELECT ... FOR UPDATE SKIP LOCKED`) to ensure concurrent iPads never print duplicate tickets.
* **PII Scraping:** The `receipt_queue` is locked to `authenticated` staff only.

### B. AI & Chatbot Liability
* **Prompt Injection (Allergens):** An impenetrable pre-LLM and pre-Database regex block intercepts medical/allergen terms (e.g., "peanut allergy", "celiac"). It immediately aborts the tool execution and returns a canned safety disclaimer, preventing the AI from hallucinating dietary guarantees.
* **Denial of Wallet (DoW):** Expensive APIs (ElevenLabs, Claude) are shielded by a dual-layer rate limit: an in-memory IP Token Bucket (`_token-bucket.js`) for burst protection, and a persistent DB daily quota (`_usage.js`) to hard-cap daily spend.

### C. Financial & Point-of-Sale
* **Square Webhook Idempotency:** Webhooks write to a `processed_webhooks` table before executing logic. Duplicate events (via network retries) hit a Postgres Unique Constraint and gracefully exit.
* **Phantom Orders / Offline Mode:** If a Square Terminal loses internet, transactions are queued locally. A strict "Cash-Only Offline Cap" (default $200) prevents catastrophic batch-decline losses. An automated `reconcile-pending-payments` cron catches straggler payments if webhooks drop.

### D. Compliance & Data Integrity
* **IRS-Compliant Payroll:** `time_logs` are immutable. `atomic_payroll_adjustment()` only inserts new delta rows linked to a manager's UUID and a required reason.
* **TCPA SMS Compliance:** All SMS messages pass through `_sms.js`, which atomically checks `sms_opt_out` and enforces Quiet Hours (9 PM - 9 AM ET) before dispatching to Twilio.
* **GDPR Right to Erasure:** A `deletion_tombstones` table prevents "zombie data" from being resurrected by external Google Sheets syncs.

## 3. Network & Transport
* **CSRF:** All mutating Netlify functions require the `X-BrewHub-Action: true` header.
* **CORS:** Strict origin allowlisting (`process.env.SITE_URL`, `brewhubphl.com`).
* **IP Gating:** Staff clock-in and POS operations enforce an `ALLOWED_IPS` check to guarantee staff are physically on the shop's Wi-Fi network.