/**
 * Jest Test Setup
 * 
 * This file runs before each test file.
 * Set up mocks and environment variables here.
 */

// Mock environment variables for testing
process.env.SUPABASE_URL = 'https://test-project.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
process.env.SUPABASE_ANON_KEY = 'test-anon-key';
process.env.INTERNAL_SYNC_SECRET = 'test-sync-secret';
process.env.SQUARE_ACCESS_TOKEN = 'test-square-token';
process.env.SQUARE_LOCATION_ID = 'test-location';
process.env.RESEND_API_KEY = 'test-resend-key';
process.env.NODE_ENV = 'test';

// Silence console during tests (optional - comment out for debugging)
// global.console = {
//   ...console,
//   log: jest.fn(),
//   warn: jest.fn(),
//   error: jest.fn(),
// };

// Global fetch mock (available in Node 18+)
global.fetch = jest.fn();

// Reset mocks between tests
beforeEach(() => {
  jest.clearAllMocks();
});
