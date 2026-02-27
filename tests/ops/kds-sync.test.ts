import { test, expect } from '@playwright/test'
import { promises as fs } from 'fs'
import path from 'path'

const BASE = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000'

test('AolBuddyQueue popup appears on order completion and self-destructs', async ({ page }) => {
  // Lightweight diagnostics: capture network requests and console messages
  const requests: string[] = []
  const consoleMessages: string[] = []
  page.on('request', r => requests.push(`${r.method()} ${r.url()}`))
  page.on('console', msg => consoleMessages.push(`${msg.type()}: ${msg.text()}`))

  // Stub the public get-queue endpoint to return a completed order so the popup appears
  await page.route('**/get-queue', (route) => {
    route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ queue: [{ id: 'test-order-1', position: 1, name: 'Test Customer', tag: 'web', items: [{ name: 'Coffee' }], status: 'completed', created_at: new Date().toISOString(), minutesAgo: 0, isPaid: true }] }),
    })
  })

  // Intercept PIN login to simulate a successful staff login (bypass OpsGate PIN UI)
  await page.route('**/pin-login', async route => {
    const exp = Date.now() + 60 * 60 * 1000 // 1 hour in ms
    const payload = { exp }
    const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64')
    const token = `${payloadB64}.x.y`
    const body = {
      staff: { id: 'test-staff', name: 'Playwright Tester', email: 'ops@test', role: 'manager', is_working: false },
      token,
      needsPinRotation: false
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'set-cookie': `hub_staff_session=${token}; Path=/; HttpOnly` },
      body: JSON.stringify(body),
    })
  })

  // Open the manager Queue Monitor tab so the AolBuddyQueue component mounts
  await page.goto(`${BASE}/manager?tab=queue`)

  // If OpsGate PIN UI is present, type a 6-digit PIN to trigger the intercepted pin-login
  try {
    await page.getByText(/Enter your 6-digit staff PIN/i, { timeout: 3000 })
    await page.keyboard.type('000000')
  } catch {
    // PIN UI didn't appear within 3s — continue (page may already be authenticated)
  }

  // Write diagnostic artifacts for the initial page state
  const info = test.info()
  const outFile = info.outputPath('diagnostics.txt')
  const diagDir = path.dirname(outFile)
  await fs.mkdir(diagDir, { recursive: true })
  await fs.writeFile(path.join(diagDir, 'url.txt'), page.url())
  await fs.writeFile(path.join(diagDir, 'content.html'), await page.content(), 'utf8')
  await page.screenshot({ path: path.join(diagDir, 'before.png') })

  // Trigger a simulated order-complete event in-app if the app listens for it.
  await page.evaluate(() => {
    const ev = new CustomEvent('aol:order-complete', { detail: { test: true } })
    window.dispatchEvent(ev)
  })

  // Give the app a moment to react
  await page.waitForTimeout(300)

  // Persist collected diagnostics
  await fs.writeFile(path.join(diagDir, 'requests.json'), JSON.stringify(requests, null, 2), 'utf8')
  await fs.writeFile(path.join(diagDir, 'console.json'), JSON.stringify(consoleMessages, null, 2), 'utf8')

  // Look for the popup text rendered by AolBuddyQueue
  const popup = page.locator('text=Your order is READY', { hasText: 'Your order is READY' })
  await expect(popup).toBeVisible({ timeout: 5000 })

  // Click the close button to dismiss the popup
  await page.getByRole('button', { name: 'Close' }).click()

  // The UI should remove the popup; wait for it to disappear.
  await expect(popup).toHaveCount(0, { timeout: 5000 })
})
