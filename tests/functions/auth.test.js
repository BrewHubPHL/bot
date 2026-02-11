/**
 * Tests for _auth.js authorization helper
 */

// Mock Supabase before requiring the module
jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({
    auth: {
      getUser: jest.fn()
    },
    from: jest.fn(() => ({
      select: jest.fn(() => ({
        eq: jest.fn(() => ({
          single: jest.fn()
        }))
      }))
    }))
  }))
}));

const { authorize, json, sanitizedError } = require('../../netlify/functions/_auth');
const { createClient } = require('@supabase/supabase-js');

describe('_auth.js', () => {
  let mockSupabase;
  
  beforeEach(() => {
    mockSupabase = createClient();
  });

  describe('json()', () => {
    it('should return properly formatted response', () => {
      const response = json(200, { message: 'Success' });
      
      expect(response.statusCode).toBe(200);
      expect(response.headers['Content-Type']).toBe('application/json');
      expect(JSON.parse(response.body)).toEqual({ message: 'Success' });
    });

    it('should handle error status codes', () => {
      const response = json(401, { error: 'Unauthorized' });
      
      expect(response.statusCode).toBe(401);
      expect(JSON.parse(response.body)).toEqual({ error: 'Unauthorized' });
    });
  });

  describe('sanitizedError()', () => {
    it('should return generic error for sensitive patterns', () => {
      const pgError = new Error('relation "users" does not exist');
      const response = sanitizedError(pgError, 'TEST');
      
      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.body);
      expect(body.error).toBe('An error occurred. Please try again.');
      // Should NOT expose the actual error message
      expect(body.error).not.toContain('relation');
    });

    it('should return generic error for RLS violations', () => {
      const rlsError = new Error('violates row-level security policy');
      const response = sanitizedError(rlsError, 'TEST');
      
      const body = JSON.parse(response.body);
      expect(body.error).toBe('An error occurred. Please try again.');
    });

    it('should return generic message for non-sensitive errors', () => {
      const genericError = new Error('Something went wrong');
      const response = sanitizedError(genericError, 'TEST');
      
      const body = JSON.parse(response.body);
      expect(body.error).toBe('Operation failed');
    });
  });

  describe('authorize()', () => {
    it('should reject requests without authorization header', async () => {
      const event = {
        headers: {}
      };
      
      const result = await authorize(event);
      
      expect(result.ok).toBe(false);
      expect(result.response.statusCode).toBe(401);
    });

    it('should reject requests with malformed token', async () => {
      const event = {
        headers: {
          authorization: 'InvalidToken'
        }
      };
      
      const result = await authorize(event);
      
      expect(result.ok).toBe(false);
      expect(result.response.statusCode).toBe(401);
    });

    it('should accept service secret when allowServiceSecret is true', async () => {
      const event = {
        headers: {
          'x-brewhub-secret': 'test-sync-secret'
        }
      };
      
      const result = await authorize(event, { allowServiceSecret: true });
      
      expect(result.ok).toBe(true);
      expect(result.via).toBe('secret');
      expect(result.role).toBe('service');
    });

    it('should NOT accept service secret when allowServiceSecret is false', async () => {
      const event = {
        headers: {
          'x-brewhub-secret': 'test-sync-secret'
        }
      };
      
      const result = await authorize(event, { allowServiceSecret: false });
      
      expect(result.ok).toBe(false);
      expect(result.response.statusCode).toBe(401);
    });

    it('should reject service token when requireManager is true', async () => {
      const event = {
        headers: {
          'x-brewhub-secret': 'test-sync-secret'
        }
      };
      
      const result = await authorize(event, { allowServiceSecret: true, requireManager: true });
      
      expect(result.ok).toBe(false);
      expect(result.response.statusCode).toBe(403);
    });

    it('should reject when INTERNAL_SYNC_SECRET is undefined', async () => {
      const originalSecret = process.env.INTERNAL_SYNC_SECRET;
      delete process.env.INTERNAL_SYNC_SECRET;
      
      const event = {
        headers: {
          'x-brewhub-secret': 'any-value'
        }
      };
      
      const result = await authorize(event, { allowServiceSecret: true });
      
      // Should fail because env secret is undefined
      expect(result.ok).toBe(false);
      expect(result.response.statusCode).toBe(401);
      
      process.env.INTERNAL_SYNC_SECRET = originalSecret;
    });

    it('should reject empty x-brewhub-secret header', async () => {
      const event = {
        headers: {
          'x-brewhub-secret': ''
        }
      };
      
      const result = await authorize(event, { allowServiceSecret: true });
      
      expect(result.ok).toBe(false);
      expect(result.response.statusCode).toBe(401);
    });
  });
});
