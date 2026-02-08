🛡️ BrewHub PHL: Security & Integrity Manifest
This document outlines the defense-in-depth architecture implemented to protect financial data, resident PII, and system integrity.

1. Authentication & Session Management
We utilize a Hybrid Auth Perimeter to ensure that "Fired is Fired" and sessions cannot be hijacked.

The Guard: _auth.js validates Supabase JWTs against a database-backed staff_directory.

Token Versioning: Each staff member has a token_version in the DB. If an account is compromised or an employee is removed, incrementing this version instantly invalidates all active JWTs globally.

Fail-Closed Logic: If the staff_directory is unreachable or a user's email is missing, all protected paths return a 401 Unauthorized by default.

2. Transactional Integrity (The "Anti-Glitch" Layer)
To prevent "Infinite Coffee" loops via refund cycling or concurrent voucher redemptions, we use Distributed Mutual Exclusion.

Advisory Locking Logic
For high-sensitivity operations (Refunds, Point Redemptions, Inventory Adjustments), we utilize Postgres Advisory Locks.

Mechanism: pg_try_advisory_xact_lock(hashtext(customer_id::text))

Why: This prevents two serverless functions from modifying the same customer's points at the exact same millisecond. If a refund and a redemption collide, one will wait for the other, ensuring the point balance is always accurate.

3. Data Privacy & GDPR Compliance
We follow the Tombstone Pattern for all data deletion requests to prevent "Zombie Data" from re-syncing from third-party tools like Google Sheets.

Tombstones: A permanent record of the absence of a user is stored in deletion_tombstones.

Financial Anonymization: We do not delete orders (needed for taxes). Instead, we strip all PII (Name, Email, Phone) and replace it with GDPR_REDACTED.

Sync Direction: The marketing sync is strictly One-Way (Push). The Google Sheet is a consumer of data, never an authoritative source.

4. Webhook Security
All external triggers (Square, Apify, Supabase) are validated via HMAC Signatures.

Idempotency Ledger: Every webhook event ID is recorded in processed_webhooks. If Square retries a webhook due to a network hiccup, our system sees the record and skips processing to prevent double-crediting points.

Opaque Errors: Internal system errors are logged privately to the Netlify console. The public response is always a generic 500 Server Error to prevent schema-probing.

5. Deployment Checklist (The "Pre-Flight")
Before any production deployment, verify:

Secret Masking: Environment variables in Netlify are flagged as "Secret" to prevent log leakage.

RLS Check: Run the security_audit SQL script to ensure no table has public select access.

TTL: Netlify function timeouts are set to the minimum required (max 10s) to limit DoS surface area.