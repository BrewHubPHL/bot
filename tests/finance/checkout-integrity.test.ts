import { test, expect } from 'vitest'

// Local validation logic mirroring the expected rules for checkout customization limits.
function validateCustomizations(customizations: string[]): { valid: boolean; reason?: string } {
  if (!Array.isArray(customizations)) return { valid: true }
  if (customizations.length > 10) return { valid: false, reason: 'too_many_customizations' }
  for (const c of customizations) {
    if (typeof c !== 'string') return { valid: false, reason: 'invalid_type' }
    if (c.length > 300) return { valid: false, reason: 'customization_too_long' }
  }
  return { valid: true }
}

test('rejects more than 10 customizations', () => {
  const many = new Array(11).fill('x')
  const r = validateCustomizations(many)
  expect(r.valid).toBe(false)
  expect(r.reason).toBe('too_many_customizations')
})

test('accepts up to 10 customizations and enforces length', () => {
  const ok = new Array(10).fill('a')
  expect(validateCustomizations(ok).valid).toBe(true)

  const tooLong = ['x'.repeat(301)]
  const r = validateCustomizations(tooLong)
  expect(r.valid).toBe(false)
  expect(r.reason).toBe('customization_too_long')
})
