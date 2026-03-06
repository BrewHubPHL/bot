import { test, expect, type Page, type Route } from '@playwright/test'

const BASE = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000'

// ── Shared test data ──────────────────────────────────────────────────
const TEST_ORDER_ID = 'e2e-cash-order-001'
const STAFF_ID = 'e2e-staff-001'
const STAFF_NAME = 'E2E Barista'
const GUEST_NAME = 'Tommy'
const PRODUCT_ID = 'e2e-product-latte'

/** Fake JWT-style token with 1-hour expiry */
function fakeToken() {
  const payload = { exp: Date.now() + 3600_000, sub: STAFF_ID, role: 'manager', email: 'ops@test', dfp: 'e2e', staffId: STAFF_ID }
  return Buffer.from(JSON.stringify(payload)).toString('base64') + '.x.y'
}

const TOKEN = fakeToken()
const STAFF_OBJ = { id: STAFF_ID, name: STAFF_NAME, email: 'ops@test', role: 'manager', is_working: true }

// ── Shared menu item ─────────────────────────────────────────────────
const MENU_PRODUCTS = [
  {
    id: PRODUCT_ID,
    name: 'Latte',
    price_cents: 525,
    description: 'Test latte',
    image_url: null,
    allowed_modifiers: ['sweeteners'],
    sort_order: 1,
  },
]

// ── Order state (in-memory "database") ───────────────────────────────
let orderState: {
  id: string
  status: string
  first_name: string
  created_at: string
  total_amount_cents: number
  coffee_orders: { id: string; drink_name: string; customizations?: string }[]
} | null = null

function resetOrderState() { orderState = null }

// ── Stub helpers ─────────────────────────────────────────────────────

/** Stub pin-verify (OpsGate mount check) → return valid session immediately */
async function stubPinVerify(page: Page) {
  await page.route('**/pin-verify', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ staff: STAFF_OBJ, token: TOKEN }),
    })
  })
}

/** Stub pin-login → return valid session */
async function stubPinLogin(page: Page) {
  await page.route('**/pin-login', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'set-cookie': `hub_staff_session=${TOKEN}; Path=/; HttpOnly` },
      body: JSON.stringify({ staff: STAFF_OBJ, token: TOKEN, needsPinRotation: false }),
    })
  })
}

/** Stub Supabase REST query for merch_products (POS menu) */
async function stubSupabaseMenu(page: Page) {
  await page.route('**/rest/v1/merch_products*', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'content-range': '0-0/1' },
      body: JSON.stringify(MENU_PRODUCTS),
    })
  })
}

/** Stub cafe-checkout → creates order as "preparing" (cash is atomic) */
async function stubCafeCheckout(page: Page) {
  await page.route('**/cafe-checkout', async (route: Route) => {
    if (route.request().method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' } })
      return
    }
    const body = JSON.parse(route.request().postData() || '{}')
    orderState = {
      id: TEST_ORDER_ID,
      status: 'preparing',
      first_name: body.customer_name || GUEST_NAME,
      created_at: new Date().toISOString(),
      total_amount_cents: 525,
      coffee_orders: (body.items || []).map((item: { name?: string }, i: number) => ({
        id: `co-${i}`,
        drink_name: item.name || 'Latte',
      })),
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ order: { id: TEST_ORDER_ID }, status: 'preparing' }),
    })
  })
}

/** Stub get-kds-orders → returns current orderState */
async function stubGetKdsOrders(page: Page) {
  await page.route('**/get-kds-orders*', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ orders: orderState ? [orderState] : [] }),
    })
  })
}

/** Stub update-order-status → advances orderState */
async function stubUpdateOrderStatus(page: Page) {
  await page.route('**/update-order-status', async (route: Route) => {
    if (route.request().method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' } })
      return
    }
    const body = JSON.parse(route.request().postData() || '{}')
    if (orderState && body.orderId === TEST_ORDER_ID) {
      orderState.status = body.status
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) })
  })
}

/** Stub get-queue → returns current orderState for customer monitor */
async function stubGetQueue(page: Page) {
  await page.route('**/get-queue*', async (route: Route) => {
    if (!orderState) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ queue: [], count: 0 }) })
      return
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        queue: [{
          id: orderState.id,
          name: orderState.first_name,
          tag: 'POS',
          status: orderState.status,
          position: 1,
          minutesAgo: 0,
          isPaid: true,
          items: orderState.coffee_orders.map(co => ({ name: co.drink_name })),
        }],
        count: 1,
      }),
    })
  })
}

/** Stub Supabase realtime websocket */
async function stubSupabaseRealtime(page: Page) {
  await page.route('**/realtime/**', (route: Route) => route.abort())
}

/** Stub health endpoint (keeps POS online — prevents offline mode) */
async function stubHealth(page: Page) {
  await page.route('**/health', async (route: Route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) })
  })
}

/** Catch-all for non-critical ops API calls */
async function stubMiscOps(page: Page) {
  await stubHealth(page)
  await page.route('**/pin-clock', async (route: Route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) })
  })
  await page.route('**/pin-logout', async (route: Route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) })
  })
}

/** Install all POS/KDS stubs on a page */
async function stubAllOps(page: Page) {
  await stubPinVerify(page)
  await stubPinLogin(page)
  await stubSupabaseMenu(page)
  await stubCafeCheckout(page)
  await stubGetKdsOrders(page)
  await stubUpdateOrderStatus(page)
  await stubMiscOps(page)
  await stubSupabaseRealtime(page)
}

/** Type a 6-digit PIN if OpsGate shows the PIN screen */
async function enterPinIfNeeded(page: Page) {
  try {
    const pinPrompt = page.getByText(/Enter your 6-digit staff PIN/i)
    await expect(pinPrompt).toBeVisible({ timeout: 3000 })
    await page.keyboard.type('000000')
    await page.waitForTimeout(1000)
  } catch {
    // PIN UI didn't appear — session was restored via pin-verify
  }
}

// ══════════════════════════════════════════════════════════════════════
//  TEST: Full cash order lifecycle  POS → KDS → Customer Queue
// ══════════════════════════════════════════════════════════════════════

test.describe('POS → KDS → Queue: Cash Order Lifecycle', () => {
  test.beforeEach(() => resetOrderState())

  test('cash order flows from POS through KDS to customer queue', async ({ browser }) => {
    // ── PHASE 1: POS — Create a cash order ────────────────────────
    const posContext = await browser.newContext()
    const pos = await posContext.newPage()
    await stubAllOps(pos)

    await pos.goto(`${BASE}/pos`)
    await enterPinIfNeeded(pos)

    // Wait for menu grid to populate (Supabase REST stub returns our Latte)
    await expect(pos.getByRole('heading', { name: 'Latte' })).toBeVisible({ timeout: 15_000 })

    // Add Latte to cart (click the product card button)
    await pos.getByRole('button', { name: /Latte/ }).first().click()

    // If modifier panel appears, confirm without selecting modifiers
    try {
      const addBtn = pos.getByRole('button', { name: /add to order|confirm|done/i })
      await addBtn.click({ timeout: 2000 })
    } catch {
      // No modifier panel — item added directly
    }

    // Click "Mark Paid" (cash path)
    const markPaidBtn = pos.getByRole('button', { name: /mark paid|cash/i })
    await expect(markPaidBtn).toBeVisible({ timeout: 5000 })
    await markPaidBtn.click()

    // Enter guest name if prompted (dialog opens when no loyalty customer)
    try {
      const nameInput = pos.getByPlaceholder(/first name/i)
      await expect(nameInput).toBeVisible({ timeout: 3000 })
      await nameInput.fill(GUEST_NAME)
      await pos.getByRole('button', { name: /pay cash/i }).click()
    } catch {
      // No guest name prompt — loyalty customer or name already set
    }

    // Verify order was created (success confirmation — shown in both sidebar + cart)
    await expect(pos.getByText(/marked paid.*cash/i).first()).toBeVisible({ timeout: 10_000 })
    expect(orderState).not.toBeNull()
    expect(orderState!.status).toBe('preparing')

    await pos.close()
    await posContext.close()

    // ── PHASE 2: KDS — See order and advance to "ready" ──────────
    const kdsContext = await browser.newContext()
    const kds = await kdsContext.newPage()
    await stubAllOps(kds)

    await kds.goto(`${BASE}/kds`)
    await enterPinIfNeeded(kds)

    // KDS should show the order card
    await expect(kds.getByText('Latte')).toBeVisible({ timeout: 15_000 })

    // Click "Mark Ready"
    const readyBtn = kds.getByRole('button', { name: /ready|mark ready/i })
    await expect(readyBtn).toBeVisible({ timeout: 5000 })
    await readyBtn.click()

    expect(orderState!.status).toBe('ready')

    await kds.close()
    await kdsContext.close()

    // ── PHASE 3: Customer Queue — sees "Ready" ───────────────────
    const queueContext = await browser.newContext()
    const queue = await queueContext.newPage()
    await stubGetQueue(queue)

    await queue.goto(`${BASE}/queue`)

    await expect(queue.getByText(GUEST_NAME)).toBeVisible({ timeout: 10_000 })
    await expect(queue.getByText('Latte')).toBeVisible()
    // "Pick Up!" badge or "Ready for Pickup" section heading
    await expect(queue.getByRole('status').filter({ hasText: /pick up|ready/i })).toBeVisible({ timeout: 5000 })

    await queue.close()
    await queueContext.close()
  })

  test('customer queue shows "Making It" while order is preparing', async ({ page }) => {
    orderState = {
      id: TEST_ORDER_ID,
      status: 'preparing',
      first_name: GUEST_NAME,
      created_at: new Date().toISOString(),
      total_amount_cents: 525,
      coffee_orders: [{ id: 'co-1', drink_name: 'Latte' }],
    }

    await stubGetQueue(page)
    await page.goto(`${BASE}/queue`)

    await expect(page.getByText(GUEST_NAME)).toBeVisible({ timeout: 10_000 })
    await expect(page.getByText(/making it/i)).toBeVisible({ timeout: 5000 })
  })

  test('customer queue shows completed order', async ({ page }) => {
    orderState = {
      id: TEST_ORDER_ID,
      status: 'completed',
      first_name: GUEST_NAME,
      created_at: new Date().toISOString(),
      total_amount_cents: 525,
      coffee_orders: [{ id: 'co-1', drink_name: 'Latte' }],
    }

    await stubGetQueue(page)
    await page.goto(`${BASE}/queue`)

    await expect(page.getByText(GUEST_NAME)).toBeVisible({ timeout: 10_000 })
    // Use the status badge (role="status") to avoid matching the section heading too
    await expect(page.getByRole('status').filter({ hasText: /order complete/i })).toBeVisible({ timeout: 5000 })
  })
})
