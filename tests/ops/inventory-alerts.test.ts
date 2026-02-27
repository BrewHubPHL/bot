import { test, expect } from '@playwright/test'
import { promises as fs } from 'fs'
import path from 'path'

const BASE = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000'

test('Low Stock widget appears when stock level is 9', async ({ page }) => {
  // Collect simple diagnostics
  const requests: string[] = []
  const consoleMessages: string[] = []
  page.on('request', r => requests.push(`${r.method()} ${r.url()}`))
  page.on('console', msg => consoleMessages.push(`${msg.type()}: ${msg.text()}`))

  // Intercept get-manager-stats API and return a low stock payload
  await page.route('**/get-manager-stats', async route => {
    const json = {
      revenue: 100,
      orders: 5,
      staffCount: 2,
      labor: 50,
      activeShifts: [],
      lowStockItems: [{ id: 'sku-1', name: 'Test Item', stock_quantity: 9 }]
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(json) })
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

  await page.goto(`${BASE}/manager`)

  // If OpsGate PIN UI is present, type a 6-digit PIN to trigger the intercepted pin-login
  try {
    await page.getByText(/Enter your 6-digit staff PIN/i, { timeout: 3000 })
    await page.keyboard.type('000000')
  } catch {
    // PIN UI didn't appear within 3s — continue (page may already be authenticated)
  }

  // Write diagnostics (URL, HTML snapshot, screenshot, requests)
  const info = test.info()
  const outFile = info.outputPath('diagnostics.txt')
  const diagDir = path.dirname(outFile)
  await fs.mkdir(diagDir, { recursive: true })
  await fs.writeFile(path.join(diagDir, 'url.txt'), page.url())
  await fs.writeFile(path.join(diagDir, 'content.html'), await page.content(), 'utf8')
  await page.screenshot({ path: path.join(diagDir, 'before.png') })
  await fs.writeFile(path.join(diagDir, 'requests.json'), JSON.stringify(requests, null, 2), 'utf8')
  await fs.writeFile(path.join(diagDir, 'console.json'), JSON.stringify(consoleMessages, null, 2), 'utf8')

  // Expect a Low Stock widget to appear in the Manager Dashboard
  const widget = page.getByText(/Low Stock/i)
  await expect(widget).toBeVisible({ timeout: 5000 })
})
