import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: 'tests/ops',
  // Match our Playwright E2E test file pattern
  testMatch: /.*\.test\.ts$/,
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000',
    headless: true,
    viewport: { width: 1280, height: 720 },
    ignoreHTTPSErrors: true,
    // Capture artifacts for debugging
    trace: 'on',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  reporter: [['html', { open: 'never' }]],
  /* Auto-start Next.js dev server when no PLAYWRIGHT_BASE_URL is set */
  webServer: process.env.PLAYWRIGHT_BASE_URL ? undefined : {
    command: 'npm run dev',
    port: 3000,
    reuseExistingServer: true,
    timeout: 60_000,
  },
})
