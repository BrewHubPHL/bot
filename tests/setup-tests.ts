import { vi } from 'vitest'

// Provide a minimal `jest` compatibility shim for legacy tests that use `jest.fn` and `jest.mock`.
;(global as any).jest = {
  fn: vi.fn,
  mock: vi.mock,
  spyOn: vi.spyOn,
}
