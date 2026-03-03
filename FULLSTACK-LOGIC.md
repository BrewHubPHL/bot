# BrewHub PHL — Full-Stack Logic Audit Log

This document tracks resolved issues discovered during structured audits of the BrewHub PHL codebase. It is maintained per the **Duty to Document** policy defined in `CLAUDE.md`.

---

## Phase 2 CRM Audit: Resolved Issues

The following issues were identified and resolved during the Phase 2 Unified CRM migration audit (March 2026).

### CRITICAL — Removed Redundant Client-Side `customers` Upsert

**File:** `src/app/(site)/resident/page.tsx`

After the Unified CRM migration, the backend Postgres trigger `handle_new_user()` fires on every `auth.users` INSERT and securely creates or merges the corresponding `customers` row. The frontend `handleRegister` function was redundantly executing a `supabase.from("customers").upsert(...)` call immediately after `signUp()`. Because client-side INSERTs to `customers` are blocked by RLS, this always returned a 403 error, which incorrectly triggered the `setError("Registration failed...")` block — even though the backend trigger had already succeeded.

**Fix:** Removed the entire `.upsert()` block and its error handling from `handleRegister`. The function now sets `success = true` immediately after a successful `signUp()` call, trusting the server-side trigger. User metadata (`full_name`, `unit_number`, `phone`) continues to be passed via `options.data` so the trigger receives it.

---

### HIGH — Fixed Kiosk Badge Over-Count

**Files:** `src/app/(ops)/manager/QueueMonitor.tsx`, `src/app/(ops)/manager/ParcelsMonitor.tsx`

The unified Postgres view `v_items_to_pickup` (Schema 78) intentionally includes cafe orders with `status = 'completed'` so departure boards can flash a brief "Picked Up!" animation. Both `QueueMonitor` and `ParcelsMonitor` were fetching `count: "exact"` from this view without filtering, causing the notification badges to aggregate hundreds of already-completed orders into the "waiting" count — making it wildly inaccurate for staff.

**Fix:** Added `.neq("current_status", "completed")` to the Supabase queries in both components:
- `QueueMonitor.tsx` → `fetchPickupCount` now excludes completed items.
- `ParcelsMonitor.tsx` → the `cafeReadyCount` query now also filters `item_type = "cafe_order"` AND excludes completed items.

---

### MEDIUM — Fixed Guest Handoff Mismatch

**Files:** `src/app/(ops)/parcels/scan/page.tsx`, `src/app/(ops)/parcels/dashboard/page.tsx`, `src/hooks/useParcelSync.ts`

When staff quick-added a "Ghost Resident" on the dashboard, the `/upsert-guest` call correctly created a `customers` row and stored the returned UUID in the local `resident` state. However, the check-in payload builders ignored this resolved `resident.id`:

- **scan/page.tsx (`handleCheckIn`):** The `isGhostWithInfo` branch (triggered when `residentState === "ghost"`) always sent raw `recipient_name` / `phone_number` strings to `/parcel-check-in`, even when the `resident` object already had a valid `id` from a phone lookup or guest upsert.
- **dashboard/page.tsx (`onSubmit`):** After resolving a resident (via guest upsert or directory lookup), the `sendResult` broadcast back to the iPhone omitted the `residentId`, so the mobile-scan device had no way to attach it to its own `/parcel-check-in` call.

**Fix:**
- **scan/page.tsx:** Reordered the payload logic to check `resident?.id` first. If a UUID exists, it is always mapped to `payload.resident_id`, bypassing the raw-string ghost fallback.
- **dashboard/page.tsx:** The `sendResult` broadcast now includes `residentId` and `residentName` from the resolved resident, making them available to downstream devices.
- **useParcelSync.ts:** Extended the `result` event type to carry optional `residentId` and `residentName` fields.
---

## GPT-Generated Chatbot CRM Integration: Security Audit (March 2026)

The `check_parcels` tool and CRM insights endpoint were drafted by an external AI (GPT) and required a security & architecture audit before merge. The following issues were identified and corrected.

### CRITICAL — PostgREST Filter Injection via `.or()` String Interpolation

**File:** `netlify/functions/claude-chat.js` — `check_parcels` tool handler

GPT used Supabase's `.or()` method with raw string interpolation of LLM-sourced values:
```js
query = query.or(`recipient_name.ilike.%${safeName}%,unit_number.eq.${safeUnit}`);
```
PostgREST's `.or()` parses commas as condition separators and periods as `column.operator.value` delimiters. Since `sanitizeInput()` does not strip commas or periods (it targets HTML/XSS), a prompt-injected name containing `,status.neq.arrived` would inject additional filter conditions. A bare `%` as the name would also match ALL arrived parcels (LIKE wildcard).

**Fix:** Replaced the `.or()` string template with two separate parameterised queries (`.ilike()` for name, `.eq()` for unit) executed via `Promise.all()` and deduped by `id`. Added a `stripLikeWildcards()` helper that removes `%` and `_` from sanitised values before they reach `.ilike()`. Added a 2-character minimum for name searches to prevent single-char bulk enumeration.

### MEDIUM — PII Echo in "Not Found" Response

**File:** `netlify/functions/claude-chat.js` — `check_parcels` tool handler

The "no packages found" message interpolated the raw LLM-provided `resident_name` directly:
```js
result: `No pending packages found for "${resident_name}"`
```
If the LLM hallucinated or was prompt-injected, unsanitised content would flow into the API response.

**Fix:** The message now uses the `sanitizeInput()`-processed and truncated values only.

### LOW — Missing `logSystemError` for Parcel Query Failures

**File:** `netlify/functions/claude-chat.js`

The `check_parcels` catch block only called `console.error()`. Per project standards (`CLAUDE.md` — Standard Libraries & Helpers), persistent error logging via `logSystemError()` is required.

**Fix:** Added `const { logSystemError } = require('./_system-errors');` to imports and a `logSystemError()` call in the catch block alongside the existing `console.error()`.

### PASS — Service Role Client Instantiation

The Supabase `service_role` client in `claude-chat.js` is correctly instantiated **per-request** inside `exports.handler` (not at module scope). No long-lived client leak.

**Note:** The pre-existing `get-arrived-parcels.js` file (not GPT-touched) still uses a module-scope global client on line 4. This is a separate tech-debt item.

---

## Maintenance

### Refactored `get-arrived-parcels.js` to Per-Request Client

**File:** `netlify/functions/get-arrived-parcels.js`

The Supabase `service_role` client was instantiated at module scope (line 4), which is against serverless best practices — a cold-start client can persist across warm invocations, risking stale connections or leaked state. Moved `createClient()` inside `exports.handler` so each request gets a fresh client. Environment variables (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`) are still read from `process.env` at call time.

---

### PASS — Parcel Status Filter

The code correctly filters `status = 'arrived'` which aligns with the `v_items_to_pickup` view (Schema 78). The `parcels` table uses `arrived` for packages awaiting resident pickup — not `pending`.

### PASS — Tone & Brand Voice

The system prompt's `check_parcels` instructions match BrewHub's brand voice: conversational, privacy-aware, and directs to front desk for edge cases. Updated to remind users about physical key / ButterflyMX access requirement. No "generic AI assistant" phrasing detected.

### `check_parcels` Tool — Technical Summary

| Attribute | Value |
|---|---|
| **Tool name** | `check_parcels` |
| **Trigger** | Customer asks about packages, mail, or deliveries |
| **Auth** | None required — packages are physically secured behind mailbox keys / ButterflyMX credentials |
| **Table** | `parcels` (direct query, not view) |
| **Filter** | `status = 'arrived'` |
| **Inputs** | `resident_name` (fuzzy `.ilike()`), `unit_number` (exact `.eq()`) — at least one required |
| **Sanitisation** | `sanitizeInput()` → `stripLikeWildcards()` → `.slice()` length cap |
| **Min search length** | Name: 2 chars, Unit: 1 char |
| **Result limit** | 20 parcels (10 per sub-query when both params provided) |
| **PII controls** | No tracking numbers, sender details, recipient names, or unit numbers returned to LLM. Only carrier, arrival time, and generic secure-locker status. |
| **Error handling** | `console.error` + `logSystemError()` → graceful user message |