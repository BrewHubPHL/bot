import { defineConfig } from 'vitest/config'
import dotenv from 'dotenv'

// Load env from repository root .env.local so tests have access to Supabase/Netlify keys
const parsed = dotenv.config({ path: '.env.local' }).parsed

export default defineConfig({
  test: {
    env: parsed ?? {},
    exclude: ['tests/ops/**'],
    setupFiles: ['tests/setup-tests.ts'],
  },
})
