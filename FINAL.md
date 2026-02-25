# FINAL AUDIT — BrewHubPHL Full-Stack Polish

> Source of Truth for the end-to-end codebase audit.
> Each flow is validated FE ↔ BE before marking complete.

---

## Flow 1: Guest/Resident Cafe Order (Chatbot & Site)

**Path:** FE UI → Netlify `claude-chat` / `cafe-checkout` → Supabase DB → FE KDS / Queue

- [x] 1.1 — Chatbot order initiation (UI state, message contract)
- [x] 1.2 — `claude-chat` Netlify function request/response schema
- [x] 1.3 — `cafe-checkout` Netlify function (payment + order creation)
- [x] 1.4 — Supabase order row insertion & RLS validation
- [x] 1.5 — KDS real-time subscription & order rendering
- [x] 1.6 — Queue status updates (in-progress → ready → picked-up)
- [x] 1.7 — Error / edge-case handling (network failure, duplicate submit, empty cart)

---

## Flow 2: Merch Outbound Fulfillment

**Path:** FE Checkout UI → Netlify `process-merch-payment` → DB → FE Ops Fulfillment Board

- [x] 2.1 — Merch product listing & cart UI state
- [x] 2.2 — Checkout form validation & submission
- [x] 2.3 — `process-merch-payment` Netlify function (Square payment + DB write)
- [x] 2.4 — Supabase merch order row & inventory decrement
- [x] 2.5 — Fulfillment Board real-time feed & status transitions
- [x] 2.6 — Shipping / pickup toggle logic
- [x] 2.7 — Error / edge-case handling (out-of-stock, payment failure, partial fulfillment)

---

## Flow 3: Inbound Parcel Logistics

**Path:** Netlify Webhook / DB → FE Manager Monitor → FE Pickup Auth → DB

- [x] 3.1 — Inbound parcel webhook ingestion & DB write _(F3.1-A: External carrier webhooks — WONTFIX; relying on staff check-ins for launch)_
- [x] 3.2 — Manager monitor real-time parcel list _(F3.2-E: departure board .limit(100) added)_
- [x] 3.3 — Resident notification trigger _(F3.3-A/B: pickup_code + value_tier in email & SMS)_
- [x] 3.4 — Pickup authorization flow (resident ID verification)
- [x] 3.5 — Parcel status lifecycle (received → notified → picked-up) _(F3.5-A/B: portal filtered to arrived only)_
- [x] 3.6 — Error / edge-case handling _(F3.6-C: harden parcel index; F3.3-E/F3.6-B: dead-letter + stale UI for staff; F3.6-D: stale parcel visual warning)_

---

## Flow 4: POS Terminal & Cashier Operations

**Path:** FE POS UI → Offline Mode Logic → Netlify → DB

- [x] 4.1 — POS product grid & cart interaction
- [x] 4.2 — Payment method selection (cash, card, comp)
- [x] 4.3 — Offline mode queue & sync logic
- [x] 4.4 — Netlify POS transaction function
- [x] 4.5 — Supabase transaction record & till reconciliation
- [x] 4.6 — Receipt generation & reprint
- [x] 4.7 — Error / edge-case handling (offline sync conflict, drawer mismatch, void/refund)

---

## Flow 5: Core App Polish

**Path:** 404 pages, loading states, stray `console.log`s, dead code cleanup

- [x] 5.1 — Custom 404 / not-found page presence & styling _(present at src/app/not-found.tsx; inline-styled, functional)_
- [x] 5.2 — Global loading / skeleton states audit _(zero loading.tsx files; inline spinners cover critical ops paths; portal has best skeleton coverage)_
- [x] 5.3 — Stray `console.log` / `console.warn` / `console.error` removal _(removed PII-leaking SMS body log, marketing/sheets data dumps — 14 debug logs scrubbed)_
- [x] 5.4 — Dead / unreachable code identification _(deleted MobileNav.tsx, InventoryTable.tsx, RecentActivity.tsx)_
- [x] 5.5 — Unused imports & dependencies cleanup _(removed Video, VideoOff, Minus, Trash2, Clock from POS imports)_
- [x] 5.6 — TypeScript `any` / type-safety spot check _(converted 2 catch(: any) to catch(: unknown) in careers/page.tsx; checkout/page.tsx clean)_
- [x] 5.7 — Accessibility quick-pass (alt text, aria labels, focus order) _(added role=dialog, aria-modal, aria-label, Escape key handler to cart drawer)_

---

_All flows complete._
