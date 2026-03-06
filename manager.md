📖 BrewHub PHL: Manager’s Operational Manual
This document serves as the source of truth for handling physical cafe reality through our digital infrastructure.

1. Handling Inventory & Breakage
The system no longer allows "silent" stock changes to ensure IRS-compliant audit trails.

Restocking Items: Go to the Catalog Manager. Tap a product (e.g., "House Espresso") and enter the new total in the Stock Quantity field.

Reporting Breakage: If a glass mug or retail item breaks, tap the "Report Spoilage / Breakage" button.

Why?: You must enter a reason and quantity. This creates an immutable record in the Inventory Shrinkage Log so the owner knows exactly why $25 in retail value vanished.

2. Payroll Adjustments & Staff Safety
Payroll edits are high-security actions.

Clock-Out Fixes: If a barista forgets to clock out, use the Fix Clock-Out button to set the correct time.

Shift Overrides: To change past hours, click "Adjust Hours". You must provide a reason of at least 10 characters and pass a TOTP/PIN Challenge.

Staff Exhaustion: Watch the Live Staff Pulse in the dashboard header. If the badge turns RED, a staff member has been on-site for over 16 hours and must be sent home immediately for safety and liability reasons.

Profitability Report: The "Profitability" card on the Manager Dashboard shows monthly revenue vs. maintenance costs. It pulls all completed orders and all maintenance_logs entries for the selected month, calculates the net profit, and displays the Maintenance-to-Revenue ratio. Use the month picker (YYYY-MM) to review past months. This helps identify months where equipment costs ate into margins.

Monthly Financial Email: On the 1st of every month, all active managers automatically receive a professional email summary of the previous month's profitability. The email shows Revenue, Maintenance Cost, Net Profit, and the Maintenance-to-Revenue ratio. If maintenance costs exceeded 10% of revenue, the email includes a red alert button linking directly to the Equipment & Maintenance page (/manager/assets) so you can investigate. No action is needed to opt in — all active managers/admins receive it.

3. The "Offline" Protocol
If the cafe Wi-Fi dies, the POS iPad will automatically enter CASH ONLY MODE.

The Cap: You can process up to $200 in cash sales while offline.

Do Not Refresh: Tell staff never to refresh the browser or clear cache while the red "OFFLINE" banner is visible.

Auto-Sync: Once Wi-Fi returns, the system will silently sync all orders to the database. Verify the "Connection Restored" green banner appears.

4. Outbound Shipping (FedEx)
For residents dropping off packages to ship:

POS Intake: Use the "Shipping/Parcels" tab on the POS.

Open Pricing: Since rates are currently TBD, enter the price quoted from the FedEx portal manually into the Open Price field.

The Monitor: Once paid, the package will appear in CYAN on the Parcel Departure Board as "Awaiting FedEx Pickup".

5. Staff Management (Team Tab)
A new "Team" tab on the Manager Dashboard provides full staff directory management.

Viewing Staff: The StaffTable loads from the v_staff_status view (never directly from staff_directory). You can search by name, filter by role (Manager, Barista, Admin, Owner), and see real-time working status.

Actions: Use the action menu on each staff row to Edit Profile (name, email, phone, role), Change Role, or Deactivate a staff member (triggers instant token revocation).

Phone Numbers: Staff phone numbers can now be stored in the directory for shift-change notifications.

6. CRM & Customer Management (Insights Tab)
The CRM Insights panel shows aggregated customer metrics — total customers, app users, walk-ins, mailbox renters, VIPs, and loyalty-active counts.

Customer Table: Click "View Customers" for a full drill-down table with 8 filter presets (All, App Users, Walk-in, Mailbox, VIP, Loyalty, Active 30d, New 7d). Use the action menu for Check-in Package, Add Loyalty, or Log Manual Order.

7. Specialty Coffee Menu & Modifiers
The menu now features 7 curated specialty coffees. Each item defines which modifier groups are available:

Modifier Groups: Milks, Sweeteners, Standard Syrups, and Specialty Add-ins. Modifiers support quantity (e.g., "Sugar x3") with accurate pricing at the POS.

Catalog Updates: Use the Catalog Manager to edit long_description (origin stories, tasting notes) and allowed_modifiers per item.

8. Multi-Employee Scheduling (Calendar)
The Calendar page now supports multi-employee shift creation.

Creating Shifts: Select a time slot, then use the checkbox multi-select to assign multiple employees at once. A single action creates all shifts in batch.

Visual: Overlapping shifts render as compact colored pills (initials for 2+ employees, full name for solo). A "+X more" badge appears for slots with more than 3 assignees.

Hover Peek: Hover over a multi-employee block to see the full roster without opening the edit modal.

Batch Operations: Move or delete multiple shifts at once via the manage modal.

9. Exporting Orders
An "Export Orders" button appears in the Overview tab header. Tap it to download a CSV of all coffee orders (date, customer, items, totals) for accounting or analysis.

10. System Integrity Alerts (Schema Health)
When the Manager Dashboard loads, it automatically runs a schema health check against the `agreement_signatures` table by calling the `get-schema-health` function. If any required columns are missing or have incorrect types, a **red alert banner** appears at the top of the dashboard.

What the banner shows: The error message from the health check, a list of every missing column (with expected Postgres type), and any type mismatches (expected vs actual).

Copy Migration SQL: Click the "Copy Migration SQL" button on the banner to copy the exact `ALTER TABLE` / `CREATE TABLE` SQL needed to fix the schema. Paste it into the Supabase SQL Editor and run it. Refresh the dashboard — if the migration was successful, the banner will disappear.

No action is needed when the schema is healthy — the banner only appears when a migration is required.

11. Data Integrity: Simulation vs. Production

All new inventory, orders, and equipment entries default to "simulation" mode. This prevents test data from affecting real profitability numbers, stock alerts, or financial reports.

Viewing Data Level: In the Inventory table, each row now shows a "simulation" or "production" badge. Use the ?level=production or ?level=simulation filter to focus on one tier.

Stock Alerts (P1/P2): By default, low-stock alerts only fire for production-level items. If you need to see simulation alerts during development, enable "Dev Mode" on the dashboard (adds ?dev_mode=true to inventory checks).

Profitability Reports: The Profitability card and monthly financial email now compute revenue ONLY from production orders. Simulation orders are excluded from all accounting calculations. The v_accounting_ledger_live view in Supabase provides a live, production-only financial ledger.

Promoting Items to Production: When real inventory arrives and is verified on-site:
  1. Go to the Inventory or Orders table.
  2. Select the items to promote.
  3. Use the "Promote to Production" action. This requires your Manager PIN and moves the selected items from simulation → production permanently.
  4. Promoted items will immediately appear in stock alerts, profitability reports, and the accounting ledger.

Batch Limit: Up to 500 items can be promoted at once. The operation is atomic — either all succeed or none do.

Tables Affected: inventory, orders, equipment, maintenance_logs all support the simulation/production distinction.

12. QA/Security Audit Ticket Backlog (March 4, 2026)

Use this as the execution queue for engineering hardening. Priority order is Critical → High → Medium.

### Critical (Breaking)

**TICKET C-1 — Atomic Agreement Signature Write**
- Severity: Critical
- Owner: Backend (Netlify + SQL)
- Problem: Signature insert and staff contract flag update are not atomic; a partial success can leave legal/audit data inconsistent.
- Scope: `record-agreement-signature.js` + new SQL RPC transaction.
- One-line fix: Move signature insert + `staff_directory` update into a single Postgres RPC transaction and fail the request if any step fails.
- Acceptance criteria:
	- If any write fails, no partial signature or partial onboarding state remains.
	- API returns non-200 on partial failure.
	- Logs include a single correlated failure event ID.

**TICKET C-2 — Enforce Onboarding Gate at Auth Boundary** ✅ RESOLVED
- Severity: Critical
- Owner: Backend Auth + Ops UI
- Resolution: `verify_staff_pin` RPC updated (schema 85) to return `contract_signed` + `onboarding_complete`. `pin-login.js` and `pin-verify.js` surface these in the staff response. `OpsGate.tsx` checks `onboarding_complete` on every session verify and redirects unsigned staff to `/staff-hub/onboarding`. Admin/manager roles are exempt.
- Acceptance criteria: ✅ All met
	- Unsigned staff cannot access `/pos`, `/kds`, `/scanner`, `/staff-hub`.
	- Unsigned staff are redirected to agreement flow only.
	- Signed staff continue to normal landing pages with no regression.

### High (Security/Financial)

**TICKET H-1 — Canonical Agreement Hashing (Non-Repudiation)**
- Severity: High
- Owner: Backend (Legal/Security)
- Problem: SHA-256 is computed from client-supplied `agreement_text` rather than a server-canonical hydrated agreement.
- Scope: `record-agreement-signature.js` + agreement template hydrate helper.
- One-line fix: Regenerate the hydrated agreement server-side from staff data and hash/sign that canonical string only.
- Acceptance criteria:
	- Client cannot alter signed text payload.
	- Recomputed hash from server template+inputs exactly matches stored hash.
	- Audit row stores canonical version tag and hash.

**TICKET H-2 — Profit Share Integer Math Path**
- Severity: High
- Owner: Finance Backend
- Problem: Staff pool and bonus-per-hour calculations use floating conversion/rounded hour decimals, creating cent drift risk.
- Scope: `get-profit-share-preview.js`.
- One-line fix: Keep all calculations in integer units (cents + minutes) and derive display values only at response formatting.
- Acceptance criteria:
	- No floating-point division on business outputs before final formatting.
	- Re-running same data set yields deterministic cent-accurate results.
	- Unit tests cover odd-minute and low-pool distributions.

**TICKET H-3 — Probation/Vesting Eligibility Filter** ✅ COMPLETED
- Severity: High
- Owner: Finance SQL
- Problem: Profit-share hour pool currently includes all `time_logs`; 90-day probation exclusion is not enforced.
- Scope: SQL query/RPC behind `get-profit-share-preview`.
- Resolution: `get-profit-share-preview.js` now joins `time_logs` with `staff_directory!inner(hire_date)` on `staff_id`. Defines a `vestingDate` (now − 6 months) and a `probationDate` (now − 90 days). Staff with `hire_date` after `probationDate` are hard-excluded; staff with `hire_date` after `vestingDate` are excluded from eligible hours and added to `pending_staff_count`. Response now includes `eligible_staff_count`, `pending_staff_count`, `vesting_months`, `probation_days`. When `total_eligible_hours` is 0, `bonusPerHourCents` returns 0 (not Infinity). Ops-diagnostics info logged when no staff are vested. `_profit-report.js` exports `checkVestingEligibility()` for future payout endpoints. `ProfitShareCard.tsx` displays eligible staff count with vesting tooltip.
- Acceptance criteria:
	- Staff under probation contribute zero eligible hours. ✅
	- Eligible hours and bonus/hour align with written policy. ✅
	- Response includes eligible-hours field for audit transparency. ✅

**TICKET H-4 — AgreementViewer 401 Mid-Flow UX Recovery** ✅ COMPLETED
- Severity: High
- Owner: Frontend Ops
- Problem: `fetchOps` hard-reloads on 401; agreement signing flow has no explicit session-expired state before redirect.
- Scope: `AgreementViewer.tsx` + `ops-api.ts` (fetchOps).
- Resolution: Added `skipAutoLogout` option to `fetchOps()` so callers can handle 401 themselves. `AgreementViewer` now persists scroll-read state to `sessionStorage` (restored on re-mount). On 401 during signing: saves signature attempt data (canonical text, version tag, staff ID) to a `recovery_vault` in `localStorage` (5-min TTL), displays an inline re-auth modal with 6-digit PIN input, calls `pin-login` to establish a new session, then transparently retries the signature POST with the new token. On success, clears the vault, syncs the parent session context via `refreshSession()`, and proceeds to the "Signed" screen. Button shows "Verifying & Sealing…" during recovery. Wrong PIN and TOTP-required errors display clearly within the modal.
- Acceptance criteria:
	- Mid-signature 401 always shows a clear "session expired" message. ✅
	- No ambiguous "signature failed" messaging for auth expiry. ✅
	- User can re-auth and retry without stale form state. ✅

### Medium (UX/Operational)

**TICKET M-1 — Scroll-Gate Read Proof Hardening**
- Severity: Medium
- Owner: Frontend Ops
- Problem: Unlock relies on scroll event only; tall screens/non-scrollable content can deadlock or auto-unlock without meaningful read intent.
- Scope: `AgreementViewer.tsx`.
- One-line fix: Add initial non-scrollable auto-pass check plus minimum read-threshold logic before enabling signing.
- Acceptance criteria:
	- No deadlock when content fits viewport.
	- Unlock does not trigger instantly on minor accidental scroll.
	- Behavior is consistent across mobile, tablet, and desktop heights.

**TICKET M-2 — Manager Alert Hierarchy Conflict**
- Severity: Medium
- Owner: Frontend Manager Dashboard
- Problem: Schema red alert and overdue maintenance toast can render simultaneously, competing for urgency.
- Scope: `manager/page.tsx` alert orchestration.
- One-line fix: Suppress/defer maintenance toast while schema integrity alert is active.
- Acceptance criteria:
	- Only one high-priority alert channel is active at a time.
	- Schema alert retains top priority until dismissed/resolved.
	- Secondary alerts appear after primary alert clears.

**TICKET M-3 — Migration SQL Builder Cast Safety**
- Severity: Medium
- Owner: Frontend + DBA Review
- Problem: Generated `ALTER COLUMN TYPE` lacks explicit `USING` casts for non-implicit conversions.
- Scope: `buildMigrationSQL()` in manager page + `AlertModal.tsx` P0Card.
- Resolution: 
	- `ALTER COLUMN … TYPE … USING (column::target_type)` added for all type-mismatch fixes.
	- All generated SQL wrapped in `BEGIN;` / `COMMIT;` for atomic rollback.
	- Top-of-script warning comment: `/* WARNING: Verify backup before running. */`.
	- Copy button in AlertModal now shows post-copy warning about explicit type casting.
	- Distinct code paths: `ADD COLUMN IF NOT EXISTS` for missing columns, `ALTER COLUMN … TYPE … USING` for type mismatches.
- Status: **Completed**

12. Sprint Execution Checklist (Ready-to-Run)

Use this table in standups. Update **Status**, **Assignee**, and **ETA** daily.

| Ticket | Priority | Status | Assignee | ETA | Dependency | Release Gate |
|---|---|---|---|---|---|---|
| C-1 Atomic Agreement Signature Write | P0 | Not Started | Backend | 1 day | None | **Blocker** |
| C-2 Enforce Onboarding Gate at Auth Boundary | P0 | Not Started | Backend Auth + Ops UI | 1–2 days | C-1 (recommended) | **Blocker** |
| H-1 Canonical Agreement Hashing | P1 | Not Started | Backend (Security/Legal) | 1 day | C-1 | Yes |
| H-2 Profit Share Integer Math Path | P1 | Not Started | Finance Backend | 1 day | None | Yes |
| H-3 Probation/Vesting Eligibility Filter | P1 | **Completed** | Finance SQL | — | H-2 (recommended) | Yes |
| H-4 AgreementViewer 401 Mid-Flow UX Recovery | P1 | **Completed** | Frontend Ops | — | C-2 (recommended) | Yes |
| M-1 Scroll-Gate Read Proof Hardening | P2 | Not Started | Frontend Ops | 0.5 day | None | No |
| M-2 Manager Alert Hierarchy Conflict | P2 | Not Started | Frontend Manager Dashboard | 0.5 day | None | No |
| M-3 Migration SQL Builder Cast Safety | P2 | **Completed** | Frontend + DBA | — | None | No |

### Definition of Done (for every ticket)
- Code merged to main with reviewer approval.
- Targeted tests or verification steps recorded in PR notes.
- No new security regressions in touched files.
- Manager-facing behavior documented in this manual if workflow changes.

### Suggested Sprint Order
1) C-1, 2) C-2, 3) H-1 + H-2 (parallel), 4) H-3 + H-4 (parallel), 5) M-1 + M-2 + M-3.