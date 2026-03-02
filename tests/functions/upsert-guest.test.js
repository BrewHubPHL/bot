/**
 * Tests for upsert-guest.js — unified CRM "Ghost Conflict" safety
 *
 * Verifies that upserting a walk-in guest:
 *   1. Inserts a new row when the phone doesn't exist
 *   2. Updates name/unit for an existing walk-in (no auth_id)
 *   3. Does NOT overwrite an App User's name when auth_id is set
 *   4. Still fills in missing unit_number for App Users
 *   5. Handles the no-phone path (plain insert)
 */

// ── Supabase mock plumbing ─────────────────────────────────────────────
const mockMaybeSingle = jest.fn();
const mockEq = jest.fn();
const mockSelect = jest.fn();
const mockInsert = jest.fn();
const mockUpdate = jest.fn();

// Chainable query builder
function chainable(terminal) {
  const chain = {
    select: jest.fn(() => chain),
    eq: jest.fn(() => chain),
    single: jest.fn(() => terminal()),
    maybeSingle: jest.fn(() => terminal()),
    insert: jest.fn(() => chain),
    update: jest.fn(() => chain),
  };
  return chain;
}

let selectChain;
let insertChain;
let updateChain;

const mockFrom = jest.fn((table) => {
  // Return different chains depending on the caller's next method
  // We route based on the chainable that's set up for the test
  return {
    select: (...args) => {
      mockSelect(...args);
      return {
        eq: (...eqArgs) => {
          mockEq(...eqArgs);
          return { maybeSingle: mockMaybeSingle };
        },
      };
    },
    insert: (...args) => {
      mockInsert(...args);
      return {
        select: () => ({
          single: jest.fn(() => insertChain()),
        }),
      };
    },
    update: (...args) => {
      mockUpdate(...args);
      return {
        eq: (...eqArgs) => {
          mockEq(...eqArgs);
          return {
            select: () => ({
              single: jest.fn(() => updateChain()),
            }),
          };
        },
      };
    },
  };
});

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({ from: mockFrom })),
}));

// Stub auth, CSRF, rate-limit so the handler reaches the business logic
jest.mock('../../netlify/functions/_auth', () => ({
  authorize: jest.fn(async () => ({ ok: true })),
  json: jest.fn((code, body) => ({
    statusCode: code,
    body: JSON.stringify(body),
  })),
}));
jest.mock('../../netlify/functions/_csrf', () => ({
  requireCsrfHeader: jest.fn(() => null),
}));
jest.mock('../../netlify/functions/_token-bucket', () => ({
  staffBucket: { consume: jest.fn(() => true) },
}));
jest.mock('../../netlify/functions/_ip-hash', () => ({
  hashIP: jest.fn(() => '127.0.0.1'),
}));

const { handler } = require('../../netlify/functions/upsert-guest');

// ── Helpers ────────────────────────────────────────────────────────────
function makeEvent(body) {
  return {
    httpMethod: 'POST',
    headers: {
      origin: 'https://brewhubphl.com',
      'x-brewhub-action': 'true',
    },
    body: JSON.stringify(body),
  };
}

// ── Tests ──────────────────────────────────────────────────────────────
describe('upsert-guest.js', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ────────────────────────────────────────────────────────────────────
  it('inserts a new walk-in when no matching phone exists', async () => {
    mockMaybeSingle.mockResolvedValue({ data: null, error: null });
    insertChain = () => ({
      data: { id: 'new-uuid', full_name: 'Gritty', unit_number: '4B', phone: '2155551234', email: null },
      error: null,
    });

    const res = await handler(makeEvent({ name: 'Gritty', phone: '215-555-1234', unit_number: '4B' }));
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(200);
    expect(body.success).toBe(true);
    expect(body.resident.full_name).toBe('Gritty');
    // Should have called insert (not update)
    expect(mockInsert).toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  // ────────────────────────────────────────────────────────────────────
  it('updates name + unit for an existing walk-in (auth_id = null)', async () => {
    mockMaybeSingle.mockResolvedValue({
      data: { id: 'existing-walkin', auth_id: null, full_name: 'Old Name', unit_number: null, phone: '2155551234', email: null },
      error: null,
    });
    updateChain = () => ({
      data: { id: 'existing-walkin', full_name: 'New Name', unit_number: '7A', phone: '2155551234', email: null },
      error: null,
    });

    const res = await handler(makeEvent({ name: 'New Name', phone: '215-555-1234', unit_number: '7A' }));
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(200);
    expect(body.resident.full_name).toBe('New Name');
    // Should have called update (not insert)
    expect(mockUpdate).toHaveBeenCalled();
    expect(mockInsert).not.toHaveBeenCalled();
    // The update payload should include full_name because auth_id is null
    const updatePayload = mockUpdate.mock.calls[0][0];
    expect(updatePayload.full_name).toBe('New Name');
  });

  // ────────────────────────────────────────────────────────────────────
  it('does NOT overwrite an App User\'s name (auth_id is set)', async () => {
    mockMaybeSingle.mockResolvedValue({
      data: {
        id: 'app-user-id',
        auth_id: 'auth-uuid-123',
        full_name: 'Tommy Real Name',
        unit_number: null,
        phone: '2155551234',
        email: 'tommy@test.com',
      },
      error: null,
    });
    updateChain = () => ({
      data: { id: 'app-user-id', full_name: 'Tommy Real Name', unit_number: '3C', phone: '2155551234', email: 'tommy@test.com' },
      error: null,
    });

    const res = await handler(makeEvent({ name: 'Coffee Guy', phone: '215-555-1234', unit_number: '3C' }));
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(200);
    // Name should NOT be overwritten
    expect(body.resident.full_name).toBe('Tommy Real Name');
    // But unit_number should be filled in
    expect(mockUpdate).toHaveBeenCalled();
    const updatePayload = mockUpdate.mock.calls[0][0];
    expect(updatePayload).not.toHaveProperty('full_name');
    expect(updatePayload.unit_number).toBe('3C');
  });

  // ────────────────────────────────────────────────────────────────────
  it('updates placeholder name for App User with blank full_name', async () => {
    mockMaybeSingle.mockResolvedValue({
      data: {
        id: 'app-user-blank',
        auth_id: 'auth-uuid-456',
        full_name: 'Guest',
        unit_number: '2A',
        phone: '2155559999',
        email: 'blank@test.com',
      },
      error: null,
    });
    updateChain = () => ({
      data: { id: 'app-user-blank', full_name: 'Real Name', unit_number: '2A', phone: '2155559999', email: 'blank@test.com' },
      error: null,
    });

    const res = await handler(makeEvent({ name: 'Real Name', phone: '215-555-9999' }));
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(200);
    expect(body.resident.full_name).toBe('Real Name');
    const updatePayload = mockUpdate.mock.calls[0][0];
    expect(updatePayload.full_name).toBe('Real Name');
  });

  // ────────────────────────────────────────────────────────────────────
  it('skips update when App User already has name + unit', async () => {
    mockMaybeSingle.mockResolvedValue({
      data: {
        id: 'app-full',
        auth_id: 'auth-uuid-789',
        full_name: 'Already Set',
        unit_number: '5D',
        phone: '2155550000',
        email: 'full@test.com',
      },
      error: null,
    });

    const res = await handler(makeEvent({ name: 'Ignore Me', phone: '215-555-0000', unit_number: '9Z' }));
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(200);
    // No update should fire — nothing to change
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockInsert).not.toHaveBeenCalled();
    // Should return the existing data
    expect(body.resident.full_name).toBe('Already Set');
    expect(body.resident.unit_number).toBe('5D');
  });

  // ────────────────────────────────────────────────────────────────────
  it('plain-inserts when no phone is provided', async () => {
    insertChain = () => ({
      data: { id: 'no-phone-uuid', full_name: 'Walk In', unit_number: null, phone: null, email: null },
      error: null,
    });

    const res = await handler(makeEvent({ name: 'Walk In' }));
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(200);
    expect(body.resident.full_name).toBe('Walk In');
    expect(mockInsert).toHaveBeenCalled();
    // Should NOT have done a phone lookup
    expect(mockMaybeSingle).not.toHaveBeenCalled();
  });

  // ────────────────────────────────────────────────────────────────────
  it('returns 400 when name is missing', async () => {
    const res = await handler(makeEvent({ phone: '215-555-1234' }));
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/name/i);
  });
});
