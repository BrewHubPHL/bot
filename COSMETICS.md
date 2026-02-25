# COSMETICS.md — BrewHub PHL Visual Audit

> **This document is a visual audit. No code changes will be made until specific UI updates are approved step-by-step.**

---

## Table of Contents

1. [Global Theme Audit](#1-global-theme-audit)
2. [Manager Dashboard Tear-Down](#2-manager-dashboard-tear-down)
3. [Component Inconsistencies](#3-component-inconsistencies)
4. [Proposed Style Guide](#4-proposed-style-guide)

---

## 1. Global Theme Audit

### 1.1 Color Tokens

| Token / Pattern | Value | Usage | Issue |
|---|---|---|---|
| `--hub-brown` | `var(--hub-espresso)` | Nav links, body text | **FIXED** — Now an alias of `--hub-espresso`. Single source of truth. |
| `--hub-espresso` | `#0a0a0a` | Hero title, hero CTA bg, canonical brand black | Canonical token. |
| `--hub-tan` | `#b8860b` | Brand accent (borders, CTAs) | Only accent color defined. WCAG AA on white (#fff) = **3.65:1 — Fails** for normal text (needs 4.5:1). Fine for large text / decorative borders. |
| `--bg-main` / `--bg-alt` | `#ffffff` / `#f3f4f6` | Site background gradient | Reasonable — provide subtle depth. |
| `--text-main` | `#1c1917` | Used in `.about-content`, `.about-page-content` | **FIXED** — Defined as `#1c1917` (stone-900) in `:root`. |

**Ops Area Dark Palette:** ~~The entire `(ops)` layout uses `bg-black text-white` on the layout shell, while the Manager Dashboard page itself applies `bg-stone-950 text-white`. There is a **double-dark conflict**: stone-950 (`#0c0a09`) vs. pure black (`#000`). On high-gamut displays this creates a visible seam between the layout background and page content area.~~ **FIXED** — Ops layout changed from `bg-black` to `bg-stone-950` to match the Manager Dashboard page. No more double-dark seam.

**Hard-coded Hex Prevalence:** ~~Throughout the ops components, colors are overwhelmingly hard-coded~~ **FIXED** — All hex grays replaced with Tailwind `stone-*` tokens across 9 files (DashboardOverhaul, InventoryTable, RecentActivity, StatsGrid, KdsSection, CatalogManager, PayrollSection, ReceiptRoll, Queue). Scrollbar inline CSS in ReceiptRoll also converted. Only intentional tinted colors (`#1f0d0d` red, `#0d1f12` green) and thermal receipt light-theme values remain.

| Former Hex | Tailwind Token | Semantic Role |
|---|---|---|
| `#1a1a1a` | `stone-900` | Card surface |
| `#111` | `stone-950` | Deep surface (drawer, kiosk) |
| `#222` | `stone-800` | Table header bg, dividers |
| `#333` (border) | `border-stone-800` | Default border |
| `#444` (border) | `border-stone-700` | Emphasis border |
| `#f5f5f5` (text) | `text-stone-100` | Primary text on dark |
| `gray-400`, `gray-500`, `gray-600` | Tailwind built-in | ~~⚠️ Still mixed with `stone-*`~~ **FIXED** — All `gray-*` replaced with `stone-*` (fix #3). |

### 1.2 Typography

- **Font Families:** Correctly loaded via `next/font/google` — Inter (sans) + Playfair Display (serif). CSS variables (`--font-inter`, `--font-playfair`) are set on `<html>` and referenced in `tailwind.config.ts`.
- ~~**Site-facing CSS** redundantly hard-codes `font-family: 'Inter', ui-sans-serif…` on `html, body` in `globals.css`, which competes with the Tailwind `font-sans` token. The Playfair references in CSS use the literal string `'Playfair Display'` in some places and `var(--font-playfair)` in others (inconsistent).~~ **FIXED** — `html, body` now uses `var(--font-inter)` instead of hard-coded `'Inter'`. All 3 Playfair references (`nav-logo`, `hero-title`, `concierge-title`) unified to `var(--font-playfair)`.
- **Ops area** has no explicit font-family — it inherits Inter from `<html>`. This is correct.
- **Parcel Board** overrides to `ui-monospace, 'Courier New', monospace` via inline style — intentional for the Solari board aesthetic.
- ~~**AolBuddyQueue** overrides to `"Geist Mono", "Courier New", monospace` — a different monospace stack than the Parcel Board.~~ Intentional per-component aesthetic. QueueMonitor's inline `fontFamily` replaced with Tailwind `font-mono` class.

**Font Size Scale Issues (Ops Area):**
- ~~Section headers vary: `text-lg font-semibold` (Payroll, Inventory, Receipt Roll, KDS) vs. `text-xl font-bold` (Catalog Manager, Hiring Viewer). No single h2-level treatment.~~ **FIXED** — All section headers unified to `text-lg font-semibold`.
- Stat card values are consistently `text-2xl font-bold` — good.
- ~~Label/caption text swings between `text-xs`, `text-[10px]`, `text-[11px]`, and `text-sm` with no predictable pattern.~~ **PARTIALLY FIXED** — `text-[11px]` eliminated (promoted to `text-xs`). Remaining `text-[10px]` usages are intentional micro-labels (status badges, mobile bottom tab, category pills, timestamps).

### 1.3 Spacing & Layout

- **Global page container:** `max-w-7xl mx-auto px-4 sm:px-6` — consistent across the Manager Dashboard header and content area.
- **Content padding:** `py-8 pb-28 md:pb-8` on `<main>` — the `pb-28` is appropriate for mobile bottom tab clearance.
- **Section spacing within tabs:** ~~Inconsistent. DashboardOverhaul uses `space-y-4`, HiringViewer uses `space-y-6`, PayrollSection uses `space-y-4 mb-8`, CatalogManager uses `mt-10` with no parent spacing util. This creates uneven vertical rhythm when switching tabs.~~ **FIXED** — Overview wrapper promoted to `space-y-6`, CatalogManager `mt-10` removed, PayrollSection stale `mb-8` removed, and all section-level `mb-8` removed from ReceiptRoll, KdsSection, InventoryTable, StatsGrid, and RecentActivity. Parent `space-y-6` now handles all inter-section spacing consistently.

### 1.4 Focus / Accessibility

- Global `*:focus-visible` ring is `2px solid #f59e0b` (amber-500) with `outline-offset: 2px` — good baseline.
- DesktopTabNav and MobileBottomTabBar correctly use `focus-visible:ring-2 focus-visible:ring-amber-500/60` — consistent with the global ring.  
- Most buttons in the ops area do **not** carry explicit `focus-visible` classes, relying on the global `*:focus-visible` rule alone. This is acceptable but may be overridden by `outline: none` on some inputs.

---

## 2. Manager Dashboard Tear-Down

### 2.1 Top Header Bar

- **Background:** `bg-stone-950/90 backdrop-blur-md` — the 90% opacity allows page content to bleed through on scroll. On dense data (receipt rolls, large payroll tables), the bleed reduces header readability.
- **Title hierarchy:** "Manager Dashboard" is `text-lg font-bold` — appropriate. Subtitle "BrewHub PHL · Staff Operations" is ~~`text-stone-500`~~ **FIXED** — now `text-stone-400` for better contrast on `stone-950`. `text-xs tracking-wider uppercase` — good.
- **Date display:** ~~`text-xs text-stone-600 hidden sm:block`~~ — **FIXED.** Now `text-stone-400` (~5.5:1 contrast on stone-950). Meets WCAG AA.
- **Quick Links bar (ManagerQuickLinks):** ~~`text-[11px] text-stone-500` with no touch targets~~ — **FIXED.** Bumped to `text-xs`, each link carries `min-h-[44px] inline-flex items-center` for tablet compliance, divider promoted to `text-stone-600`.

### 2.2 Desktop Tab Navigation

- Active state: `border-amber-500 text-amber-400` — clear, high-contrast selection indicator.
- Inactive state: `border-transparent text-stone-500 hover:text-stone-300 hover:border-stone-700` — adequate.
- **Issue:** Tabs are `px-4 py-2.5 text-sm` — on a 16" display this feels comfortably spaced, but on a 10" tablet (common café management device), these are tight. ~~The horizontal scroll with `overflow-x-auto scrollbar-hide` hides that additional tabs exist — no visual scroll affordance.~~ **FIXED** — Added CSS `mask-image` gradient fade at the right edge (mobile only) to hint at off-screen tabs. `sm:` breakpoint removes the mask.

### 2.3 Mobile Bottom Tab Bar

- `h-16` with `text-[10px]` labels — meets 64px height recommendation.
- Active icon `strokeWidth={2.2}` vs. inactive `strokeWidth={1.6}` — subtle but nice.
- ~~**Issue:** 6 tabs in a fixed bottom bar on a 375px-wide phone means each tab is ~62px wide. With icons at `size={22}` and `text-[10px]` labels, "Queue Monitor" and "Parcel Board" labels will truncate or overflow. No `truncate` class is applied.~~ **FIXED** — Added `truncate max-w-full px-0.5` to mobile tab `<span>` labels so long names like "Queue Monitor" and "Parcel Board" clip gracefully on 375px screens.
- ~~`pb-safe` class is declared but not defined~~ **FIXED** — `.pb-safe` now defined alongside `.safe-area-bottom` in globals.css. iOS safe area inset will apply correctly.

### 2.4 Overview Tab — DashboardOverhaul

**Connection Banner:**
- Success state: `text-green-400/80` with `Wifi` icon at size 14 — readable.
- Error state: `bg-red-500/10 border border-red-500/30 text-red-400` — consistent with the style used elsewhere.
- The ~~"Auto-refreshes every 60s" text is `text-gray-600`~~ **FIXED** — Now `text-stone-600`. Uses `stone` scale exclusively.

**Quick Stats Cards:**
- Card container: `bg-[#1a1a1a] border border-[#333] rounded-xl px-4 py-4 min-h-[80px]`
- **Inconsistency with StatsGrid.tsx (legacy):** ~~StatsGrid uses `rounded-xl p-6` while DashboardOverhaul uses `rounded-xl px-4 py-4`. StatsGrid adds a third "Live" / "Syncing..." label row below the value. They also use different grid layouts: StatsGrid is `grid-cols-1 md:grid-cols-4 gap-6 mb-8`, DashboardOverhaul is `grid-cols-2 md:grid-cols-4 gap-3`. **These are two competing stat grids.**~~ **FIXED** — `StatsGrid.tsx` deleted (dead code, not imported anywhere). DashboardOverhaul is the single source of truth for stats.
- ~~Revenue card uses emoji `💰` while StatsGrid uses a refresh icon `🔄`. Inconsistent visual language.~~ **FIXED** — StatsGrid removed.

**"On the Clock" Card:**
- Card: `bg-[#1a1a1a] border border-[#333] rounded-xl overflow-hidden`
- Header row: `px-5 min-h-[56px] border-b border-[#333]` with an active count badge that uses `bg-green-500/10 text-green-400` or `bg-[#333] text-gray-500`.
- Shift rows: `divide-y divide-[#222]` with `px-5 min-h-[56px] py-3` — good touch target sizing.
- Status dot: `w-2.5 h-2.5 rounded-full` with color tiers (green/amber/red-pulse) — visually effective.
- ~~**Issue:** The `>16h "Check in?"` badge uses `text-[10px]` with `bg-red-500/20 text-red-400 border border-red-500/30 rounded px-1.5 py-0.5` — border-radius is `rounded` (4px) while the parent card is `rounded-xl` (12px). Micro-inconsistency in radii.~~ **FIXED** — Badge changed to `rounded-full px-2 py-0.5` (pill shape, matches status badges elsewhere).

**"Launch Display Screens" Card:**
- Uses two colored accent links: amber for Queue and purple for Parcels.
- These cards are `rounded-xl` but the icon section in the parent card uses `rounded-lg` — mixed radii (12px vs. 8px).

**"Refresh Now" Button:**
- `bg-[#1a1a1a] border border-[#444] hover:bg-[#222] hover:border-amber-500/40` — uses `#444` border while all other cards use `#333`. Visually heavier but without clear semantic reason.

### 2.5 Overview Tab — ReceiptRoll

- **Section header:** `text-lg font-semibold` with emoji "🖨️" — matches Payroll/Inventory pattern but clashes with the emoji-less DashboardOverhaul headers above it.
- **Refresh button:** ~~`text-gray-400 border border-[#333] px-3 py-1 rounded hover:bg-[#222]`~~ **FIXED** — Now standardized `rounded-xl` secondary button with `<RefreshCw>` icon, `min-h-[44px]` touch target, and `stone-*` tokens.
- **Receipt card:** Uses raw CSS class `.thermal-receipt` with explicit `background: #fffdfa`, `color: #111`, ~~`font-family: 'Courier New'`~~ **FIXED** — now uses the full Tailwind `font-mono` stack (`ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Courier New', monospace`). This is a light-themed card on a dark dashboard — **intentional** (thermal paper aesthetic) but creates jarring contrast. The torn-edge `::after` pseudo-element uses hard-coded `12px` background-size with `#fffdfa` — not responsive.
- **Scrollbar styling:** ~~`::-webkit-scrollbar-thumb { background: #444 }`~~ **FIXED** — All scrollbar CSS converted to `rgb()` equivalents of stone-700/stone-950. Also fixed malformed `#44403c03c` hex typo on L176.

### 2.6 Catalog Tab — CatalogManager

- ~~**Section margin:** `mt-10` at the top — this creates a gap from the tab bar that is larger than the `py-8` content padding. Inconsistent with other tabs that flow directly under the tab bar.~~ **FIXED** — Removed `mt-10`; CatalogManager now flows directly under the tab bar like all other sections.
- **"+ Add New" button:** `bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2 rounded-lg` — this is the **only blue primary button** in the entire ops area. Every other primary action uses amber or emerald. Sticks out.
- **Active/Archived tab pills:** `bg-[#1a1a1a] rounded-lg p-1 w-fit` container with `bg-[#333] text-white` active state — effectively a segmented control. Uses `rounded-md` for pills inside `rounded-lg` container — adequate.
- **Product card grid:** `grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4` — good responsive scaling.
- **Product card radii:** `rounded-xl overflow-hidden` — consistent with other cards.
- **Action button row:** `flex border-t border-[#333]` with three `flex-1` buttons using `text-xs font-medium text-gray-400`. The delete button is `text-red-400 hover:text-red-300 hover:bg-red-500/10` — appropriate differentiation.
- **Category badges:** `text-[10px]` with `bg-purple-500/20 text-purple-300` (merch) vs `bg-amber-500/20 text-amber-300` (menu) — good distinction.
- **Slide-out drawer:** `max-w-md bg-[#111] border-l border-[#333]` — uses `#111` while all cards use `#1a1a1a`. The drawer feels noticeably darker than the rest of the UI. Input fields inside use `bg-[#1a1a1a]` which creates a nested surface hierarchy, but the delta is subtle.
- **Image drop zone:** `border-2 border-dashed border-[#444] rounded-lg` — uses `rounded-lg` (8px) while the parent drawer body is effectively `rounded-none` (full-height panel). Fine.
- **Save button:** `bg-blue-600 hover:bg-blue-700` — matches the "Add New" button. Consistent within this component but inconsistent with the rest of the ops area.

### 2.7 Payroll Tab — PayrollSection

- **Date inputs:** `bg-[#1a1a1a] border border-[#333] rounded-lg px-3 py-2 min-h-[44px]` with `focus:ring-1 focus:ring-amber-500` — correctly touch-friendly.
- **Download CSV button:** `bg-gradient-to-br from-emerald-600 to-emerald-700 rounded-xl` — this is the **only gradient button** in the dashboard. Visually prominent, which is appropriate for a primary action, but no other button uses gradients.
- **Date preset pills:** `rounded-full text-xs font-semibold border` with amber active state — consistent with the HiringViewer filter pills.
- **Stat tiles:** `bg-[#1a1a1a] border border-[#333] rounded-xl px-4 py-4` — matches DashboardOverhaul's stat cards exactly. Good.
- **Pay Period Summary table:**
  - Header row: `md:grid-cols-[2fr_1fr_1fr_1fr_1fr_1fr] bg-[#222] text-xs font-bold uppercase tracking-wider text-gray-500` — hidden on mobile (`hidden md:grid`).
  - Data rows: `flex flex-col md:grid` responsive pattern — good.
  - **Issue:** On mobile, each cell prefixes a label (`"Period: "`, `"Clocked: "`, etc.) with `md:hidden text-xs font-semibold text-gray-500`. These inline labels have no consistent spacing from the values. Feels cramped.
  - Row borders: `border-t border-[#222]` vs. header bottom `border-b border-[#333]` — two different border shades within the same table.
- **Open Shifts Card:** `border border-amber-500/30 rounded-xl` — the amber border differentiates it from standard `#333`-bordered cards. Effective visual hierarchy.
- ~~**Fix Clock-Out Bottom Sheet:** `rounded-t-2xl` (`16px`) — the largest radius in the entire ops area. All other cards use `rounded-xl` (`12px`). Creates a slightly inconsistent modal feel.~~ **FIXED** — Changed to `rounded-t-xl` for consistency.
- **Fix button:** `bg-gradient-to-br from-amber-500 to-amber-600` — second gradient button. Consistent "important action" pattern with the CSV download, but different color.

### 2.8 Hiring Tab — HiringViewer

- **Header:** `text-xl font-bold text-white` — uses `text-xl` while all other sections use `text-lg`. Makes "Applicants" feel visually heavier.
- **Refresh button:** `px-4 py-2 rounded-lg bg-stone-800 border border-stone-700 text-stone-300 text-sm hover:bg-stone-700` — **only button using Tailwind `stone` tokens instead of hex**. Visually different from the `border-[#333]` buttons elsewhere.
- **Filter pills:** `rounded-full text-xs font-semibold uppercase tracking-wider border` — near-identical to Payroll date presets. Good consistency.
- **Applicant cards:** `bg-stone-900/60 border border-stone-800 rounded-xl` — uses `stone` tokens while all DashboardOverhaul cards use `#1a1a1a` / `#333`. On most displays, `stone-900` (`#1c1917`) has a warmer tint than `#1a1a1a` (neutral). This creates a subtle but perceptible warm/cool mismatch when switching tabs.
- **Initials avatar:** `w-9 h-9 rounded-full bg-stone-800` — circular, appropriate for a people list.
- **Status badges:** `text-[10px] font-bold uppercase tracking-widest rounded-full border` — well-differentiated per status (amber/sky/violet/green/red). ~~However, the expanded detail's "Move to" buttons use `rounded-md` while the header badge uses `rounded-full` — two different badge shapes for the same semantic element.~~ **FIXED** — "Move to" buttons changed to `rounded-full` to match status badges.
- **Expanded detail grid:** `grid grid-cols-1 md:grid-cols-2 gap-4` — standard responsive pattern.
- **Resume "PDF" link:** `rounded-md bg-stone-800 text-amber-400 text-xs` — the `stone-800` here has that same warm-tint mismatch vs. `#1a1a1a` / `#222` used in other cards.

### 2.9 Queue Monitor Tab

- Goes full-screen (`fixed inset-0 z-[9999]`) with `select-none cursor-none` — designed as a kiosk display.
- Background: inline style `oklch(0.12 0.02 20)` — deepest dark in the system.
- ~~**"← DASH" back button:** `opacity-20 hover:opacity-80` with inline font styles `fontSize: 11, fontFamily: "ui-monospace,monospace"` — extremely low visibility at rest. Intentional for kiosk, but may frustrate staff trying to exit.~~ **FIXED** — Inline font styles replaced with Tailwind `font-mono text-[11px] tracking-widest`.
- ~~**Error state:** `text-red-400 text-sm font-mono` centered on screen. No retry button (unlike DashboardOverhaul's error banner which has tap-to-retry). Inconsistent error recovery pattern.~~ **FIXED** — Retry button added below error message, using standard `rounded-xl` secondary button style.
- **AuthzError overlay:** Uses `AuthzErrorStateCard` at `max-w-md w-full` — consistent component.

### 2.10 Parcel Departure Board Tab

- Full-screen kiosk with extensive `oklch()` color usage — no hard-coded hex, no Tailwind tokens.
- **Status differentiation:**
  - "NEW" rows: `oklch(0.75 0.12 70)` amber glow animation — visible.
  - "DELAYED" rows: `oklch(0.65 0.25 45)` red-orange with blink animation — highly visible.
  - "IN LOCKER" rows: `oklch(0.60 0.08 90)` soft green — **low contrast** against the dark alternating row backgrounds (`oklch(0.18...)` / `oklch(0.15...)`). The green status text is readable but the distinction between "IN LOCKER" and the row's waiting-time text is subtle.
- **Carrier tag badges:** `oklch(0.12 0.02 20)` text on `oklch(0.75 0.12 70)` background — good contrast.
- **Mobile responsive grid:** Collapses from 5 columns to 3 (`grid-cols-[90px_1fr_100px]`), hiding Unit and Carrier columns. A condensed status badge appears inline with the resident name on mobile — effective.
- **Row alternation:** `oklch(0.18...)` / `oklch(0.15...)` — extremely subtle. On lower-quality screens (typical Smart TVs), these may appear identical.
- **Footer:** `fontSize: "11px"` inline — mixes inline styles with Tailwind elsewhere in the same component.
- **4K / portrait scaling:** Custom media queries for `min-width: 2560px` and portrait orientation — thoughtful for signage. `zoom` property is used, which is not a standard CSS property (works in Chromium, not Firefox). Acceptable if target is Smart TV browsers (overwhelmingly Chromium-based).

---

## 3. Component Inconsistencies

### 3.1 Card Surfaces

| Component | Card Classes | Background | Border | Radius |
|---|---|---|---|---|
| DashboardOverhaul (stats) | `bg-[#1a1a1a] border border-[#333] rounded-xl` | `#1a1a1a` | `#333` | `rounded-xl` |
| DashboardOverhaul (sections) | `bg-[#1a1a1a] border border-[#333] rounded-xl overflow-hidden` | `#1a1a1a` | `#333` | `rounded-xl` |
| StatsGrid (legacy) | ~~`bg-[#1a1a1a] rounded-xl p-6 border border-[#333]`~~ | ~~`#1a1a1a`~~ | ~~`#333`~~ | **DELETED** — Dead code removed |
| RecentActivity | `bg-[#1a1a1a] rounded-xl p-6 border border-[#333]` | `#1a1a1a` | `#333` | **`rounded-xl`** (**FIXED**) |
| InventoryTable | `bg-[#1a1a1a] rounded-xl overflow-hidden border border-[#333]` | `#1a1a1a` | `#333` | **`rounded-xl`** (**FIXED**) |
| HiringViewer (cards) | `bg-stone-900 border border-stone-800 rounded-xl` | **`stone-900`** (**FIXED**) | **`stone-800`** | `rounded-xl` |
| PayrollSection (open shifts) | `border border-amber-500/30 rounded-xl` | `#1a1a1a` | **`amber-500/30`** | `rounded-xl` |
| CatalogManager (products) | `bg-[#1a1a1a] border border-[#333] rounded-xl overflow-hidden` | `#1a1a1a` | `#333` | `rounded-xl` |
| AuthzErrorStateCard | `rounded-xl border px-5 py-4` | `amber-950/30` or `red-950/25` | `amber-500/30` or `red-500/30` | `rounded-xl` |

**Key Finding:** ~~`rounded-lg` (8px) vs `rounded-xl` (12px) is inconsistent.~~ **FIXED** — All cards now use `rounded-xl`.

### 3.2 Buttons

| Pattern | Classes | Used In |
|---|---|---|
| **Refresh (standardized)** | `flex items-center gap-2 px-4 py-2 min-h-[44px] rounded-xl bg-stone-900 border border-stone-800 text-stone-400 text-sm hover:border-stone-600 hover:text-white transition-colors` | ReceiptRoll, InventoryTable, CatalogManager, KdsSection |
| **Refresh (icon-only)** | `flex items-center justify-center w-11 min-h-[44px] rounded-xl bg-stone-900 border border-stone-800 text-stone-400 hover:border-stone-600 hover:text-white transition-colors` | PayrollSection |
| **Refresh (with disabled/spinner)** | `flex items-center gap-2 px-4 py-2 rounded-lg bg-stone-800 border border-stone-700 text-stone-300 text-sm hover:bg-stone-700 transition disabled:opacity-50` | HiringViewer |
| **Refresh Now (big action)** | `flex items-center justify-center gap-3 min-h-[56px] bg-stone-900 border border-stone-700 hover:bg-stone-800 hover:border-amber-500/40 text-white text-base font-semibold rounded-xl px-6 active:scale-[0.98] transition-all` | DashboardOverhaul |
| **Primary action (blue)** | `bg-blue-600 hover:bg-blue-700 text-white rounded-lg` | CatalogManager |
| **Primary action (emerald gradient)** | `bg-gradient-to-br from-emerald-600 to-emerald-700 rounded-xl` | PayrollSection CSV |
| **Primary action (amber gradient)** | `bg-gradient-to-br from-amber-500 to-amber-600 rounded-xl` | PayrollSection Fix |
| **Big action** | `bg-[#1a1a1a] border border-[#444] hover:border-amber-500/40 rounded-xl min-h-[56px]` | DashboardOverhaul Refresh Now |
| **Display launch links** | `rounded-xl px-5 min-h-[56px] bg-{color}-500/10 border border-{color}-500/30` | DashboardOverhaul |
| **Filter pills** | `rounded-full text-xs font-semibold uppercase tracking-wider border` | HiringViewer, PayrollSection |

**Key Finding:** ~~There are **4 completely different "Refresh" button styles**~~ **FIXED** — Standardized to a consistent `rounded-xl` secondary button with `<RefreshCw>` icon, `min-h-[44px]` touch targets, `type="button"`, and `stone-*` tokens. The DashboardOverhaul "Refresh Now" retains its intentionally larger "big action" styling. **3 different primary action button styles** remain (amber, emerald gradient, amber gradient) — intentional hierarchy.

### 3.3 Table / List Patterns

| Component | Header Style | Row Divider | Mobile Strategy |
|---|---|---|---|
| InventoryTable | `grid-cols-4 bg-[#222] text-xs text-gray-400` (always visible) | `border-t border-[#222]` | **None** — 4-col grid on all sizes. Cramped on mobile. |
| PayrollSection | `md:grid-cols-[2fr_1fr...] bg-[#222]` (hidden on mobile) | `border-t border-[#222]` | Stacks to `flex-col` with inline labels |
| RecentActivity | No header — plain `<ul>` list | `gap-2` | Auto (single column) |
| DashboardOverhaul (shifts) | Section title as header | `divide-y divide-[#222]` | Auto (flex items) |
| ParcelsMonitor | `grid` with `text-[10px] uppercase tracking-widest` inline style | `border-bottom: 1px solid oklch(...)` inline | Collapses to 3-col grid |

**Key Finding:** ~~InventoryTable is **not responsive**~~ **FIXED** — Grid now collapses to `grid-cols-2` on mobile; Threshold and Adjust columns hidden via `hidden md:block` / `hidden md:flex`.

### 3.4 Touch Target Compliance

| Element | Size | Meets 44×44px? |
|---|---|---|
| ManagerQuickLinks (POS, KDS…) | `text-xs`, `min-h-[44px]` per link | **FIXED** — `min-h-[44px] inline-flex items-center` on each link |
| ReceiptRoll Refresh button | `px-4 py-2 min-h-[44px]` | **FIXED** — Now `min-h-[44px]` with standardized button |
| InventoryTable Refresh button | `px-3 py-1 min-h-[44px]` | **Yes** (has min-height) |
| InventoryTable +/- buttons | `rounded-lg min-h-[44px] min-w-[44px] px-2 py-1` | **FIXED** — Now `min-h-[44px] min-w-[44px]` with `rounded-lg` and `text-sm font-semibold` |
| CatalogManager Refresh button | `px-4 py-2 min-h-[44px]` | **FIXED** — Now `min-h-[44px]` with standardized button |
| Payroll date inputs | `min-h-[44px]` | **Yes** |
| All filter pills | `px-3 py-1.5 min-h-[36px]` | **FIXED** — HiringViewer pills now include `min-h-[36px]` (PayrollSection already had it) |
| Mobile bottom tabs | `h-16` container | **Yes** |

### 3.5 Color Palette Collision (gray vs. stone)

~~Many components mix Tailwind's `gray-*` and `stone-*` scales in the same view:~~

**FIXED** — All `gray-*` tokens replaced with `stone-*` equivalents across 13 files:
- DashboardOverhaul, PayrollSection, CatalogManager, ReceiptRoll, InventoryTable, KdsSection, StatsGrid, RecentActivity (manager components)
- HiringViewer (ops component — already used `stone-*`; unchanged)
- Queue page, Staff Hub page, Portal page (site pages)

Mapping applied: `text-gray-400` → `text-stone-400`, `text-gray-500` → `text-stone-500`, `text-gray-600` → `text-stone-600`, `text-gray-700` → `text-stone-700`, `text-gray-200` → `text-stone-200`, `text-gray-300` → `text-stone-300`, `bg-gray-900` → `bg-stone-900`, `border-gray-800` → `border-stone-800`, `hover:text-gray-400` → `hover:text-stone-400`, `hover:border-gray-400` → `hover:border-stone-400`, `placeholder:text-gray-600` → `placeholder:text-stone-600`.

### 3.6 Skeleton / Loading States

| Component | Loading Pattern |
|---|---|
| DashboardOverhaul | **FIXED** — `animate-pulse` skeleton bars (×3) for "On the Clock" section; inline `"…"` for stat values (acceptable — values load fast) |
| HiringViewer | `h-20 bg-stone-900 rounded-xl animate-pulse` × 3 |
| CatalogManager | `aspect-square bg-stone-900 border border-stone-800 rounded-xl animate-pulse` × 8 |
| PayrollSection | **FIXED** — `animate-pulse` skeleton bars (×4) replacing plain "Loading…" text |
| ReceiptRoll | No explicit loading state (receipts stream via realtime) |
| RecentActivity | **FIXED** — `animate-pulse` skeleton bars (×3) replacing plain "Loading..." text |
| InventoryTable | **FIXED** — `animate-pulse` skeleton bars (×4) replacing plain "Loading..." text |
| ParcelsMonitor | Centered spinner `h-8 w-8 rounded-full border-2 animate-spin` (intentionally distinct — full-screen kiosk) |

~~**Key Finding:** Five different loading patterns across six components. Should unify to a consistent skeleton card + optional spinner approach.~~ **FIXED** — All dashboard section components now use `animate-pulse` rounded skeleton bars. ParcelsMonitor retains its spinner (appropriate for full-screen kiosk). DashboardOverhaul stat values use inline `"…"` (values load fast, not worth a skeleton).

---

## 4. Proposed Style Guide

### 4.1 Card Token

```
Standard Card:
  bg-stone-900 border border-stone-800 rounded-xl overflow-hidden

Nested / Inset Card:
  bg-stone-950 border border-stone-800 rounded-xl

Accent Card (warning/info):
  bg-{color}-500/10 border border-{color}-500/30 rounded-xl
  Where {color} = amber | red | green | blue | purple
```

All cards should use `rounded-xl` (12px). Eliminate `rounded-lg` for cards.

### 4.2 Button Tokens

```
Primary Action (default):
  bg-amber-600 hover:bg-amber-500 text-white text-sm font-semibold
  px-4 py-2.5 min-h-[44px] rounded-xl transition-colors
  active:scale-[0.98]

Secondary / Outline:
  bg-transparent border border-stone-700 text-stone-300 text-sm font-medium
  px-4 py-2 min-h-[44px] rounded-xl transition-colors
  hover:border-stone-500 hover:text-white active:scale-[0.98]

Destructive:
  bg-red-500/10 border border-red-500/30 text-red-400 text-sm font-medium
  px-4 py-2 min-h-[44px] rounded-xl transition-colors
  hover:bg-red-500/20 active:scale-[0.98]

Ghost (icon-only):
  flex items-center justify-center w-11 min-h-[44px] rounded-xl
  bg-stone-900 border border-stone-800 text-stone-400
  hover:text-white hover:border-stone-600 transition-colors

Filter Pill:
  px-3 py-1.5 min-h-[36px] rounded-full text-xs font-semibold
  uppercase tracking-wider border transition-colors
  Active: bg-amber-500/20 border-amber-500/50 text-amber-300
  Inactive: bg-stone-900 border-stone-800 text-stone-500
           hover:border-stone-600 hover:text-stone-300
```

### 4.3 Table Token

```
Table Container:
  bg-stone-900 border border-stone-800 rounded-xl overflow-hidden

Table Header Row:
  bg-stone-800 px-5 py-2.5
  text-[11px] font-bold uppercase tracking-widest text-stone-500
  hidden md:grid  (collapse on mobile)

Table Data Row:
  px-5 py-3.5 border-t border-stone-800/60
  flex flex-col md:grid  (stack on mobile with inline labels)
  hover:bg-stone-800/40 transition-colors

Mobile Inline Label:
  md:hidden text-[11px] font-semibold text-stone-500 uppercase tracking-wider

Empty State:
  px-5 py-12 text-center text-stone-600 text-sm

Loading Skeleton Row:
  h-14 bg-stone-800 rounded-lg animate-pulse mx-5 my-2
```

### 4.4 Typography Scale (Ops Area)

```
Page Title (h1):      text-lg font-bold tracking-tight text-white
Section Title (h2):   text-lg font-semibold text-white
                      (Eliminate text-xl for h2; reserve text-xl for page-level only)
Card Header:          text-sm font-bold text-stone-100
Stat Value:           text-2xl font-bold tabular-nums
Stat Label:           text-xs text-stone-500
Body Text:            text-sm text-stone-300
Muted / Caption:      text-xs text-stone-500
Micro Label:          text-[10px] uppercase tracking-widest text-stone-600
```

### 4.5 Color Consolidation

| Semantic Name | Recommended Token | Replaces |
|---|---|---|
| `--surface` | `stone-900` / `bg-stone-900` | `#1a1a1a` |
| `--surface-deep` | `stone-950` / `bg-stone-950` | `#111` |
| `--surface-raised` | `stone-800` / `bg-stone-800` | `#222` |
| `--border` | `stone-800` / `border-stone-800` | `#333` |
| `--border-emphasis` | `stone-700` / `border-stone-700` | `#444` |
| `--text-primary` | `stone-100` / `text-stone-100` | `#f5f5f5`, `text-white` |
| `--text-secondary` | `stone-400` / `text-stone-400` | `text-gray-400` |
| `--text-muted` | `stone-500` / `text-stone-500` | `text-gray-500`, `text-gray-600` |
| `--accent` | `amber-500` | `--hub-tan`, `#f59e0b` |
| `--success` | `green-400` | `text-green-400` |
| `--danger` | `red-400` | `text-red-400` |
| `--info` | `blue-400` | `text-blue-400` |

**Directive:** Eliminate all raw `gray-*` usage in the ops area. Use the `stone-*` scale exclusively for neutral tones to maintain warm-dark consistency.

### 4.6 Spacing Rhythm

```
Tab content should use:  space-y-6  (consistent inter-section gap)
Card internal padding:   px-5 py-4  (standard)
Card header row:         px-5 min-h-[56px] flex items-center  (for sections with title bars)
Grid gap:                gap-3      (stat tiles, product grid)
                         gap-4      (detail layouts, form sections)
```

---

## Summary of Top-Priority Visual Fixes

1. ~~**Unify card border-radius**~~ — **DONE.** RecentActivity and InventoryTable promoted from `rounded-lg` to `rounded-xl`.
2. ~~**Replace hard-coded hex grays**~~ — **DONE.** All `#1a1a1a`/`#111`/`#222`/`#333`/`#444`/`#555`/`#f5f5f5` replaced with `stone-*` tokens across 9 files. ReceiptRoll scrollbar CSS also converted.
3. ~~**Eliminate `gray-*` usage**~~ — **DONE.** All `gray-*` tokens replaced with `stone-*` equivalents across 13 files (manager components, queue, staff-hub, portal).
4. ~~**Standardize 4 Refresh button variants**~~ — **DONE.** All Refresh buttons now use `<RefreshCw>` icon, `rounded-xl`, `min-h-[44px]` touch targets, `type="button"`, and `stone-*` tokens. DashboardOverhaul "Refresh Now" retains its intentionally larger big-action styling.
5. ~~**Standardize section header font size**~~ — **DONE.** CatalogManager and HiringViewer changed from `text-xl font-bold` to `text-lg font-semibold`.
6. ~~**Fix `pb-safe` class**~~ — **DONE.** `.pb-safe` defined in globals.css alongside `.safe-area-bottom`.
7. ~~**Add responsive collapse** to InventoryTable~~ — **DONE.** Grid changed to `grid-cols-2 md:grid-cols-4`; Threshold and Adjust columns hidden on mobile via `hidden md:block`.
8. ~~**Bring HiringViewer cards**~~ — **DONE.** Changed from `bg-stone-900/60` to `bg-stone-900` (dropped the `/60` opacity).
9. ~~**Resolve the blue button anomaly**~~ — **DONE.** CatalogManager `bg-blue-600` replaced with `bg-amber-600 hover:bg-amber-500` on both "+ Add New" and Save/Create buttons.
10. ~~**Improve contrast** on header date text (`text-stone-600` → `text-stone-400`) and ManagerQuickLinks divider (`text-stone-700` → `text-stone-600`)~~ — **DONE.** Date now `text-stone-400` (~5.5:1); ManagerQuickLinks divider `text-stone-600`; links `text-xs` with `min-h-[44px]` touch targets.
11. ~~**Unify `--hub-brown` / `--hub-espresso`**~~ — **DONE.** `--hub-brown` is now `var(--hub-espresso)`, single source of truth.
