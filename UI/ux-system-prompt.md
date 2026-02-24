# BrewHub PHL — Frontend UI/UX Audit Workbook
> **Methodology:** Four-phase slice of the Next.js app, ordered by revenue impact.  
> **Audit session date:** 2026-02-23  
> **Status key:** `⬜ Pending` · `🔍 In Review` · `✅ Fixed` · `⚠️ Needs Follow-up` · `🚫 Deferred`

---

## Universal Hunt Checklist
Run these four checks against **every** file before marking it complete.

| ID | Check | What to look for |
|----|-------|-----------------|
| FE-L1 | **`any` Type Purge** | Replace every `any` with a strict interface or union type. Search: `Promise<any>`, `: any`, `as any`. |
| FE-L2 | **Loading States** | Every async fetch needs a spinner, a disabled button, or a skeleton. No frozen screens. |
| FE-L3 | **Graceful Degradation** | Broken images → smooth fallback. Network drop → error message, not infinite spin. 429 → exponential backoff + user-visible toast. |
| FE-L4 | **Tap Targets & Mobile UI** | Min 44×44 px buttons. Padding tested at iPhone SE (375 px) and iPad Pro (1024 px). |

---

## Phase 1 — The Money Makers (Customer-Facing)
> Revenue-critical. A broken flow here = lost sale.

### `/cafe` — Mobile Ordering
| # | Finding | File(s) | Severity | Status |
|---|---------|---------|----------|--------|
| U-003 | Cart lost on refresh — no localStorage persistence | cafe/page.tsx | High | ✅ Fixed 2026-02-23 |
| U-004 | "Add" button ~24px height, under 44px touch target | cafe/page.tsx | Medium | ✅ Fixed 2026-02-23 |
| U-005 | "Remove" button is bare text, no min-height | cafe/page.tsx | Medium | ✅ Fixed 2026-02-23 |
| U-006 | `orderStatus` renders success & error in same gray style | cafe/page.tsx | Low | ✅ Fixed 2026-02-23 |
| U-007 | Staff-only nav links (`/scanner`, `/manager`, `/parcels`) exposed in customer header | cafe/page.tsx | Medium | ✅ Fixed 2026-02-23 |
| U-008 | `<img src="/logo.png">` has no `onError` fallback | cafe/page.tsx | Low | ✅ Fixed 2026-02-23 |

**Checklist**
- [x] FE-L1 `any` purge
- [x] FE-L2 Loading state on menu fetch + spinner
- [x] FE-L3 Square/DB failure → user-visible `orderError` (red)
- [x] FE-L4 Add button `min-h-[44px]`, Remove button `min-h-[44px] px-3`
- [x] Cart persists across reload (localStorage `brewhub_cafe_cart`, cleared on success)
- [x] Staff nav links removed from customer-facing header

---

### `/shop` — Merch Storefront
| # | Finding | File(s) | Severity | Status |
|---|---------|---------|----------|--------|
| U-009 | Product `<img>` has no `onError` fallback — broken Supabase URL shows broken-image icon | ShopClient.tsx | Medium | ✅ Fixed 2026-02-23 |
| U-010 | Cart identity keyed by `item.name` string — two products with identical names merge incorrectly | ShopClient.tsx | Low | ⚠️ Needs Follow-up (requires product ID on CartItem) |

**Checklist**
- [x] FE-L1 `any` purge
- [x] FE-L2 Skeleton loaders (products arrive via ISR, no client fetch needed)
- [x] FE-L3 Image `onError` → `failedImages` Set drives emoji fallback
- [x] FE-L4 Product card Add button `py-3` adequate; cart qty +/− `min-h-[48px]` ✅
- [x] Filter/sort controls accessible via keyboard
- [ ] U-010 cart key by product ID (deferred — requires API schema change)

---

### `/checkout` & `/thank-you` — Conversion Funnel
| # | Finding | File(s) | Severity | Status |
|---|---------|---------|----------|--------|
| U-011 | 5× `useRef<any>` for Square SDK refs (`cardRef`, `paymentsRef`, `applePayRef`, `googlePayRef`, `walletPaymentRequestRef`) | checkout/page.tsx | High | ✅ Fixed 2026-02-23 |
| U-012 | `catch (err: any)` in `submitPayment`, `handleSubmit`, `handleWalletPayment` | checkout/page.tsx | High | ✅ Fixed 2026-02-23 |
| U-013 | `Window.Square?: any` global interface | checkout/page.tsx | High | ✅ Fixed 2026-02-23 |
| U-014 | Square SDK never-loads: `squareReady` never fires → card shows "Loading..." forever | checkout/page.tsx | Medium | ✅ Fixed 2026-02-23 |

**Notes on U-011/U-012/U-013:** Replaced with a minimal `SquareCard / SquarePaymentMethod / SquarePaymentRequest / SquarePayments` interface block. All `err: any` → `unknown` with `instanceof Error` narrowing.  
**Notes on U-014:** 10 s `setTimeout` sets `squareLoadError` if `squareReady` never fires; shows actionable error message in UI.

**Checklist (`/checkout`)**
- [x] FE-L1 `any` purge — all Square refs + catch blocks typed
- [x] FE-L2 Submit button disabled + `Loader2` spinner during processing
- [x] FE-L3 Square load timeout → user-visible error after 10 s
- [x] FE-L4 Button `py-4`, inputs `py-3` — adequate
- [x] Double-submit guarded by `loading` + `walletProcessing` flags

**Checklist (`/thank-you`)**
- [x] Static page — no async, no issues found

---

### `/` — Homepage & Chat UI
| # | Finding | File(s) | Severity | Status |
|---|---------|---------|----------|--------|
| U-015 | No typing indicator during text chat — UI appears frozen while Claude responds | page.tsx | High | ✅ Fixed 2026-02-23 |
| U-016 | `(audioRef.current as any).stop?.()` / `.pause?.()` — incorrect `any` casts | page.tsx | Medium | ✅ Fixed 2026-02-23 |
| U-017 | `messages` state `role` typed as implicit `string` instead of `'user' \| 'assistant'` | page.tsx | Medium | ✅ Fixed 2026-02-23 |
| U-018 | Waitlist insert error not surfaced to user — silent failure on DB error / duplicate email | page.tsx | Medium | ✅ Fixed 2026-02-23 |
| U-019 | `.concierge-send-btn` (~40px) and `.voice-btn` (~37px) both under 44px min tap target | globals.css | Low | ✅ Fixed 2026-02-23 |

**Notes on U-015:** Added `chatTyping` state; `handleTextChat` sets it during Claude fetch; renders `···` typing bubble in chatbox and scrolls it into view.  
**Notes on U-016:** `audioRef` re-typed as `useRef<HTMLAudioElement \| AudioBufferSourceNode \| null>`. `stopVoiceSession` uses `instanceof` narrowing.  
**Notes on U-017:** `type ChatMessage = { role: 'user' \| 'assistant'; content: string }` added above component; `messagesRef` typed accordingly.  
**Notes on U-018:** `handleWaitlist` catches `error.code === '23505'` (duplicate) and generic errors; displays inline below form.  
**Notes on U-019:** `min-height: 44px` added to `.concierge-send-btn`, `.voice-btn`, `.concierge-input` in globals.css.

**Checklist**
- [x] FE-L1 `any` purge — `audioRef` type fixed, `messages` role typed
- [x] FE-L2 `chatTyping` `···` bubble — no more frozen UI perception
- [x] FE-L3 WebSocket/SSE drop → handled by `sendToClaude` error fallback ✅; waitlist error now shown
- [x] FE-L4 `min-height: 44px` on send btn, voice btn, chat input

---

## Phase 2 — The VIP Experience (Residents & Loyalty)
> Recurring revenue and community moat.

### `/portal` — Loyalty Wallet & Parcels
| # | Finding | File(s) | Severity | Status |
|---|---------|---------|----------|--------|
| U-020 | Auth-gate logo `<img>` has no `onError` fallback | portal/page.tsx | Low | ✅ Fixed 2026-02-23 |
| U-021 | QR code `<img>` has no `onError` fallback and no skeleton while `dataLoading` | portal/page.tsx | Medium | ✅ Fixed 2026-02-23 |
| U-022 | Sign-out button has no `min-h-[44px]` — tap target under spec | portal/page.tsx | Medium | ✅ Fixed 2026-02-23 |
| U-023 | Print Keychain button under 44px | portal/page.tsx | Low | ✅ Fixed 2026-02-23 |
| U-024 | Loyalty cup count renders empty while `dataLoading` — no skeleton | portal/page.tsx | Low | ✅ Fixed 2026-02-23 |
| U-025 | Auth errors expose raw Supabase message strings (e.g. `"User already registered"`) | portal/page.tsx | Medium | ✅ Fixed 2026-02-23 |

**Checklist**
- [x] FE-L1 `any` purge
- [x] FE-L2 Loyalty points + QR code wrapped in `dataLoading ? <Skeleton> : value`
- [x] FE-L3 QR `onError` → user ID fallback; auth error mapping to human-readable strings
- [x] FE-L4 Sign-out `min-h-[44px] min-w-[44px]`; Print Keychain `min-h-[44px]`
- [x] Login flow: friendly error messages for all Supabase auth error variants

---

### `/resident` — Onboarding
| # | Finding | File(s) | Severity | Status |
|---|---------|---------|----------|--------|
| U-026 | `handleRegister` exposes raw Supabase `23505`/`already registered` error strings | resident/page.tsx | Medium | ✅ Fixed 2026-02-23 |
| U-027 | All 6 form inputs use `p-3` (~40px) — under 44px spec | resident/page.tsx | Medium | ✅ Fixed 2026-02-23 |
| U-028 | Submit button `py-3` (~40px) — under 44px spec | resident/page.tsx | Medium | ✅ Fixed 2026-02-23 |
| U-029 | Form rendered on top of success message — should be hidden after success | resident/page.tsx | Low | ✅ Fixed 2026-02-23 |
| U-030 | Error div missing `role="alert"` — screen readers don't announce validation errors | resident/page.tsx | Low | ✅ Fixed 2026-02-23 |

**Checklist**
- [x] FE-L1 `any` purge
- [x] FE-L2 `loading` state disables submit, shows "Registering…"
- [x] FE-L3 Duplicate email → "An account with this email already exists." (not raw 23505)
- [x] FE-L4 All 6 inputs + submit button `min-h-[44px]`
- [x] Form hidden after success; `role="alert"` on error div

---

### `/waitlist`
| # | Finding | File(s) | Severity | Status |
|---|---------|---------|----------|--------|
| U-031 | `setError(insertError.message)` exposes raw Supabase DB error text; no `23505` mapping | waitlist/page.tsx | Medium | ✅ Fixed 2026-02-23 |
| U-032 | Email input `p-3` (~40px) — under 44px tap target | waitlist/page.tsx | Low | ✅ Fixed 2026-02-23 |
| U-033 | Submit button `py-3` (~40px); error div missing `role="alert"` | waitlist/page.tsx | Low | ✅ Fixed 2026-02-23 |

**Checklist**
- [x] FE-L1 `any` purge
- [x] FE-L2 Submit spinner + disabled state while loading
- [x] FE-L3 Duplicate email → "You're already on the list!" (not raw error); form gated behind success
- [x] FE-L4 Input `min-h-[44px]`; button `min-h-[44px]`
- [x] `role="alert"` on error div

---

### `/parcels/monitor` — TV Display
| # | Finding | File(s) | Severity | Status |
|---|---------|---------|----------|--------|
| U-034 | Error and stale banners missing ARIA live roles — connection state invisible to screen readers | monitor/page.tsx | Low | ✅ Fixed 2026-02-23 |
| U-035 | Carrier color dot `<span>` conveys carrier identity via color alone — no `aria-label` | monitor/page.tsx | Low | ✅ Fixed 2026-02-23 |

**Notes:** Monitor is very well built (adaptive backoff, burn-in prevention, 4K scaling, Visibility API pause). Minimal findings.

**Checklist**
- [x] FE-L1 `any` purge
- [x] FE-L2 Polling last-updated timestamp visible in stale banner
- [x] FE-L3 Adaptive backoff on error; `role="alert"` on error banner; `role="status"` on stale banner
- [x] FE-L4 Text `text-2xl`+ at base, scales via `.monitor-4k-scale`; WCAG contrast ✅
- [x] `aria-label` on carrier dot spans

---

## Phase 3 — The Engine Room (Staff Ops)
> Full state-management sweep. Memory leaks and scanner input drops.

### `/pos` — Point of Sale
| # | Finding | File(s) | Severity | Status |
|---|---------|---------|----------|--------|
| U-036 | `(window as any).BarcodeDetector` — `any` cast on experimental API | pos/page.tsx | Medium | ✅ Fixed 2026-02-23 |

**Notes:** POS is otherwise excellent. Full ARIA: `<aside aria-label="Menu categories">`, `<nav aria-label="Product categories">`, `<main aria-label="Product selection">`, `<aside aria-label="Order cart">`, `role="dialog"` with `aria-labelledby` on guest modal, `role="list"` on cart, `aria-hidden="true"` on decorative elements. All `useEffect` hooks have cleanup. All catches are `err: unknown`. Offline mode, sync-on-reconnect, and recovery report implemented.

**Checklist**
- [x] FE-L1 `any` purge — `BarcodeDetector` ambient type added, cast removed
- [x] FE-L2 Payment processing → full-screen modal lock (no accidental tap-away)
- [x] FE-L3 Network drop mid-transaction → offline session + explicit "offline" banner
- [x] FE-L4 All tap targets ≥ 44 px verified
- [x] ARIA: `<main>`, `<nav>`, `<aside>` landmarks fully present
- [x] `useEffect` cleanup: all intervals/subscriptions cleaned up
- [x] No stale closures — cart state managed via refs and closures correctly

---

### `/kds` — Kitchen Display System
| # | Finding | File(s) | Severity | Status |
|---|---------|---------|----------|--------|
| U-037 | Error `<p>` in header missing `role="alert"` — screen readers don't announce update failures | kds/page.tsx | Low | ✅ Fixed 2026-02-23 |
| U-038 | Toast `<div>` missing ARIA live role — announcements silent to screen readers | kds/page.tsx | Low | ✅ Fixed 2026-02-23 |

**Notes:** KDS is very well built. `aria-live="polite"` on orders grid, `role="article"` + full `aria-label` on each order card, `aria-hidden="true"` on ping dot, `min-h-[48px]` on all action buttons, full Supabase Realtime cleanup with `supabase.removeChannel()`, optimistic update with rollback, offline IndexedDB snapshot, urgency ring for late orders.

**Checklist**
- [x] FE-L1 `any` purge
- [x] FE-L2 Order card status transitions animated (exit scale+fade via `exitingIds`)
- [x] FE-L3 Realtime subscription drop handled; `role="alert"` on error `<p>`;  `role={error?"alert":"status"}` on toast
- [x] FE-L4 Card text `text-2xl`+; button `min-h-[48px]`; status badge color hierarchy ✅
- [x] Supabase realtime subscription cleaned up
- [x] Optimistic update rolls back correctly on server error

---

### `/scanner` — Hardware Bridging
| # | Finding | File(s) | Severity | Status |
|---|---------|---------|----------|--------|
| U-039 | `(window as any).BarcodeDetector` — `any` cast on experimental API | scanner/page.tsx | Medium | ✅ Fixed 2026-02-23 |
| U-040 | Outer wrapper `<div>` instead of `<main>` — no landmark for assistive tech | scanner/page.tsx | Low | ✅ Fixed 2026-02-23 |
| U-041 | Logo `<img>` has no `onError` fallback | scanner/page.tsx | Low | ✅ Fixed 2026-02-23 |

**Notes:** Scanner is solid. `scanLockRef` provides char-drop / double-scan protection (3-sec cooldown + 1.5s lock). All `useEffect` hooks clean up via `stopCamera()`. Camera cleanup on unmount. `catch (err: unknown)` throughout. Manual-entry fallback input available.

**Checklist**
- [x] FE-L1 `any` purge — `BarcodeDetector` ambient type, cast removed
- [x] FE-L2 Scan lock visual — `scanLockRef` prevents duplicate scan processing
- [x] FE-L3 `BarcodeDetector` unavailable → graceful fallback message shown
- [x] FE-L4 Manual-entry fallback input present; camera-based UX on fullscreen kiosk
- [x] Camera cleanup on unmount via `useEffect(() => () => stopCamera(), [stopCamera])`
- [x] `scanLockRef` + cooldown protect against rapid successive scan char-drop

---

## Phase 4 — The Control Room (Management)
> Dashboard components must fail independently without crashing the layout.

### `PayrollSection.tsx` ✅ Step-up auth complete
| # | Finding | File(s) | Severity | Status |
|---|---------|---------|----------|--------|
| 1 | 403 challenge threw raw error to UI instead of triggering modal | PayrollSection.tsx | High | ✅ Fixed 2026-02-23 |
| 2 | Missing `reason` field caused silent 400 on fix-clock endpoint | PayrollSection.tsx | High | ✅ Fixed 2026-02-23 |

**Checklist**
- [x] FE-L1 `any` purge
- [x] FE-L2 `fixBusy` spinner on Save Clock-Out
- [x] FE-L3 403 challenge → `ManagerChallengeModal` step-up, not red error text
- [x] FE-L4 Fix form inputs full-width, Reason field added to both call sites
- [x] `handleChallengeSuccess` replays request with nonce in header + body

---

### `CatalogManager.tsx`
| # | Finding | File(s) | Severity | Status |
|---|---------|---------|----------|--------|
| U-042 | `catch (err)` implicit `any` in `fetchProducts` handler | CatalogManager.tsx | Medium | ✅ Fixed 2026-02-23 |

**Notes:** CatalogManager is comprehensive. Full skeleton loading, drag-and-drop sort, archive/restore, category management, image upload with Supabase Storage, optimistic updates with rollback. All other `catch` blocks already use `err: unknown`. ARIA: `aria-label="Close drawer"`, `aria-hidden` on decorative emoji.

**Checklist**
- [x] FE-L1 `any` purge — remaining implicit `catch (err)` → `catch (err: unknown)`
- [x] FE-L2 Skeleton spinner on catalog load; per-row busy state on save
- [x] FE-L3 Image upload failure → inline error shown; original image preserved
- [x] FE-L4 Bulk action buttons full-width; drawer close button `aria-label`
- [x] Optimistic UI updates roll back correctly on server error

---

### `InventoryTable.tsx`
| # | Finding | File(s) | Severity | Status |
|---|---------|---------|----------|--------|
| U-043 | `useState<any[]>` for inventory rows — no typed interface | InventoryTable.tsx | Medium | ✅ Fixed 2026-02-23 |
| U-044 | Refresh button `py-1` (~32px) — under 44px tap target | InventoryTable.tsx | Low | ✅ Fixed 2026-02-23 |

**Checklist**
- [x] FE-L1 `any` purge — `InventoryItem` interface added; `useState<InventoryItem[]>`
- [x] FE-L2 `loading` state shows "Loading…" placeholder row
- [x] FE-L3 Fetch error logged; empty state shown
- [x] FE-L4 Refresh button `min-h-[44px]`; table horizontally in `overflow-hidden`

---

### `StatsGrid.tsx` & `RecentActivity.tsx`
| # | Finding | File(s) | Severity | Status |
|---|---------|---------|----------|--------|
| U-045 | `StatsGrid` silently swallows fetch error — user sees `$0.00` with no indication of failure | StatsGrid.tsx | Medium | ✅ Fixed 2026-02-23 |
| U-046 | `RecentActivity` uses `useState<any[]>` + `map((o: any)` / `map((i: any)` — untyped event shapes | RecentActivity.tsx | Medium | ✅ Fixed 2026-02-23 |

**Checklist**
- [x] FE-L1 `any` purge — `ActivityEvent`, `OrderRecord`, `InventoryRecord` interfaces; `useState<ActivityEvent[]>`
- [x] FE-L2 `loading ? '...' : value` on all stat tiles
- [x] FE-L3 `fetchError` state: `role="alert"` error paragraph renders above grid on failure
- [x] FE-L4 Grid reflows to 1-col on mobile via `grid-cols-1 md:grid-cols-4`

---

## Findings Log (All Phases)
> Append every finding here as a single source of truth.

| ID | Phase | Route / Component | Check | Description | Severity | Status | Fixed In |
|----|-------|-------------------|-------|-------------|----------|--------|----------|
| U-001 | 4 | `PayrollSection.tsx` | FE-L3 | 403 challenge not caught; raw error shown in UI | High | ✅ Fixed | 2026-02-23 |
| U-002 | 4 | `PayrollSection.tsx` | FE-L3 | `reason` field absent from fix-clock request body | High | ✅ Fixed | 2026-02-23 |
| U-003 | 1 | `/cafe` | FE-L4 | Cart lost on refresh — no localStorage persistence | High | ✅ Fixed | 2026-02-23 |
| U-004 | 1 | `/cafe` | FE-L4 | "Add" button tap target ~24px, under 44px minimum | Medium | ✅ Fixed | 2026-02-23 |
| U-005 | 1 | `/cafe` | FE-L4 | "Remove" button is bare text with no min-height | Medium | ✅ Fixed | 2026-02-23 |
| U-006 | 1 | `/cafe` | FE-L3 | Success and error order status rendered identically in gray | Low | ✅ Fixed | 2026-02-23 |
| U-007 | 1 | `/cafe` | FE-L4 | Staff-only nav links exposed in customer-facing header | Medium | ✅ Fixed | 2026-02-23 |
| U-008 | 1 | `/cafe` | FE-L3 | Logo `<img>` has no `onError` fallback | Low | ✅ Fixed | 2026-02-23 |
| U-009 | 1 | `/shop` | FE-L3 | Product `<img>` has no `onError` fallback | Medium | ✅ Fixed | 2026-02-23 |
| U-010 | 1 | `/shop` | FE-L1 | Cart keyed by `item.name` string — merges identically-named products incorrectly | Low | ⚠️ Deferred | — |
| U-011 | 1 | `/checkout` | FE-L1 | 5× `useRef<any>` for all Square SDK object refs | High | ✅ Fixed | 2026-02-23 |
| U-012 | 1 | `/checkout` | FE-L1 | `catch (err: any)` in 3 payment handlers | High | ✅ Fixed | 2026-02-23 |
| U-013 | 1 | `/checkout` | FE-L1 | `Window.Square?: any` global interface | High | ✅ Fixed | 2026-02-23 |
| U-014 | 1 | `/checkout` | FE-L2 | Square SDK load failure leaves card form in eternal loading state | Medium | ✅ Fixed | 2026-02-23 |
| U-015 | 1 | `/` | FE-L2 | No typing indicator during text chat — UI appears frozen | High | ✅ Fixed | 2026-02-23 |
| U-016 | 1 | `/` | FE-L1 | `(audioRef.current as any)` casts in `stopVoiceSession` | Medium | ✅ Fixed | 2026-02-23 |
| U-017 | 1 | `/` | FE-L1 | Messages `role` typed as implicit `string` not `'user'\|'assistant'` | Medium | ✅ Fixed | 2026-02-23 |
| U-018 | 1 | `/` | FE-L3 | Waitlist insert error silently swallowed — user gets no feedback | Medium | ✅ Fixed | 2026-02-23 |
| U-019 | 1 | `/` | FE-L4 | `.concierge-send-btn` (~40px) and `.voice-btn` (~37px) under 44px tap target | Low | ✅ Fixed | 2026-02-23 |
| U-020 | 2 | `/portal` | FE-L3 | Auth-gate logo `<img>` no `onError` fallback | Low | ✅ Fixed | 2026-02-23 |
| U-021 | 2 | `/portal` | FE-L2/L3 | QR `<img>` no `onError` fallback + no skeleton while `dataLoading` | Medium | ✅ Fixed | 2026-02-23 |
| U-022 | 2 | `/portal` | FE-L4 | Sign-out button under 44px tap target | Medium | ✅ Fixed | 2026-02-23 |
| U-023 | 2 | `/portal` | FE-L4 | Print Keychain button under 44px | Low | ✅ Fixed | 2026-02-23 |
| U-024 | 2 | `/portal` | FE-L2 | Loyalty cup count renders empty while `dataLoading` — no skeleton | Low | ✅ Fixed | 2026-02-23 |
| U-025 | 2 | `/portal` | FE-L3 | Auth errors expose raw Supabase message strings | Medium | ✅ Fixed | 2026-02-23 |
| U-026 | 2 | `/resident` | FE-L3 | `handleRegister` exposes raw `23505`/`already registered` errors | Medium | ✅ Fixed | 2026-02-23 |
| U-027 | 2 | `/resident` | FE-L4 | All 6 form inputs `p-3` (~40px) — under 44px spec | Medium | ✅ Fixed | 2026-02-23 |
| U-028 | 2 | `/resident` | FE-L4 | Submit button `py-3` (~40px) — under 44px spec | Medium | ✅ Fixed | 2026-02-23 |
| U-029 | 2 | `/resident` | FE-L2 | Form rendered over success message — not gated | Low | ✅ Fixed | 2026-02-23 |
| U-030 | 2 | `/resident` | FE-L3 | Error div missing `role="alert"` | Low | ✅ Fixed | 2026-02-23 |
| U-031 | 2 | `/waitlist` | FE-L3 | `setError(insertError.message)` exposes raw DB error; no `23505` mapping | Medium | ✅ Fixed | 2026-02-23 |
| U-032 | 2 | `/waitlist` | FE-L4 | Email input `p-3` (~40px) — under 44px | Low | ✅ Fixed | 2026-02-23 |
| U-033 | 2 | `/waitlist` | FE-L4 | Submit button `py-3` (~40px); error div missing `role="alert"` | Low | ✅ Fixed | 2026-02-23 |
| U-034 | 2 | `/parcels/monitor` | FE-L3 | Error + stale banners missing ARIA live roles | Low | ✅ Fixed | 2026-02-23 |
| U-035 | 2 | `/parcels/monitor` | FE-L3 | Carrier color dot conveys info via color only — no `aria-label` | Low | ✅ Fixed | 2026-02-23 |
| U-036 | 3 | `/pos` | FE-L1 | `(window as any).BarcodeDetector` — `any` cast on experimental API | Medium | ✅ Fixed | 2026-02-23 |
| U-037 | 3 | `/kds` | FE-L3 | Error `<p>` missing `role="alert"` | Low | ✅ Fixed | 2026-02-23 |
| U-038 | 3 | `/kds` | FE-L3 | Toast `<div>` missing ARIA live role | Low | ✅ Fixed | 2026-02-23 |
| U-039 | 3 | `/scanner` | FE-L1 | `(window as any).BarcodeDetector` — `any` cast | Medium | ✅ Fixed | 2026-02-23 |
| U-040 | 3 | `/scanner` | FE-L3 | Outer `<div>` not a landmark — replaced with `<main aria-label="Package Scanner">` | Low | ✅ Fixed | 2026-02-23 |
| U-041 | 3 | `/scanner` | FE-L3 | Logo `<img>` no `onError` fallback | Low | ✅ Fixed | 2026-02-23 |
| U-042 | 4 | `CatalogManager.tsx` | FE-L1 | `catch (err)` implicit `any` in `fetchProducts` | Medium | ✅ Fixed | 2026-02-23 |
| U-043 | 4 | `InventoryTable.tsx` | FE-L1 | `useState<any[]>` for inventory rows — no typed interface | Medium | ✅ Fixed | 2026-02-23 |
| U-044 | 4 | `InventoryTable.tsx` | FE-L4 | Refresh button `py-1` (~32px) — under 44px tap target | Low | ✅ Fixed | 2026-02-23 |
| U-045 | 4 | `StatsGrid.tsx` | FE-L3 | Fetch error silently swallowed — user sees $0.00 with no indication of failure | Medium | ✅ Fixed | 2026-02-23 |
| U-046 | 4 | `RecentActivity.tsx` | FE-L1 | `useState<any[]>` + untyped `map((o: any)` event shapes | Medium | ✅ Fixed | 2026-02-23 |

---

## Conventions for This Audit

### Severity scale
| Label | Meaning |
|-------|---------|
| **Critical** | Blocks a transaction or crashes the page |
| **High** | Damages trust or causes data loss |
| **Medium** | Usability regression; workaround exists |
| **Low** | Polish / cosmetic |

### How to file a finding
1. Add a row to the phase table and the **Findings Log**.
2. Assign the next `U-NNN` ID.
3. Mark status `🔍 In Review` while working on it.
4. Update to `✅ Fixed` with the date once a PR is merged.

### Branch naming convention
```
fix/ux-audit-<U-ID>-<short-slug>
```
Example: `fix/ux-audit-U-003-kds-glare-contrast`


---

## Manager Dashboard  Step-by-Step Improvement Plan
> **Goal:** Make the dashboard usable by non-technical barista staff on phones.  
> **Initiated:** 2026-02-23

| Step | Title | Status | Completed |
|------|-------|--------|-----------|
| 1 | On the Clock card on Overview | ✅ Done | 2026-02-23 |
| 2 | Remove search bar + CSV from Overview | ✅ Done | 2026-02-23 |
| 3 | Payroll: single source of truth (DB summary, remove raw grid) | ✅ Done | 2026-02-23 |
| 4 | Payroll: preset date-range pills (Today / This Week / Last 2 Weeks / This Month) | ✅ Done | 2026-02-23 |
| 5 | Fix Clock-Out: full-screen bottom-sheet modal | ✅ Done | 2026-02-23 |
| 6 | Navigation: bottom tab bar on mobile, top on desktop | ✅ Done | 2026-02-23 |

---

### Step 1  On the Clock card  2026-02-23

**Problem:** No way to see at a glance who is currently on shift. Managers had to open Payroll, find the Open Shifts card, and mentally tally active staff.

**Fix:**
- `get-manager-stats.js`  now returns `activeShifts[]` with `name`, `email`, `clock_in`. Source: `time_logs` rows where `clock_out IS NULL`, deduplicated to most recent open shift per person.
- `DashboardOverhaul.tsx`  new **On the Clock** card between the stats tiles and action buttons.
  - Green dot  under 8 h
  - Amber dot  8-15 h (long but plausible)
  - Red pulsing dot + Check in? badge  16 h+ (likely missed clock-out)
  - Empty state: All shifts closed  nobody clocked in.
  - Refreshes on the same 60 s adaptive poll cycle.

**Files:** `netlify/functions/get-manager-stats.js` and `src/app/(site)/components/manager/DashboardOverhaul.tsx`

---

### Step 2  Remove search bar + CSV from Overview  2026-02-23

**Problem:** The global search bar and "Download Payroll CSV" button added noise and cognitive load to the Overview tab. Barista staff on phones don't need cross-entity search or raw CSV exports at the top level — those belong in dedicated tabs (Payroll, Orders).

**Fix:**
- Removed the entire **GLOBAL SEARCH BAR** UI block and its dropdown from the JSX.
- Removed the **"Download Payroll CSV"** action button from the Overview action grid.
- Removed all related state (`query`, `results`, `searching`, `searchOpen`, `searchRef`, `debounceRef`, `exporting`) and logic (`runSearch`, `handleSearchInput`, outside-click `useEffect`, `handleExportCSV`).
- Removed the `SearchResult` interface (no longer needed).
- Removed unused `Search` and `Download` imports from `lucide-react`.
- Replaced the `Search` icon in the info-type toast with `RefreshCw` (the only remaining info toast is "Refreshing dashboard…").
- Action grid simplified to `grid-cols-1` — single **Refresh Now** button.

**Files:** `src/app/(site)/components/manager/DashboardOverhaul.tsx`

---

### Step 3 — Payroll: single source of truth — 2026-02-23

**Problem:** `PayrollSection.tsx` had two competing data sources — a client-side per-employee breakdown grid fetching `get-payroll?view=list` and an overlapping weekly summary table reading `v_payroll_summary` via `get-payroll?view=summary`. The list grid was ~378 lines of orphaned code left over from a previous implementation referencing deleted state (`payroll`, `loading`, `fetchPayroll`, `hasMissed`, `totalRegular`, `totalOvertime`, `totalDoubleTime`). The file had grown to 1,024 lines with the dead code appended after the component's closing brace.

**Fix:**
- Removed all orphaned JSX/state after the component's closing `}` (lines 647–1024).
- The component now has a single data path: `get-payroll?view=summary` → `v_payroll_summary` DB view → **📊 Pay Period Summary** table.
- File trimmed from 1,024 → 646 lines. Zero TypeScript errors.

**Files:** `src/app/(site)/components/manager/PayrollSection.tsx`

---

### Step 4 — Payroll: preset date-range pills — 2026-02-23

**Problem:** Managers had to manually type or click-pick both start and end dates every session. "Last 2 weeks" required knowing today's date and subtracting — unnecessary friction for barista staff on phones.

**Fix:**
- Added `getPresetRange(label)` module-level helper that computes correct `{ start, end }` YYYY-MM-DD strings for four presets.
- Added `DATE_PRESETS = ["Today", "This Week", "Last 2 Weeks", "This Month"] as const` tuple.
- Added `activePreset` state (default `"Last 2 Weeks"`) used to highlight the active pill.
- Pills row rendered directly below the header bar, above the stat tiles. Active: `bg-amber-500/20 border-amber-500/60 text-amber-300`. Inactive: `bg-[#1a1a1a] border-[#333] text-gray-400`.
- Manual date-input `onChange` handlers now also call `setActivePreset("")` so no pill is incorrectly highlighted for a custom range.
- Default `startDate` changed from `today − 14d` to `today − 13d` to match "Last 2 Weeks" preset exactly, ensuring the pill is highlighted on first load.
- **This Week** logic: finds Monday of the current week (Sunday treated as day 0 → −6 to previous Monday).

**Files:** `src/app/(site)/components/manager/PayrollSection.tsx`
---

### Step 5 — Fix Clock-Out: bottom-sheet modal — 2026-02-23

**Problem:** The inline expand-form pattern (clicking "Fix Clock-Out" on an open-shift row caused a 3-input form to expand *inside* the card row) was unusable on phones: it pushed content off-screen, had no way to dismiss with a swipe, mixed editing state into the list layout, and left `fixingEmail` logic scattered through deeply-nested JSX.

**Fix — architecture:**
- Replaced `fixingEmail: string | null` state with `sheetTarget: SheetTarget | null` (holds `email`, `displayName`, `clockInISO`) + `sheetVisible: boolean`.
- Added `openSheet(target)` and `closeSheet()` as `useCallback` functions:
  - `openSheet`: sets target, resets form fields, fires a double `requestAnimationFrame` before setting `sheetVisible = true` so the DOM element mounts before the CSS transition starts.
  - `closeSheet`: sets `sheetVisible = false` first (starts slide-down), clears target + form state after 320 ms (matches `duration-300`).
- `handleFixClockOut` and `handleChallengeSuccess` now call `closeSheet()` instead of individually nulling 4+ state fields. `closeSheet` is in `handleChallengeSuccess` deps array.

**Fix — UI / sheet:**
- **Backdrop:** `fixed inset-0 z-40 bg-black/60` — click-to-dismiss, fades via `opacity` transition. `aria-hidden="true"`.
- **Sheet panel:** `fixed inset-x-0 bottom-0 z-50`, `rounded-t-2xl`, `max-h-[90dvh] overflow-y-auto`. Slides via `translate-y-full → translate-y-0` 300 ms ease-out.
- **Drag handle:** 40 × 4 px pill at the top of the sheet.
- **Header:** employee name, clock-in time (Eastern), hours-ago, "Likely Missed" badge if ≥16 h. `X` close button `w-10 h-10 rounded-full`.
- **Fields:** `datetime-local` with `min` bound to clock-in (Eastern); reason text input with live char counter. Both `min-h-[52px]` with `focus:ring-2 focus:ring-amber-500/60`. "All times Eastern (ET)" hint.
- **Buttons:** Cancel (flex-1) + Save Clock-Out (flex-2), both `min-h-[52px] rounded-xl`. Save disabled until time + reason filled; shows "Saving…" while busy.
- **ARIA:** `role="dialog"`, `aria-modal="true"`, `aria-labelledby="fix-sheet-title"`, `aria-label="Close"` on X, `role="alert"` on inline error banner.
- Open Shifts card rows retain a single "Fix Clock-Out →" button (with `Clock` icon) that calls `openSheet`.

**Files:** `src/app/(site)/components/manager/PayrollSection.tsx`
---

### Step 6  Navigation: bottom tab bar on mobile, top on desktop  2026-02-23

**Problem:** The manager dashboard used a single horizontally-scrollable tab strip in the sticky header for all screen sizes. On mobile phones this placed the navigation at the top, requiring a thumb stretch to switch sections  exactly the opposite of native app convention (Android / iOS both use bottom navigation for primary surfing).

**Fix  architecture:**
- Rewrote `ManagerNav.tsx` to export three focused pieces instead of a single legacy component:
  - `DesktopTabNav`  the existing horizontal tab strip, rendered inside the sticky header on `md+` (`hidden md:block` wrapper).
  - `MobileBottomTabBar`  a `fixed bottom-0 inset-x-0` bar rendered as a sibling to `<main>`, shown only on mobile (`md:hidden`).
  - `ManagerQuickLinks`  the small ops quick-link row (POS / KDS / Scanner / Staff Hub / Main Site), extracted from inline JSX.
- `manager/page.tsx` updated to import and use all three; old inline nav JSX removed. The `TABS` array is now typed as `ManagerTab[]`.

**Fix  mobile bottom bar UI:**
- Container: `fixed bottom-0 inset-x-0 z-50 md:hidden`, `bg-stone-950/95 backdrop-blur-md border-t border-stone-800`, `pb-safe` for iOS home-indicator.
- 4 equal-width buttons in a `h-16` flex row. Each: icon (22 px, `strokeWidth` 2.2 active / 1.6 inactive) + 10 px label below.
- Active: `text-amber-400`. Inactive: `text-stone-500`.
- `aria-current="page"` on active tab, `aria-label` on nav, `aria-hidden` on icons.
- `active:bg-stone-800/60` touch feedback.

**Fix  content padding:**
- `<main>` changed from `py-8` to `py-8 pb-28 md:pb-8` so content is never hidden behind the bottom bar on mobile.

**Files:** `src/app/(site)/components/manager/ManagerNav.tsx`, `src/app/(ops)/manager/page.tsx`
