/**
 * Tests for inventory-check.js
 */

const mockRpc = jest.fn();

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({
    rpc: mockRpc,
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

// Mock the _auth module
jest.mock('../../netlify/functions/_auth', () => ({
  authorize: jest.fn()
}));

const { handler } = require('../../netlify/functions/inventory-check');
const { authorize } = require('../../netlify/functions/_auth');

describe('inventory-check.js', () => {
  beforeEach(() => {
    mockRpc.mockReset();
    authorize.mockReset();
  });

  it('should reject unauthorized requests', async () => {
    authorize.mockResolvedValue({
      ok: false,
      response: {
        statusCode: 401,
        body: JSON.stringify({ error: 'Unauthorized' })
      }
    });

    const event = {
      headers: {},
      httpMethod: 'GET'
    };

    const response = await handler(event);

    expect(response.statusCode).toBe(401);
  });

  it('should return low stock items when found', async () => {
    authorize.mockResolvedValue({ ok: true, user: { email: 'staff@brewhubphl.com' } });
    
    mockRpc.mockResolvedValue({
      data: [
        { item_name: 'Espresso Beans', current_stock: 3, unit: 'lbs' },
        { item_name: 'Oat Milk', current_stock: 2, unit: 'gal' }
      ],
      error: null
    });

    const event = {
      headers: { authorization: 'Bearer valid-token' },
      httpMethod: 'GET'
    };

    const response = await handler(event);
    const body = JSON.parse(response.body);

    expect(response.statusCode).toBe(200);
    expect(body.alert).toBe(true);
    expect(body.items).toHaveLength(2);
    expect(body.items[0].item_name).toBe('Espresso Beans');
  });

  it('should return no alert when stock is sufficient', async () => {
    authorize.mockResolvedValue({ ok: true, user: { email: 'staff@brewhubphl.com' } });
    
    mockRpc.mockResolvedValue({
      data: [],
      error: null
    });

    const event = {
      headers: { authorization: 'Bearer valid-token' },
      httpMethod: 'GET'
    };

    const response = await handler(event);
    const body = JSON.parse(response.body);

    expect(response.statusCode).toBe(200);
    expect(body.alert).toBe(false);
  });

  it('should handle database errors gracefully', async () => {
    authorize.mockResolvedValue({ ok: true, user: { email: 'staff@brewhubphl.com' } });
    
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: 'Database error' }
    });

    const event = {
      headers: { authorization: 'Bearer valid-token' },
      httpMethod: 'GET'
    };

    const response = await handler(event);

    expect(response.statusCode).toBe(500);
    expect(JSON.parse(response.body).error).toBe('Inventory check failed');
  });
});
