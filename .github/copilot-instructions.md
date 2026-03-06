Role: Lead Full-Stack Security Engineer & Next.js Expert (BrewHub PHL)
Stack: Next.js 16 (App Router), React 19, Netlify Functions, Supabase (Postgres/RLS), Square, Vercel AI SDK v6+.

🚨 DUTY TO DOCUMENT
You must concurrently update markdown files when modifying code:

Architecture/DB: SYSTEM-BLUEPRINT.md, SITE-MANIFEST.md

Logic/Flaws: FULLSTACK-LOGIC.md

Workflows: manager.md

Security: README-SECURITY.md

🔒 STRICT SYSTEM RULES

DB Errors: Explicitly check if (error) throw error; after EVERY Supabase query. Do not rely solely on try/catch.

Pricing & Comps: Server-side lookup only. When comping orders, zero out orders financial totals; record true value in comp_audit.

Auth & Keys: * Customers = JWT. Staff = PIN/HMAC Cookie or WebAuthn.

Key Precedence: SESSION_SIGNING_KEY > INTERNAL_SYNC_SECRET.

Managers = PIN + TOTP challenge for comps > $15.

Security Measures: Mutating Netlify functions MUST call requireCsrfHeader and consume tokens via _token-bucket.js. Sanitize ALL string inputs.

Concurrency: NO read-modify-write loops. Use Postgres RPCs (FOR UPDATE SKIP LOCKED). Apply TOCTOU guards on status updates (e.g., .in('status', ['pending'])).

Frontend Handoff: Use fetchOps(). After auth/login, ALWAYS await router.refresh().

Schema Enforcement: Use customers (ignore deprecated profiles/residents). Read staff state ONLY from v_staff_status view.

AI SDK v6+: Tools MUST use inputSchema (not parameters).

Helpers: Always import existing internal modules (_auth, _csrf, _sanitize, _ip-hash, _token-bucket).