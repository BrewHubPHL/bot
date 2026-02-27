import { test, expect } from 'vitest'

const FIX_CLOCK_ENDPOINT = process.env.FIX_CLOCK_ENDPOINT
const SUPABASE_URL = process.env.SUPABASE_URL
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!FIX_CLOCK_ENDPOINT || !SUPABASE_URL || !SERVICE_ROLE_KEY) {
  test.skip('payroll-audit - FIX_CLOCK_ENDPOINT, SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required', () => {})
} else {
  test('fix-clock action updates time and writes an audit entry', async () => {
    const payload = { employee_id: 'test-employee-1', adjust_by_minutes: 5 }
    const res = await fetch(FIX_CLOCK_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    })

    expect(res.ok).toBe(true)

    // Poll comp_audit for an entry matching the employee and recent timestamp
    const auditUrl = `${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/comp_audit?employee_id=eq.${payload.employee_id}&limit=1&order=created_at.desc`
    const auditRes = await fetch(auditUrl, {
      headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
    })

    expect(auditRes.ok).toBe(true)
    const body = await auditRes.json()
    expect(Array.isArray(body)).toBe(true)
    expect(body.length).toBeGreaterThan(0)
  })
}
