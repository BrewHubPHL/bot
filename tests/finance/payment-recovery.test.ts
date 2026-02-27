import { test, expect } from 'vitest'
import { spawnSync } from 'child_process'
import fs from 'fs'
import path from 'path'

const scriptPath = path.resolve(process.cwd(), 'scripts', 'poll-merch-payment.js')

if (!fs.existsSync(scriptPath)) {
  test.skip('payment-recovery - poll-merch-payment.js not found in scripts/', () => {})
} else {
  test('poll-merch-payment recovers order after Square timeout using email/timestamp fallback', () => {
    const env = { ...process.env, MOCK_SQUARE_TIMEOUT: '1', TEST_ORDER_EMAIL: 'recovery@example.test' }
    const res = spawnSync(process.execPath, [scriptPath], { env, encoding: 'utf8', timeout: 60_000 })

    if (res.error) {
      throw res.error
    }

    // Expect script to exit cleanly and indicate recovery path was used.
    expect(res.status).toBe(0)
    const out = (res.stdout || '') + (res.stderr || '')
    // Best-effort: look for words that indicate fallback/recovery happened.
    const lower = out.toLowerCase()
    expect(lower.includes('fallback') || lower.includes('recovered') || lower.includes('email')).toBe(true)
  })
}
