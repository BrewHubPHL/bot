const mockSingle = jest.fn();

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({
    from: jest.fn(() => ({
      select: jest.fn(() => ({
        eq: jest.fn(() => ({ single: mockSingle })),
      })),
    })),
    rpc: jest.fn(),
  })),
}));

jest.mock('../../netlify/functions/_auth', () => ({
  authorize: jest.fn(async () => ({
    ok: true,
    role: 'staff',
    user: { email: 'staff@brewhubphl.com' },
  })),
  json: jest.fn((status, body) => ({ statusCode: status, body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } })),
}));

jest.mock('../../netlify/functions/_csrf', () => ({
  requireCsrfHeader: jest.fn(() => null),
}));

jest.mock('../../netlify/functions/_ip-hash', () => ({
  hashIP: jest.fn(() => 'hashed-ip'),
}));

const { handler } = require('../../netlify/functions/parcel-pickup');

describe('parcel-pickup status gate', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSingle.mockResolvedValue({
      data: {
        id: '123e4567-e89b-12d3-a456-426614174000',
        tracking_number: '1Z12345E0205271688',
        status: 'preparing',
        estimated_value_tier: 'standard',
        pickup_locked_until: null,
        pickup_attempts: 0,
        recipient_name: 'Test Resident',
        recipient_email: 'resident@example.com',
      },
      error: null,
    });
  });

  it('rejects confirmation when backend status is not arrived', async () => {
    const event = {
      httpMethod: 'POST',
      headers: {
        origin: 'https://brewhubphl.com',
        authorization: 'Bearer test-token',
        'x-brewhub-action': 'true',
      },
      body: JSON.stringify({
        parcel_id: '123e4567-e89b-12d3-a456-426614174000',
        pickup_code: '123456',
      }),
    };

    const res = await handler(event);
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(409);
    expect(body.error).toContain('not "arrived"');
  });
});
