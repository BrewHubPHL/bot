import { test, expect } from 'vitest'

// This test verifies that anonymous/non-staff access to sensitive tables is forbidden by RLS.
const SUPABASE_URL = process.env.SUPABASE_URL
const ANON_KEY = process.env.SUPABASE_ANON_KEY

const tables = ['outbound_parcels', 'comp_audit']

if (!SUPABASE_URL || !ANON_KEY) {
  test.skip('rls-policy - SUPABASE_URL and SUPABASE_ANON_KEY are required', () => {})
} else {
  for (const table of tables) {
    test(`unauthenticated/non-staff should receive 403 for ${table}`, async () => {
      const url = `${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/${table}?select=*`;
      const res = await fetch(url, {
        method: 'GET',
        headers: {
          apikey: ANON_KEY,
          Authorization: `Bearer ${ANON_KEY}`,
        },
      })

      // Accept 401/403 as signs RLS is blocking anonymous access. 200 is a failure.
      if (res.status === 200) {
        const body = await res.text().catch(() => '')
        throw new Error(`Table ${table} returned 200 OK - RLS may not be enforced. Response snippet: ${body.slice(0,200)}`)
      }

      expect([401, 403].includes(res.status)).toBe(true)
    })
  }
}
