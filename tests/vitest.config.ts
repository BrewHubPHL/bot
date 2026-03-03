import { defineConfig, defaultExclude } from 'vitest/config'
import dotenv from 'dotenv'

// Load env from repository root .env.local so tests have access to Supabase/Netlify keys
const parsed = dotenv.config({ path: '.env.local' }).parsed

// Merge .env.local values with stub defaults for Netlify function tests that
// call createClient() at module scope (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY).
const env: Record<string, string> = {
  SUPABASE_URL: 'https://placeholder.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'placeholder-service-role-key',
  ...parsed,
}

export default defineConfig({
  test: {
    globals: true,
    env,
    exclude: [...defaultExclude, 'tests/ops/**', 'tests/functions/**'],
    setupFiles: ['tests/setup-tests.ts'],
  },
})
