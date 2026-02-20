🛡️ BrewHub PHL: Security & Integrity Manifest
This document outlines the defense-in-depth architecture implemented to protect financial data, resident PII, and system integrity.

*Last updated: 2026-02-20*

1. Authentication & Session Management
We utilize a Hybrid Auth Perimeter to ensure that "Fired is Fired" and sessions cannot be hijacked.

The Guard: _auth.js validates Supabase JWTs against a database-backed staff_directory.

Token Versioning: Each staff member has a token_version in the DB. If an account is compromised or an employee is removed, incrementing this version instantly invalidates all active JWTs globally.

Fail-Closed Logic: If the staff_directory is unreachable or a user's email is missing, all protected paths return a 401 Unauthorized by default.

2. PIN Brute-Force Protection (DB-Backed)
pin-login.js uses a dual-layer rate limit to prevent PIN brute-force attacks:

In-Memory (Fast Path): An in-memory Map provides sub-millisecond rejection for repeated attempts from the same IP within a single Lambda instance.

DB-Backed (Persistent): The `pin_attempts` table (keyed by client IP) persists lockout state across cold starts and Lambda instances.

RPCs (SECURITY DEFINER, revoked from anon/authenticated):
- `record_pin_failure(ip, max_attempts, lockout_seconds)` — Atomic upsert: increments fail count, resets window if expired, sets locked_until when threshold reached.
- `check_pin_lockout(ip)` — Fast pre-check returning {locked, retry_after_seconds}.
- `clear_pin_lockout(ip)` — Deletes row on successful login.

Default policy: 5 failed attempts → 60-second lockout. Fail-open: if DB check fails, falls back to in-memory only (availability over security at the rate-limit layer).

3. Transactional Integrity (The "Anti-Glitch" Layer)
To prevent "Infinite Coffee" loops via refund cycling or concurrent voucher redemptions, we use Distributed Mutual Exclusion.

Advisory Locking Logic
For high-sensitivity operations (Refunds, Point Redemptions, Inventory Adjustments), we utilize Postgres Advisory Locks.

Mechanism: pg_try_advisory_xact_lock(hashtext(customer_id::text))

Why: This prevents two serverless functions from modifying the same customer's points at the exact same millisecond. If a refund and a redemption collide, one will wait for the other, ensuring the point balance is always accurate.

4. Payment Loop Hardening
The Square webhook handler (square-webhook.js) implements multiple layers of payment safety:

Idempotency Lock: Every webhook event ID is recorded in `processed_webhooks` (unique constraint). Duplicate delivery → skip.

Self-Heal Guard: The order update uses `.neq('status', 'paid')` so a crash between idempotency insert and order update can be safely retried by clearing the idempotency record.

Amount Tolerance: Paid amount validated against order total with 2¢ flat tolerance. Mismatches beyond tolerance are flagged but still processed (logged for review).

Paid Amount Persistence: `paid_amount_cents` stored on the order row — prevents double-credit on webhook retry.

Stale Order Cleanup: `cancel-stale-orders.js` (scheduled @every 5m) cancels orders stuck in pending/unpaid for >30 minutes via `cancel_stale_orders` RPC.

5. Row Level Security (RLS)
Strategy: Deny-all by default, scoped SELECT for authenticated staff.

Default: All tables have `FOR ALL USING (false)` — blocks all access from anon/authenticated roles.

Staff SELECT Policies (schema-11): Authenticated users whose email exists in `staff_directory` can SELECT from: `orders`, `coffee_orders`, `staff_directory`, `time_logs`, `receipt_queue`. Each policy uses:
  EXISTS (SELECT 1 FROM staff_directory WHERE lower(email) = lower(auth.email()))

Service Role: Backend Netlify functions use the service role key for all INSERT/UPDATE/DELETE operations, bypassing RLS entirely.

Customer Access: Supabase Auth scopes customers to their own profile, parcels, and vouchers.

Merch Products (schema-24/28): Manager-only INSERT/UPDATE policies on `merch_products` enforce `price_cents > 0` in WITH CHECK as defense-in-depth alongside the column CHECK constraint.

Storage Policies (schema-23/28): Staff upload/update/delete on `menu-images` bucket uses case-insensitive email matching (`lower(email) = lower(auth.email())`) against `staff_directory` to handle mixed-case signups.

brew_nnn_summary: This is a VIEW, so RLS cannot be applied. Secured with `REVOKE SELECT FROM anon, authenticated` (belt-and-suspenders).

6. Data Privacy & GDPR Compliance
We follow the Tombstone Pattern for all data deletion requests to prevent "Zombie Data" from re-syncing from third-party tools like Google Sheets.

Tombstones: A permanent record of the absence of a user is stored in deletion_tombstones. The `is_tombstoned()` function uses case-insensitive matching on both `table_name` and `record_key` to prevent bypass via casing differences.

Financial Anonymization: We do not delete orders (needed for taxes). Instead, we strip all PII (Name, Email, Phone) and replace it with GDPR_REDACTED.

Sync Direction: The marketing sync is strictly One-Way (Push). The Google Sheet is a consumer of data, never an authoritative source.

7. Webhook Security
All external triggers (Square, Apify, Supabase) are validated via HMAC Signatures.

Idempotency Ledger: Every webhook event ID is recorded in processed_webhooks. If Square retries a webhook due to a network hiccup, our system sees the record and skips processing to prevent double-crediting points.

Opaque Errors: Internal system errors are logged privately to the Netlify console. The public response is always a generic 500 Server Error to prevent schema-probing.

8. Deployment Checklist (The "Pre-Flight")
Before any production deployment, verify:

Secret Masking: Environment variables in Netlify are flagged as "Secret" to prevent log leakage.

RLS Check: Run the security_audit SQL script to ensure no table has public select access.

TTL: Netlify function timeouts are set to the minimum required (max 10s) to limit DoS surface area.

Schema Migrations: Apply schema-1 through schema-28 in order. Each is idempotent (IF NOT EXISTS / DROP IF EXISTS).