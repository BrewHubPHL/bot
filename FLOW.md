# FLOW.md — End-to-End Order Pipeline Audit

> **Status: Read-Only Audit. Awaiting step-by-step approval for fixes.**
>
> **Date:** February 24, 2026
> **Auditor:** Lead Full-Stack QA & UI/UX Auditor
> **Scope:** [Home / Chatbot / POS / Shop Checkout] → [Routing Logic] → [KDS] → [Cafe Queue]

---

## Part 1: The Merch vs. KDS Routing

### 1A. Order Origin Map

There are **four order entry points**, each writing to the same `orders` table:

| Origin | Function | `type` set? | `status` | Coffee items? | Lands on KDS? |
|--------|----------|-------------|----------|---------------|---------------|
| **Chatbot** (Elise, home page) | `claude-chat.js` → `place_order` tool | ❌ No (defaults to `'cafe'` via DB) | `unpaid` | ✅ `coffee_orders` rows | ✅ Yes |
| **Cafe Page** (`/cafe`) | `cafe-checkout.js` | ❌ No (defaults to `'cafe'` via DB) | `paid` (online) | ✅ `coffee_orders` rows | ✅ Yes |
| **POS Terminal** (`/pos`) | `cafe-checkout.js` | ❌ No (defaults to `'cafe'` via DB) | `pending` (terminal) | ✅ `coffee_orders` rows | ✅ Yes |
| **Site Merch Checkout** (`/checkout`) | `process-merch-payment.js` | ✅ `type: 'merch'` | `paid` or `pending` | ❌ Items in `orders.items` JSONB only | ⚠️ **YES — Bug** |

### 1B. The KDS Routing Wall — CRITICAL FINDING

**`get-kds-orders.js` (line ~90) — the database query:**
```sql
.from('orders')
.select('id, customer_name, status, created_at, is_guest_order, total_amount_cents,
         coffee_orders(id, drink_name, customizations, price)')
.in('status', ['unpaid', 'pending', 'paid', 'preparing', 'ready'])
.order('created_at', { ascending: true })
.limit(200)
```

**There is NO `.neq('type', 'merch')` or `.eq('type', 'cafe')` filter.**

**Result:** When a customer buys a t-shirt on the website, `process-merch-payment.js` inserts an order with `type: 'merch'` and `status: 'paid'`. That order will appear on the KDS as a ticket with a customer name, a price, and **zero drink items** (because merch items are stored in `orders.items` JSONB, not in the `coffee_orders` table). Baristas will see ghost tickets they can't act on.

**The same gap exists in `get-queue.js`** — the public order queue display has no `type` filter, so merch orders will appear on the lobby screen as empty-item cards labeled "Waiting" or "Paid."

### 1C. Outbound Shipping Reality Check — CRITICAL FINDING

Business reality: **BrewHub ships merch from its own hub.** Here is what the system does vs. what it needs:

#### What EXISTS in the backend:
- `orders.shipping_address` column (added in `schema-18-ground-truth-reconciliation.sql`)
- `process-merch-payment.js` destructures `shippingAddress` from the request body (line 84) and writes it to `orders.shipping_address` (line 226)

#### What is MISSING from the frontend:
| Missing Element | Impact |
|----------------|--------|
| **Shipping address form fields** | `checkout/page.tsx` collects only: Name (optional), Email, Card. No street, city, state, zip. |
| **"Ship to Address" vs. "In-Store Pickup" toggle** | No `fulfillment_type` concept anywhere. Every order is implicitly pickup. |
| **Phone number field** | Required for shipping labels — not collected. |
| **`shippingAddress` in the fetch body** | The `submitPayment()` callback sends `{ cart, sourceId, customerEmail, customerName }` — no `shippingAddress` key. The backend will always store `null`. |
| **Fulfillment type column in schema** | No `fulfillment_type` column on the `orders` table. |
| **Outbound Fulfillment dashboard** | No staff-facing UI to view, pick, pack, or ship merch orders. |
| **Shipping confirmation email** | No email with tracking info is sent. Only "Check your email for a receipt." |

#### Data Flow Diagram (Current State):

```
Customer on /shop → adds merch to cart → /checkout
  ↓
  Collects: Email, Card
  Does NOT collect: Address, Phone, Fulfillment Type
  ↓
  POST /.netlify/functions/process-merch-payment
    → { cart, sourceId, customerEmail, customerName }
    → shippingAddress = undefined → stored as NULL
  ↓
  INSERT INTO orders (type='merch', status='paid', shipping_address=NULL, items=JSONB)
  ↓
  Order appears on KDS (bug) with 0 items
  Order appears on Queue (bug) with 0 items
  ↓
  No Outbound Fulfillment UI exists → order sits in DB with no routing
```

**Bottom line:** The backend is wired to accept and store `shipping_address`, but the frontend never collects or sends it. There is no fulfillment differentiation, no outbound fulfillment UI, and no routing to prevent merch orders from hitting the cafe KDS. The shipping pipeline is architecturally prepared but functionally inert.

---

## Part 2: Functional Gaps

### P2-A: Critical (Order Flow Integrity)

| ID | Category | Issue | Location |
|----|----------|-------|----------|
| **F-1** | KDS Leak | Merch orders (type='merch') appear on the KDS as ghost tickets with 0 items. No `type` filter in the DB query. | `get-kds-orders.js` line ~90 |
| **F-2** | Queue Leak | Merch orders appear on the public queue monitor with 0 items. No `type` filter. | `get-queue.js` line ~80 |
| **F-3** | Checkout Gap | No shipping address fields in the checkout form. `shippingAddress` is never sent to the backend. | `checkout/page.tsx` (entire form section, lines ~450–540) |
| **F-4** | Fulfillment Gap | No "Ship to Address" vs "In-Store Pickup" selector. No `fulfillment_type` column. | `checkout/page.tsx`, `orders` table schema |
| **F-5** | Dashboard Gap | No Outbound Fulfillment UI for staff to manage merch shipments. | No file exists |

### P2-B: High (Navigation & Links)

| ID | Category | Issue | Location |
|----|----------|-------|----------|
| **F-6** | Dead Anchor | Nav link `href="#location"` points to a non-existent anchor. The home page has no `id="location"` element. | `layout.tsx` line 19, `page.tsx` (no target) |
| **F-7** | Missing Nav | No link from the home page to `/cafe` (the online cafe ordering page) or `/queue` (order status). Customers can only find them by direct URL. | `layout.tsx` nav, `page.tsx` |
| **F-8** | `<a>` vs `<Link>` | Site layout uses raw `<a href>` tags for internal routes (`/shop`, `/about`, `/careers`), causing full page reloads instead of SPA client-side navigation. | `layout.tsx` lines 12–25 |
| **F-9** | Success Dead End | After merch checkout success, the only option is "Back to Home." No fulfillment details (pickup location, shipping estimate) and no order tracking link. | `checkout/page.tsx` lines ~345–365 |

### P2-C: Medium (Data Integrity & Edge Cases)

| ID | Category | Issue | Location |
|----|----------|-------|----------|
| **F-10** | Cart Key Collision | Shop page uses `item.name` as the cart key. If two products share a name, quantities merge incorrectly. | `ShopClient.tsx` `addToCart()` |
| **F-11** | Merch on POS | POS terminal cannot ring up merch items. Only cafe menu items from `merch_products` are displayed with drink categorization (`CATEGORIES` regex). A merch product named "BrewHub Tee" would fall to the `food` default category. | `pos/page.tsx` lines ~70–85 |
| **F-12** | Chatbot Order Type | Chatbot `place_order` does not stamp `type` on the order. It relies on the DB default (`'cafe'`). If the DB default ever changes, chatbot orders would be miscategorized. | `claude-chat.js` line ~470 |

---

## Part 3: UI/UX Critique

### 3A. Home Page (`/` — `page.tsx`)

| Verdict | Detail |
|---------|--------|
| ✅ Good | Premium splash screen with logo animation sets a boutique tone. |
| ✅ Good | Glass-morphism nav is visually cohesive and fixed-position. |
| ✅ Good | Elise chatbot is embedded directly in the landing — zero friction to interact. |
| ✅ Good | Voice chat toggle is clearly labeled with emoji state (`🎤` / `🛑`). |
| ✅ Good | Confetti on waitlist join is a delightful micro-interaction. |
| ✅ Good | `linkify()` sanitizes chat URLs preventing DOM XSS while keeping links clickable. |
| ❌ Bad | No visible link to `/cafe` (online ordering) or `/queue` (order status) from the home page. |
| ❌ Bad | `#location` nav link scrolls nowhere — anchor target doesn't exist on the page. |
| ❌ Bad | Chat box (`concierge-chatbox`) relies on `ref.scrollTop` for auto-scroll. On very small mobile screens, the chat area + Send button + Voice button may stack and push the chatbox off-screen. |
| ❌ Bad | Voice status text (`voiceStatus`) has no ARIA live region — screen readers won't announce "Listening…" or "Elise is speaking…" changes. |

### 3B. Shop Page (`/shop` — `ShopClient.tsx`)

| Verdict | Detail |
|---------|--------|
| ✅ Good | Segmented control (Cafe Menu / Merch & Beans) with item counts is excellent for dual-purpose shop. |
| ✅ Good | Product cards have clean visual hierarchy: image → name → price → description → CTA. |
| ✅ Good | Cart drawer slide-in with overlay is smooth. Close/open is keyboard-accessible. |
| ✅ Good | `env(safe-area-inset-bottom)` on the floating cart button — proper iPhone notch awareness. |
| ✅ Good | Graceful maintenance and "Shop Resting" fallback states with clear CTAs. |
| ✅ Good | ISR with `revalidate = 60` eliminates connection pool DoS — smart performance decision. |
| ✅ Good | Image error fallback to emoji placeholders (`getEmoji()`) prevents broken image tiles. |
| ❌ Bad | **No fulfillment context on merch items.** A customer adds a t-shirt expecting to ship it — nothing indicates whether it's pickup-only or shippable. |
| ❌ Bad | "Proceed to Checkout" goes to a payment form with no address collection. |
| ❌ Bad | Product description is truncated to 2 lines (`line-clamp-2`) with no "read more" — customers may miss important sizing/material info. |

### 3C. Checkout Page (`/checkout` — `checkout/page.tsx`)

| Verdict | Detail |
|---------|--------|
| ✅ Good | Square SDK integration with Apple Pay + Google Pay express checkout is polished. |
| ✅ Good | Payment finality polling is robust: per-fetch timeouts, hard deadline (45s), exponential checks. |
| ✅ Good | SDK load timeout (10s) with user-facing error message prevents infinite loading. |
| ✅ Good | Two-column layout (Order Summary | Payment) on desktop is clean and scannable. |
| ✅ Good | Finality status bar (amber banner with spinner) keeps the user informed during processing. |
| ✅ Good | "Payments secured by Square" trust signal at the bottom of the form. |
| ❌ Bad | **CRITICAL: No shipping address form.** This is the single biggest UX gap for a business that ships merch. |
| ❌ Bad | **No fulfillment type selector** — "Ship to Address" vs "Pick Up In Store" toggle is absent. |
| ❌ Bad | **No phone number field** — required for shipping labels and delivery coordination. |
| ❌ Bad | "Name (optional)" should be required for shipping orders. |
| ❌ Bad | Success page shows "Check your email for a receipt and updates" but provides no pickup address, no shipping estimate, no tracking link. |
| ❌ Bad | Empty cart state links to `/shop` but doesn't preserve tab state (user might have been browsing merch). |

### 3D. POS Terminal (`/pos` — `pos/page.tsx`)

| Verdict | Detail |
|---------|--------|
| ✅ Good | Sophisticated offline mode: local session management, $200 cap, recovery report on reconnect. |
| ✅ Good | Haptic feedback patterns (`tap`, `success`, `error`) enhance tactile POS experience on tablets. |
| ✅ Good | Guest first-name modal ensures every order gets a callout name for the barista. |
| ✅ Good | Loyalty scanner integration (QR) with customer points display. |
| ✅ Good | Swipeable cart items (`SwipeCartItem`) — touch-first design for counter use. |
| ✅ Good | Onscreen keyboard component for tablet kiosk scenarios without a physical keyboard. |
| ✅ Good | Offline order queue with sync-on-reconnect and order deduplication. |
| ❌ Bad | **Only serves cafe items.** Staff cannot ring up merch at the register — must redirect customers to the website. |
| ❌ Bad | Single 1,909-line component — significant maintenance and code-splitting concern. |
| ❌ Bad | `CATEGORIES` regex for product classification is fragile — a new product named "Iced Tea" would match `cold` but an "Herbal Blend" would fall to the default `food` category. |

### 3E. KDS (`/kds` — `KdsGrid.tsx` + `KdsOrderCard.tsx`)

| Verdict | Detail |
|---------|--------|
| ✅ Good | **Dark theme with excellent contrast** — ideal for kitchen display visibility. |
| ✅ Good | Status-coloured top borders are instantly readable: orange = unpaid, emerald = paid, amber = preparing, sky = ready. |
| ✅ Good | **Urgency rings are brilliant:** >5 min = amber ring, >10 min = pulsing red ring. Baristas see stale orders at a glance. |
| ✅ Good | Per-item checkbox ticking allows baristas to track individual drink prep within a multi-item order. |
| ✅ Good | "All Items Done" badge auto-appears with dimmed opacity — clear visual signal the ticket is ready to advance. |
| ✅ Good | Optimistic status updates with full snapshot rollback on API failure — no UI lag. |
| ✅ Good | Realtime Supabase channel subscription for instant new-order appearance. |
| ✅ Good | IndexedDB cache fallback with "cached" indicator when offline — orders don't vanish. |
| ✅ Good | Toast notifications on status changes with haptic feedback. |
| ✅ Good | Smooth exit animations (opacity fade + scale + translateY) on completed orders. |
| ✅ Good | Guest orders have clear "Unpaid — Collect at counter" banner with ⚠️ icon. |
| ❌ Bad | **CRITICAL: Merch orders leak onto KDS** as tickets with a customer name, a dollar amount, and 0 drink items. `get-kds-orders.js` has no `type` filter. |
| ❌ Bad | No audio chime on new order arrival — a common and expected KDS feature for busy kitchens. |
| ❌ Bad | Orders are not grouped or sorted by status priority. A 15-minute-old `unpaid` order and a new `paid` order render side-by-side in the same flat grid, differing only by border color and urgency ring. |
| ❌ Bad | No visual distinction between a cafe order and a (leaked) merch order — they use the same card layout. |

### 3F. Queue Page (`/queue` — `queue/page.tsx`)

| Verdict | Detail |
|---------|--------|
| ✅ Good | Auto-fullscreen on mount — perfect for a wall-mounted lobby display. |
| ✅ Good | Status-segmented sections (Complete → Ready → Making → Waiting) give clear visual hierarchy. |
| ✅ Good | Per-status animations: ready = blue pulse, completed = green glow, unpaid = red blink. Customers can spot their order from across the room. |
| ✅ Good | 10-second polling with live indicator dot (green pulsing vs red static). |
| ✅ Good | Auto-expire completed orders after 15 minutes keeps the board clean. |
| ✅ Good | Excellent empty state: ☕ emoji with "Queue is clear!" and "New orders will appear here automatically." |
| ✅ Good | Full `aria-live="polite"` on the queue main area — screen readers announce changes. |
| ✅ Good | Order tags (`BRW-XX12`) are short, memorable identifiers derived from the UUID. |
| ❌ Bad | **Merch orders will appear** with 0 items (coffee_orders join returns empty). Ghost cards on a customer-facing display. |
| ❌ Bad | No audio/visual notification when an order moves to "Ready" — customers must watch the screen continuously. |
| ❌ Bad | Exit fullscreen button is nearly invisible (`opacity-30`, 5×5 px) — difficult to discover if staff needs to exit. |
| ❌ Bad | `SECTION_CFG` uses emoji in section labels (✅ 🔔 🔥 ⏳). While fun, emoji rendering differs across OS/hardware and may look broken on older lobby TVs running Chrome/Android. |

---

## Summary of Critical Actions Required

| Priority | Action | Affected Files |
|----------|--------|----------------|
| ✅ RESOLVED | Add `.neq('type', 'merch')` filter to `get-kds-orders.js` and `get-queue.js` to prevent merch orders from appearing on cafe displays. | `get-kds-orders.js`, `get-queue.js` |
| ✅ RESOLVED | Add shipping address form, phone number, and "Ship / Pickup" fulfillment toggle to the merch checkout page. Wire `shippingAddress` + `fulfillmentType` into the `submitPayment()` fetch body. *Implemented: fulfillment toggle, conditional shipping fields with validation, payload wired to backend.* | `checkout/page.tsx` |
| ✅ RESOLVED | Add `fulfillment_type` column to the `orders` table. Update `process-merch-payment.js` to store it. *Implemented: backend now destructures `fulfillmentType`, writes `fulfillment_type` to the order row.* | New schema migration, `process-merch-payment.js` |
| ✅ RESOLVED | Build an Outbound Fulfillment dashboard for staff to view/manage merch shipping orders. *Implemented: `get-fulfillment-orders.js` Netlify function, `manager/fulfillment/page.tsx` with To Pack / History tabs, Mark as Shipped action, optimistic UI, card-based layout with address display. Added `shipped` to allowed statuses in `update-order-status.js`. Integrated as a tab in the Manager Dashboard + quick link in ManagerNav.* | `manager/fulfillment/page.tsx`, `get-fulfillment-orders.js`, `update-order-status.js` |
| ✅ RESOLVED | Fix `#location` nav anchor — added `id="location"` section to homepage with "Coming Soon" content (property secured, building out). Nav link updated to `/#location` for cross-page scroll. | `layout.tsx`, `page.tsx` |
| ✅ RESOLVED | Replace `<a>` tags with Next.js `<Link>` in site layout for SPA navigation. *All internal nav/footer links converted to `<Link>` (external links and `mailto:` kept as `<a>`). Added "Order Cafe" link to header nav + mobile menu.* | `layout.tsx` |
| ✅ RESOLVED | Add `/cafe` and `/queue` links to the home page and/or nav. *`/cafe` added to global header nav as "Order Cafe". `/queue` not added to nav (utility page, not marketing) — instead, chatbot `place_order` response now includes live queue tracking link. Resident portal orders & parcels connected to Supabase Realtime for live updates.* | `layout.tsx`, `page.tsx`, `claude-chat.js`, `portal/page.tsx` |
| 🟡 P2 | Add audio chime to KDS on new order arrival. | `KdsGrid.tsx` |
| ✅ RESOLVED | Stamp `type: 'cafe'` explicitly in chatbot and cafe-checkout order inserts (defense-in-depth). | `claude-chat.js`, `cafe-checkout.js` |
