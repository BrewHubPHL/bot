import { defineConfig, globalIgnores } from "eslint/config";

// Minimal flat config: keep default ignores. Avoid importing external configs
// here to prevent runtime import errors in the ESLint CLI environment.
export default defineConfig([
  // global ignores (override defaults + migrated from .eslintignore)
  globalIgnores([
    ".netlify/**",
    ".next/**",
    "node_modules/**",
    "dist/**",
    "build/**",
    "out/**",
    "next-env.d.ts",
    // netlify/** no longer ignored — serverless functions are now linted
  ]),
]);
