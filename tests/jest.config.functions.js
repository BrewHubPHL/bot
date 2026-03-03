// Jest config for CJS Netlify function tests
// Vitest 4+ cannot mock require() in CJS source files,
// so function tests that mock @supabase/supabase-js etc. run under Jest.

module.exports = {
  rootDir: '..',
  testMatch: ['<rootDir>/tests/functions/**/*.test.js'],
  testPathIgnorePatterns: ['/node_modules/', '_mock-debug'],
  testEnvironment: 'node',
};
