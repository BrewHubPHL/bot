# Tests (Phase 1 Archive)

This directory contains a standalone automated test suite using Vitest (unit/logic) and Playwright (E2E/UI).

Prerequisites
- Node 18+ (for built-in fetch and modern APIs)
- Install dev dependencies (see package.json snippet below)
- If you will run Playwright tests, follow Playwright browser install after installing deps: `npx playwright install`.

Package.json devDependencies snippet

```
"devDependencies": {
  "vitest": "^1.4.0",
  "@playwright/test": "^1.40.0"
}
```

Recommended npm scripts (add to your root `package.json`):

```
"scripts": {
  "test:unit": "vitest run --reporter=dot",
  "test:e2e": "npx playwright test",
  "test:all": "npm run test:unit && npm run test:e2e"
}
```

Single-command run (local)

1. Install dev deps:

```bash
npm install --save-dev vitest @playwright/test
npx playwright install
```

2. Run the full suite:

```bash
npm run test:all
```

Git safety (do not accidentally commit test run artifacts):

- Append `/tests` to `.gitignore`:

PowerShell (Windows):

```powershell
Add-Content -Path .gitignore -Value '/tests'
```

Bash / WSL / macOS:

```bash
echo '/tests' >> .gitignore
```

Notes and environment variables

- `SUPABASE_URL` and `SUPABASE_ANON_KEY` are used by `tests/security/rls-policy.test.ts`.
- `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` and `FIX_CLOCK_ENDPOINT` are used by `tests/staff/payroll-audit.test.ts`.
- `scripts/poll-merch-payment.js` (if present) is invoked by `tests/finance/payment-recovery.test.ts` with `MOCK_SQUARE_TIMEOUT=1`.
- Playwright uses `PLAYWRIGHT_BASE_URL` to override the default `http://localhost:3000`.

If an environment variable or service is missing, tests will skip with helpful instructions.

Good to know
- This suite is intentionally standalone under `/tests` so it can be archived, reviewed, and run independently from source edits.
