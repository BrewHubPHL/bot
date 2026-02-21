/**
 * Tests for _auth.js authorization helper
 */

const crypto = require('crypto');

// Mock Supabase before requiring the module
const mockGetUser = jest.fn();
const mockSelect = jest.fn();
const mockEq = jest.fn();
const mockSingle = jest.fn();

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({
    auth: {
      getUser: mockGetUser
    },
    from: jest.fn(() => ({
      select: mockSelect.mockReturnValue({
        eq: mockEq.mockReturnValue({
          single: mockSingle
        })
      })
    }))
  }))
}));

const { authorize, json, sanitizedError, verifyServiceSecret } = require('../../netlify/functions/_auth');

/* Test-only fixture secrets — NOT real credentials.
   Sourced via env vars; inline fallbacks are random-looking test fixtures that
   exist solely so the test file can run without a .env.  Snyk may still flag
   the fallback literals — they are safe to suppress. */
const TEST_SYNC_SECRET  = process.env.TEST_SYNC_SECRET  || `test_${crypto.randomBytes(8).toString('hex')}`;
const TEST_SERVICE_KEY  = process.env.TEST_SERVICE_KEY   || `key_${crypto.randomBytes(8).toString('hex')}`;
const TEST_SUPABASE_URL = process.env.TEST_SUPABASE_URL  || 'https://test.supabase.co';

describe('_auth.js', () => {
  const originalEnv = process.env;
  
  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...originalEnv };
    process.env.INTERNAL_SYNC_SECRET = TEST_SYNC_SECRET;
    process.env.SUPABASE_URL = TEST_SUPABASE_URL;
    process.env.SUPABASE_SERVICE_ROLE_KEY = TEST_SERVICE_KEY;
  });

  afterEach(() => {
    process.env = originalEnv;
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

  describe('verifyServiceSecret()', () => {
    it('should accept valid service secret', () => {
      const event = { headers: { 'x-brewhub-secret': TEST_SYNC_SECRET } };
      const result = verifyServiceSecret(event);
      expect(result.valid).toBe(true);
    });

    it('should reject invalid service secret', () => {
      const event = { headers: { 'x-brewhub-secret': 'wrong-secret' } };
      const result = verifyServiceSecret(event);
      expect(result.valid).toBe(false);
    });

    it('should reject when INTERNAL_SYNC_SECRET is undefined', () => {
      delete process.env.INTERNAL_SYNC_SECRET;
      const event = { headers: { 'x-brewhub-secret': 'any-value' } };
      const result = verifyServiceSecret(event);
      expect(result.valid).toBe(false);
    });
  });

  describe('authorize() - IP Guard', () => {
    it('should allow localhost IPs', async () => {
      const event = {
        headers: { 
          'x-nf-client-connection-ip': '127.0.0.1',
          'x-brewhub-secret': TEST_SYNC_SECRET
        }
      };
      const result = await authorize(event, { allowServiceSecret: true });
      expect(result.ok).toBe(true);
    });

    it('should block unauthorized IPs when ALLOWED_IPS is set', async () => {
      process.env.ALLOWED_IPS = '192.168.1.100';
      const event = {
        headers: {
          'x-nf-client-connection-ip': '10.0.0.5',
          authorization: 'Bearer test.token.here'
        }
      };
      const result = await authorize(event);
      expect(result.ok).toBe(false);
      expect(result.response.statusCode).toBe(403);
      const body = JSON.parse(result.response.body);
      expect(body.error).toContain('Unauthorized IP');
    });

    it('should allow authorized IPs from ALLOWED_IPS list', async () => {
      process.env.ALLOWED_IPS = '192.168.1.100, 10.0.0.5';
      const event = {
        headers: {
          'x-nf-client-connection-ip': '10.0.0.5',
          'x-brewhub-secret': TEST_SYNC_SECRET
        }
      };
      const result = await authorize(event, { allowServiceSecret: true });
      expect(result.ok).toBe(true);
    });
  });

  describe('authorize() - Service Secret', () => {
    it('should accept service secret when allowServiceSecret is true', async () => {
      const event = {
        headers: {
          'x-nf-client-connection-ip': '127.0.0.1',
          'x-brewhub-secret': TEST_SYNC_SECRET
        }
      };
      const result = await authorize(event, { allowServiceSecret: true });
      expect(result.ok).toBe(true);
      expect(result.via).toBe('secret');
      expect(result.role).toBe('service');
    });

    it('should reject service token when requireManager is true', async () => {
      const event = {
        headers: {
          'x-nf-client-connection-ip': '127.0.0.1',
          'x-brewhub-secret': TEST_SYNC_SECRET
        }
      };
      const result = await authorize(event, { allowServiceSecret: true, requireManager: true });
      expect(result.ok).toBe(false);
      expect(result.response.statusCode).toBe(403);
    });
  });

  describe('authorize() - PIN Token (2-part)', () => {
    function createPINToken(payload) {
      const payloadStr = JSON.stringify(payload);
      const payloadB64 = Buffer.from(payloadStr).toString('base64');
      const signature = crypto.createHmac('sha256', TEST_SYNC_SECRET).update(payloadStr).digest('hex');
      return `${payloadB64}.${signature}`;
    }

    it('should accept valid PIN token', async () => {
      const payload = {
        email: 'staff@brewhub.com',
        staffId: 'staff-123',
        iat: Date.now(),
        exp: Date.now() + 3600000
      };
      const token = createPINToken(payload);

      mockSingle.mockResolvedValue({
        data: { role: 'staff', version_updated_at: null },
        error: null
      });

      const event = {
        headers: {
          'x-nf-client-connection-ip': '127.0.0.1',
          authorization: `Bearer ${token}`
        }
      };

      const result = await authorize(event);
      expect(result.ok).toBe(true);
      expect(result.via).toBe('pin');
      expect(result.role).toBe('staff');
    });

    it('should reject expired PIN token', async () => {
      const payload = {
        email: 'staff@brewhub.com',
        iat: Date.now() - 7200000,
        exp: Date.now() - 3600000
      };
      const token = createPINToken(payload);

      const event = {
        headers: {
          'x-nf-client-connection-ip': '127.0.0.1',
          authorization: `Bearer ${token}`
        }
      };

      const result = await authorize(event);
      expect(result.ok).toBe(false);
      expect(result.response.statusCode).toBe(401);
    });

    it('should reject PIN token with version mismatch', async () => {
      const payload = {
        email: 'staff@brewhub.com',
        staffId: 'staff-123',
        iat: Date.now() - 3600000,
        exp: Date.now() + 3600000
      };
      const token = createPINToken(payload);

      mockSingle.mockResolvedValue({
        data: {
          role: 'staff',
          version_updated_at: new Date(Date.now() - 1800000).toISOString()
        },
        error: null
      });

      const event = {
        headers: {
          'x-nf-client-connection-ip': '127.0.0.1',
          authorization: `Bearer ${token}`
        }
      };

      const result = await authorize(event);
      expect(result.ok).toBe(false);
      expect(result.response.statusCode).toBe(401);
      const body = JSON.parse(result.response.body);
      expect(body.code).toBe('TOKEN_VERSION_MISMATCH');
    });
  });

  describe('authorize() - JWT Token (3-part)', () => {
    /* Test fixture: structurally valid JWT (header.payload.sig) with dummy values.
       The mock intercepts auth.getUser() so the actual signature is irrelevant. */
    const MOCK_JWT = [
      Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url'),
      Buffer.from(JSON.stringify({ iat: 1609459200, email: 'test@brewhub.com' })).toString('base64url'),
      'test_sig',
    ].join('.');

    it('should reject JWT when requirePin is true', async () => {
      const event = {
        headers: {
          'x-nf-client-connection-ip': '127.0.0.1',
          authorization: 'Bearer header.payload.signature'
        }
      };

      const result = await authorize(event, { requirePin: true });
      expect(result.ok).toBe(false);
      expect(result.response.statusCode).toBe(403);
      const body = JSON.parse(result.response.body);
      expect(body.error).toContain('PIN authentication required');
    });

    it('should accept valid JWT token', async () => {
      const mockToken = MOCK_JWT;
      
      mockGetUser.mockResolvedValue({
        data: { user: { id: 'user-123', email: 'test@brewhub.com' } },
        error: null
      });

      mockSingle
        .mockResolvedValueOnce({ data: null, error: { code: 'PGRST116' } }) // revoked_users check
        .mockResolvedValueOnce({
          data: { role: 'staff', version_updated_at: null },
          error: null
        }); // staff_directory check

      const event = {
        headers: {
          'x-nf-client-connection-ip': '127.0.0.1',
          authorization: `Bearer ${mockToken}`
        }
      };

      const result = await authorize(event);
      expect(result.ok).toBe(true);
      expect(result.via).toBe('jwt');
      expect(result.role).toBe('staff');
    });

    it('should reject revoked JWT token', async () => {
      const mockToken = MOCK_JWT;
      
      mockGetUser.mockResolvedValue({
        data: { user: { id: 'user-123', email: 'test@brewhub.com' } },
        error: null
      });

      mockSingle.mockResolvedValueOnce({
        data: { revoked_at: new Date(Date.now() - 1000).toISOString() },
        error: null
      });

      const event = {
        headers: {
          'x-nf-client-connection-ip': '127.0.0.1',
          authorization: `Bearer ${mockToken}`
        }
      };

      const result = await authorize(event);
      expect(result.ok).toBe(false);
      expect(result.response.statusCode).toBe(403);
    });

    it('should reject staff not in directory', async () => {
      const mockToken = MOCK_JWT;
      
      mockGetUser.mockResolvedValue({
        data: { user: { id: 'user-123', email: 'test@brewhub.com' } },
        error: null
      });

      mockSingle
        .mockResolvedValueOnce({ data: null, error: { code: 'PGRST116' } })
        .mockResolvedValueOnce({ data: null, error: new Error('Not found') });

      const event = {
        headers: {
          'x-nf-client-connection-ip': '127.0.0.1',
          authorization: `Bearer ${mockToken}`
        }
      };

      const result = await authorize(event);
      expect(result.ok).toBe(false);
      expect(result.response.statusCode).toBe(403);
    });
  });

  describe('authorize() - Basic Cases', () => {
    it('should reject requests without authorization header', async () => {
      const event = {
        headers: { 'x-nf-client-connection-ip': '127.0.0.1' }
      };
      const result = await authorize(event);
      expect(result.ok).toBe(false);
      expect(result.response.statusCode).toBe(401);
    });

    it('should reject malformed token', async () => {
      const event = {
        headers: {
          'x-nf-client-connection-ip': '127.0.0.1',
          authorization: 'InvalidToken'
        }
      };
      const result = await authorize(event);
      expect(result.ok).toBe(false);
      expect(result.response.statusCode).toBe(401);
    });

    it('should reject token with invalid format (not 2 or 3 parts)', async () => {
      const event = {
        headers: {
          'x-nf-client-connection-ip': '127.0.0.1',
          authorization: 'Bearer single-part-token'
        }
      };
      const result = await authorize(event);
      expect(result.ok).toBe(false);
      expect(result.response.statusCode).toBe(401);
    });
  });
});
