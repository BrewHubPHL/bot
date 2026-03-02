/**
 * Tests for create-customer.js — unified CRM account creation
 *
 * Verifies:
 *   1. Brand new customer → insert into customers with auth_id + full_name
 *   2. Walk-in upgrade → existing row (no auth_id) gets linked
 *   3. Already-exists path → returns { alreadyExists: true }
 *   4. Writes to full_name (not the dropped `name` column)
 *   5. Rejects email mismatch between JWT and body
 */

// ── Supabase mock plumbing ─────────────────────────────────────────────
const mockGetUser = jest.fn();
const mockSelect = jest.fn();
const mockEq = jest.fn();
const mockSingle = jest.fn();
const mockInsert = jest.fn();
const mockUpdate = jest.fn();

let latestUpdateEq;

const mockFrom = jest.fn(() => ({
  select: (...args) => {
    mockSelect(...args);
    return {
      eq: (...eqArgs) => {
        mockEq(...eqArgs);
        return { single: mockSingle };
      },
    };
  },
  insert: (...args) => {
    mockInsert(...args);
    return { error: null };
  },
  update: (...args) => {
    mockUpdate(...args);
    return {
      eq: (...eqArgs) => {
        latestUpdateEq = eqArgs;
        return { error: null, data: null };
      },
    };
  },
}));

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({
    from: mockFrom,
    auth: { getUser: mockGetUser },
  })),
}));

jest.mock('../../netlify/functions/_csrf', () => ({
  requireCsrfHeader: jest.fn(() => null),
}));
jest.mock('../../netlify/functions/_token-bucket', () => ({
  formBucket: { consume: jest.fn(() => ({ allowed: true })) },
}));

const { handler } = require('../../netlify/functions/create-customer');

// ── Helpers ────────────────────────────────────────────────────────────
function makeEvent(body, token = 'valid-jwt-token') {
  return {
    httpMethod: 'POST',
    headers: {
      origin: 'https://brewhubphl.com',
      'x-brewhub-action': 'true',
      authorization: `Bearer ${token}`,
      'x-nf-client-connection-ip': '127.0.0.1',
    },
    body: JSON.stringify(body),
  };
}

const AUTH_USER = {
  id: 'auth-uid-001',
  email: 'new@brewhub.com',
};

// ── Tests ──────────────────────────────────────────────────────────────
describe('create-customer.js', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    latestUpdateEq = null;
    // Default: valid JWT
    mockGetUser.mockResolvedValue({ data: { user: AUTH_USER }, error: null });
  });

  // ────────────────────────────────────────────────────────────────────
  it('inserts a brand-new customer with full_name (not name)', async () => {
    // No existing customer → single returns PGRST116
    mockSingle.mockResolvedValue({
      data: null,
      error: { code: 'PGRST116', message: 'no rows' },
    });
    mockInsert.mockReturnValue({ error: null });

    const res = await handler(
      makeEvent({
        email: 'new@brewhub.com',
        name: 'Philly Barista',
        address: '123 South St',
        phone: '2155551234',
      }),
    );
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(200);
    expect(body.success).toBe(true);

    // Verify it wrote to `full_name`, not `name`
    expect(mockInsert).toHaveBeenCalledTimes(1);
    const insertPayload = mockInsert.mock.calls[0][0];
    expect(insertPayload.full_name).toBe('Philly Barista');
    expect(insertPayload).not.toHaveProperty('name');
    expect(insertPayload.auth_id).toBe('auth-uid-001');
  });

  // ────────────────────────────────────────────────────────────────────
  it('upgrades a walk-in (auth_id = null) to a linked App User', async () => {
    mockSingle.mockResolvedValue({
      data: { id: 'walkin-uuid', auth_id: null },
      error: null,
    });

    const res = await handler(
      makeEvent({
        email: 'new@brewhub.com',
        name: 'Upgraded Guest',
        address: '456 Market St',
      }),
    );
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(200);
    expect(body.upgraded).toBe(true);

    // Should have called update, not insert
    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(mockInsert).not.toHaveBeenCalled();

    // Update payload should set auth_id and full_name
    const updatePayload = mockUpdate.mock.calls[0][0];
    expect(updatePayload.auth_id).toBe('auth-uid-001');
    expect(updatePayload.full_name).toBe('Upgraded Guest');
    expect(updatePayload).not.toHaveProperty('name');
  });

  // ────────────────────────────────────────────────────────────────────
  it('returns alreadyExists when auth_id is already set', async () => {
    mockSingle.mockResolvedValue({
      data: { id: 'existing-uuid', auth_id: 'auth-uid-001' },
      error: null,
    });

    const res = await handler(
      makeEvent({
        email: 'new@brewhub.com',
        name: 'Same Person',
        address: '789 Broad St',
      }),
    );
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(200);
    expect(body.alreadyExists).toBe(true);
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockInsert).not.toHaveBeenCalled();
  });

  // ────────────────────────────────────────────────────────────────────
  it('rejects email mismatch between JWT and request body', async () => {
    const res = await handler(
      makeEvent({
        email: 'hacker@evil.com',
        name: 'Bad Actor',
        address: '000 Fraud Ln',
      }),
    );

    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body).error).toMatch(/mismatch/i);
  });

  // ────────────────────────────────────────────────────────────────────
  it('returns 400 when required fields are missing', async () => {
    const res = await handler(
      makeEvent({ email: 'new@brewhub.com' }),
    );

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/missing/i);
  });

  // ────────────────────────────────────────────────────────────────────
  it('returns 401 when no auth token is provided', async () => {
    const event = makeEvent({ email: 'x@x.com', name: 'X', address: 'X' });
    event.headers.authorization = '';

    const res = await handler(event);
    expect(res.statusCode).toBe(401);
  });
});
