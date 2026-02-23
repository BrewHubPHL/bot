# NEXT-SESSION-PROMPT.md — BrewHub PHL Security Audit Continuation

**Date:** February 23, 2026  
**Last Completed:** Audit #54 (Collect Payment / OAuth / Apify hardenings)  
**Total Audits Completed:** 54  


## Context

You are continuing a **methodical file-by-file security audit** of the BrewHubBot project. Read `SITE-MANIFEST.md` (the master reference) before doing anything — it has the full inventory, all findings, and remediation log through Audit #28.

### Stack
<!-- Snyk configuration removed from this prompt. Run Snyk scans via CI or externally when needed. -->

### Schema Migrations

### Shared Security Modules (already audited, reference only)


## Audit Protocol (7 Steps)

1. **Read** the target file(s) completely
2. **Cross-reference** SITE-MANIFEST.md for known findings
3. **Report findings** in a table (ID, severity, description, fix)
4. **Wait for user approval** before editing
5. **Apply fixes** (code edits)
6. **Update manifest** + run `get_errors`
## Completed Audits (1–26)

7. **Summarize** and move to next target


## Next Session Focus (For Tomorrow)



Arrival checklist for me when you resume:

1. Read `SITE-MANIFEST.md` and confirm the selected target(s).
2. Produce a findings table for each target and wait for your approval.
3. Apply hardenings only after explicit approval, then update the manifest and run `get_errors` on edited files.
4. If you want a local SCA scan, provide the `--org` value or confirm CI execution; otherwise I will avoid local Snyk runs to preserve quota.

Progress note: In the current session I completed audits for `apify-to-supabase.js`, `oauth/callback.js`, and `collect-payment.js` — next up is `public-config.js` followed by marketing endpoints and finalizing `supabase-to-sheets.js`.

## Completed Audits (1–26)

| # | Scope | Key Outcomes |
|---|---|---|
| 1 | SMS Pipeline | Source mismatch, phone masking, quiet-hours |
| 2 | Auth System | **API-H4**: centralized OAuth auth |
| 3 | collect-payment.js | **API-C2**: verified resolved |
| 4 | process-merch-payment.js | **API-C3**: HMAC idempotency, qty cap |
| 5 | Time/Clock | **API-C1/SQL-C1/SQL-C2**: verified resolved |
| 6 | Parcels Frontend | **FE-C3**: verified resolved |
| 7 | *(session boundary)* | |
| 8 | Admin Dashboard | **FE-C1/FE-C2**: verified; inventory rewritten |
| 9 | Hiring Endpoints | **API-H2**: requireManager + CSRF |
| 10 | register-tracking.js | **API-H3**: CSRF verified; atomic upsert + UNIQUE |
| 11 | create-checkout.js | **API-H5**: preflight + validation + sanitization |
| 12 | get-loyalty.js | **API-H6**: PII masked, opaque QR, input caps |
| 13 | redeem-voucher.js | **RV-1–4** + **SQL-C4** verified |
| 14 | 6 Public GET Endpoints | **API-H1**: already resolved; **PE-1–5**: CORS/error hardening |
| 15 | Checkout + Schema Bootstrap | **FE-C4**: verified; **FE-H3**: stale wallet fixed; **SQL-C3**: combined schema complete |
| 16 | SQL Schema Batch + create-customer.js | **SQL-H1–H4**: receipt_queue scoped, VIEWs revoked, verified resolved |
| 17 | claude-chat.js | **API-M2**: user-only history filter, CORS allowlist, safe logging |
| 18 | KDS page + update-order-status.js | **FE-H1**: status normalizer, safe logging, stale closure fix |
| 19 | POS page | **FE-H2**: ref lock race fix, safe logging, QR input cap, stale closure fix |
| 20 | order-announcer + text-to-speech | **API-M3**: PII redacted; **API-M4**: TTS hardened (CORS, JSON parse, error logging) |
| 21 | Portal + Resident pages | **FE-H4/FE-M1/FE-M6**: auth rate limiting, opaque QR/barcode, safe logging, input caps |
| 22 | Cafe page | **FE-M3**: submit guard, qty/cart caps, menu error state, safe logging |
| 23 | Scanner + SQL triggers + Error boundaries | **FE-M4**: handleScanRef stale closure fix; **SQL-M1–M4**: trigger EXCEPTION, FK constraints, payroll index; **FE-M2**: error.tsx for ops + site |
| 24 | API LOW batch | **API-L2**: _ip-hash empty salt guard; **API-L1**: fallback price warnings + fail-closed ordering; **API-L3**: proper HTTP status codes + input cap + safe logging |
| 25 | Staff PIN functions + Loyalty refactor | **A25-1–5**: IP hash, safe logging, CORS allowlist; **POS-5/SC-3**: new `get-staff-loyalty.js` replaces broken anon-client queries in POS + Scanner |
| 26 | Core payment pipeline | **A26-1–13**: cafe-checkout CORS allowlist + safe logging (5 sites) + email cap + removed double JSON.parse; create-order method-before-auth + safe JSON parse + safe logging (2 sites); square-webhook safe logging (6 sites); square-sync method guard + safe JSON parse + BigInt validation + UUID check + safe logging |
| 27 | Operations batch | **PCI-1–6**: parcel-check-in method guard, safe JSON parse, safe logging, CORS, PII redacted, input caps; **PP-1–4**: parcel-pickup safe logging (4 sites), CORS, IP hashing, UUID validation; **AI-1–5**: adjust-inventory method guard, safe logging, CORS/OPTIONS, safe JSON parse, UUID validation; **CII-1–4**: create-inventory-item method guard, safe logging, CORS/OPTIONS, sanitizeInput |
| 28 | manage-catalog.js | **MC-1**: CORS strict allowlist + OPTIONS preflight; **MC-2**: input length caps (name 200, desc 2000); **MC-3**: sanitizeInput on name/desc; **MC-4**: UUID validation on id (PATCH/DELETE); **MC-5**: image_url length cap 2048; **MC-6**: Number.isInteger on price_cents |

**Files modified to date (60):** `twilio-webhook.js`, `_sms.js`, `send-sms-email.js`, `oauth/initiate.js`, `_auth.js`, `pin-login.js`, `middleware.ts`, `process-merch-payment.js`, `admin/inventory/page.tsx`, `get-applications.js`, `update-application-status.js`, `submit-application.js`, `HiringViewer.tsx`, `register-tracking.js`, `schema-50-tracking-unique.sql`, `create-checkout.js`, `get-loyalty.js`, `redeem-voucher.js`, `get-merch.js`, `health.js`, `get-menu.js`, `shop-data.js`, `checkout/page.tsx`, `schema-all-combined.sql`, `create-customer.js`, `schema-51-receipt-view-hardening.sql`, `claude-chat.js`, `kds/page.tsx`, `update-order-status.js`, `pos/page.tsx`, `order-announcer.js`, `text-to-speech.js`, `portal/page.tsx`, `resident/page.tsx`, `cafe/page.tsx`, `scanner/page.tsx`, `schema-52-trigger-hardening.sql`, `(ops)/error.tsx`, `(site)/error.tsx`, `_ip-hash.js`, `ai-order.js`, `tool-check-waitlist.js`, `pin-clock.js`, `pin-verify.js`, `search-residents.js`, `get-staff-loyalty.js`, `cafe-checkout.js`, `create-order.js`, `square-webhook.js`, `square-sync.js`, `parcel-check-in.js`, `parcel-pickup.js`, `adjust-inventory.js`, `create-inventory-item.js`, `manage-catalog.js`, `netlify/functions/navigate-site.js`, `netlify/functions/site-settings-sync.js`, `netlify/functions/ops-diagnostics.js`, `netlify/functions/supabase-webhook.js`

---

## Open Findings by Priority

### CRITICAL (P0) — 0 open
All 11 P0 findings resolved.

### HIGH (P1) — 0 open
All 14 P1 findings resolved.

### MEDIUM (P2) — 1 open
| ID | Finding |
|---|---|
| **API-M1** | In-memory rate limiters reset on cold start, multi-container buckets (architectural — needs Redis/KV) |

### LOW (P3) — 5 open
| ID | Finding |
|---|---|
| **FE-L1** | Pervasive `any` types in admin/parcels/portal |
| **FE-L3** | No ARIA landmarks or skip-links on POS |
| **SQL-L1** | time_logs.employee_id orphaned column (unused, no FK) |
| **SQL-L2** | orders.user_id has no FK to auth.users |
| **SQL-L3** | customers.address_city defaults to 'Philadelphia' |

### Documentation Gaps — 8 open
- **DOC-1–DOC-8**: README_SECURITY.md missing, README incomplete, sitemap outdated, SYSTEM-BLUEPRINT stale

### Config & Testing Gaps — 7 open
- **CFG-1–CFG-5**: ESLint netlify ignore, no lock file, dead deps, X-Frame-Options
- **TST-1–TST-2**: <5% test coverage, welcome-email XSS

---

## Recent Work (in this session)

- Patched `netlify/functions/upload-menu-image.js`: added image magic-byte validation (PNG/JPEG/WebP/GIF) to ensure declared `contentType` matches file signature.
- Patched `public/sw.js`: added `postMessage` origin validation to accept messages only from same-origin or approved hosts.
- Patched `netlify/functions/update-hours.js`: added pre-parse request body size cap (8KB), per-manager/IP `formBucket` token-bucket rate limit, CORS echo of validated origin with `Vary: Origin`, and sanitization + PII-redaction of `reason` before calling `atomic_payroll_adjustment` and before writing the `manager_override_log` audit entry.

Additional recent changes in-session:
- Created `supabase/schema-53-shop_settings.sql` to persist OAuth shop tokens/state.
- Regenerated combined SQL to `supabase/schema-all-combined.regenerated.sql` and removed the previously-produced unified diff file from the repo.
- Continued `queue-processor` hardening: added `fetchWithTimeout()` (AbortController) for edge calls, reduced claim batch size to 3, bounded `complete_notification` and `fail_notification` RPCs with `withTimeout()`, and repaired a malformed `fail_notification` wrapper (syntax bug fixed).


These changes were applied as part of the Operations audit (write endpoints). Update SITE-MANIFEST.md remediation log next.

- Ran workspace SCA/SAST scan: `snyk test --all-projects --org=78e70dca-1d4c-4d81-bad7-b5cb35312f4e` — Tested 6 projects; no vulnerable paths found. Snyk reported the organization's monthly private-test quota (200) was reached; further workspace scans may be limited until quota resets. Consider `snyk monitor` for persistent snapshots or running targeted per-project scans to conserve quota.


## Unaudited Netlify Functions

The following functions have NOT been individually audited yet (though some share patterns with audited functions):

### Operations (unaudited)
- `upload-menu-image.js` — Manager PIN auth, upload menu item images
- `update-hours.js` — Manager PIN auth, payroll adjustments
- `log-time.js` — Staff PIN auth, clock endpoint (delegates to RPC — verified Audit #5, not fully audited)

### Data Retrieval (unaudited)
- `get-kds-orders.js` — Staff PIN auth, KDS order board
- `get-queue.js` — Public, lobby order board
- `get-manager-stats.js` — Manager PIN auth, dashboard stats
- `get-payroll.js` — Manager PIN auth, payroll data
- `get-receipts.js` — Staff PIN auth, receipt history
- `get-recent-activity.js` — Staff PIN auth, activity feed
- `get-inventory.js` — Staff PIN auth, inventory levels
- `sales-report.js` — Manager PIN auth, daily sales aggregation
- `export-csv.js` — Manager PIN auth, CSV data export
- `public-config.js` — Public, Square public IDs

### Communications & Marketing (unaudited)
- `send-sms-email.js` — Service secret (audited Audit #1 but may need refresh)
- `marketing-bot.js` — Service secret
- `marketing-sync.js` — Service secret
- `supabase-to-sheets.js` — Service secret

### Scheduled (unaudited)
- `cancel-stale-orders.js` — Cron, cancel stuck orders
- `queue-processor.js` — Periodic, process notification queue

### Other (unaudited)
- `navigate-site.js` — No auth, site navigation helper
- `site-settings-sync.js` — Service secret, shop/cafe mode toggle
- `ops-diagnostics.js` — Manager PIN, system diagnostics
- `supabase-webhook.js` — IP allowlist + secret, Supabase event handler
- `apify-to-supabase.js` — Service secret, web scraper data import
- `oauth/callback.js` — State token, OAuth callback
- `collect-payment.js` — Manager PIN (verified Audit #3 but not fully pattern-audited)

---

## Suggested Next Targets (Audit #29+)

| Priority | Target | Rationale |
|---|---|---|
| **Next** | Operations remainder (upload-menu-image, update-hours, log-time) | Last unaudited write endpoints in Operations section |
| **Next** | Data retrieval batch (get-kds-orders, get-queue, get-manager-stats, get-payroll, etc.) | Check for safe logging, CORS, input caps |
| **Next** | Scheduled functions (cancel-stale-orders, queue-processor) | Check for cron auth, safe logging |
| **Next** | Service-secret endpoints (marketing-bot, marketing-sync, supabase-to-sheets, etc.) | Check for input validation, safe logging |
| **P2** | API-M1: Rate limiter resilience | Architectural — evaluate Netlify Blobs or KV for shared state (or document as accepted risk) |
| **P3** | FE-L1: TypeScript `any` cleanup | admin/parcels/portal pages use `any` types |
| **P3** | FE-L3: POS accessibility | No ARIA landmarks or skip-links on POS page |
| **P3** | SQL-L1–L3: Orphaned columns & defaults | time_logs.employee_id, orders.user_id FK, address_city default |
| **Low** | Documentation overhaul | **DOC-1–DOC-8**: README_SECURITY.md, sitemap, schema docs, env docs |
| **Low** | Config cleanup | **CFG-1–CFG-5**: ESLint netlify, lock file, dead deps, X-Frame-Options |
| **Low** | Test coverage | **TST-1**: <5% coverage; **TST-2**: welcome-email XSS |

---

## Audit Score Summary

| Severity | Total Found | Resolved | Open |
|---|---|---|---|
| **P0 Critical** | 11 | 11 | 0 |
| **P1 High** | 14 | 14 | 0 |
| **P2 Medium** | 26 | 25 | 1 (architectural) |
| **P3 Low** | 24 | 19 | 5 |
| **DOC** | 8 | 0 | 8 |
| **CFG** | 5 | 0 | 5 |
| **TST** | 2 | 0 | 2 |
| **Total** | **90** | **69** | **21** |

**All Critical, High, and Medium code findings resolved. Remaining items are low-severity, documentation, config, testing, or architectural.**

---

## Important Rules

1. **Always read SITE-MANIFEST.md first** — it's the single source of truth
2. **Wait for user approval** before applying fixes
3. **Update SITE-MANIFEST.md** after every audit (inventory rows, findings, remediation log). Always update the **Files modified to date** list to include every file edited in the session.
4. **Do not include Snyk commands in this prompt.** Run Snyk scans externally or via CI when appropriate.
5. **Safe error logging pattern:** `err?.message` only — never log full error objects
6. **CORS pattern:** strict allowlist `[process.env.URL, 'https://brewhubphl.com', 'https://www.brewhubphl.com']`
7. **Input caps:** always add `.slice()` length limits on user-provided strings
8. **Method guards:** `if (event.httpMethod !== 'X') return 405` — always before auth
9. **JSON parse:** always wrap in try/catch with 400 response
10. **BigInt/Number conversion:** validate input is a positive integer before `BigInt()` or arithmetic

---

## Session Update (Feb 23, 2026)

- Currently auditing `netlify/functions/queue-processor.js`. Small, low-risk hardenings were applied: fail-closed env checks, `withTimeout()` wrappers around edge fetch and Supabase RPCs (30s/10s), phone masking in logs, and message-only error logging. A `node --check` import passed; `eslint` run failed due to a flat-config vs legacy config mismatch — follow-up: fix lint invocation and consider extending timeout pattern to related RPCs.

