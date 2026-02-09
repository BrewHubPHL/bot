/**
 * Tests for _usage.js quota/circuit breaker
 */

const mockRpc = jest.fn();

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({
    rpc: mockRpc
  }))
}));

const { checkQuota } = require('../../netlify/functions/_usage');

describe('_usage.js', () => {
  beforeEach(() => {
    mockRpc.mockReset();
  });

  describe('checkQuota()', () => {
    it('should return true when under limit', async () => {
      mockRpc.mockResolvedValue({
        data: true,
        error: null
      });

      const result = await checkQuota('elevenlabs');
      
      expect(mockRpc).toHaveBeenCalledWith('increment_api_usage', {
        p_service: 'elevenlabs'
      });
      expect(result).toBe(true);
    });

    it('should return false when over limit', async () => {
      mockRpc.mockResolvedValue({
        data: false,
        error: null
      });

      const result = await checkQuota('gemini');
      
      expect(result).toBe(false);
    });

    it('should fail-closed on database error', async () => {
      mockRpc.mockResolvedValue({
        data: null,
        error: { message: 'Database connection failed' }
      });

      const result = await checkQuota('square');
      
      // Should fail-closed (return false) to protect wallet
      expect(result).toBe(false);
    });

    it('should fail-closed on exception', async () => {
      mockRpc.mockRejectedValue(new Error('Network error'));

      const result = await checkQuota('resend');
      
      expect(result).toBe(false);
    });
  });
});
