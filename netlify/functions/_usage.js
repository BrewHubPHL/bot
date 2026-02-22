const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

/**
 * Shared Circuit Breaker logic to prevent Denial-of-Wallet attacks.
 * Tracks daily usage in Supabase 'api_usage' table.
 * 
 * @param {string} serviceName - Unique key for the service (e.g., 'elevenlabs', 'gemini')
 * @returns {Promise<boolean>} - True if under limit, False if over
 */
async function checkQuota(serviceName) {
  try {
    const { data: isUnderLimit, error } = await supabase.rpc('increment_api_usage', { 
      p_service: serviceName 
    });

    if (error) {
      console.error(`[QUOTA ERROR] ${serviceName}:`, error);
      // Fail-open for accidental DB issues, or fail-closed for paranoia?
      // For wallet protection, we fail-closed if the database says so.
      return false; 
    }

    return isUnderLimit;
  } catch (err) {
    console.error(`[QUOTA CRASH] ${serviceName}:`, err);
    return false;
  }
}

/**
 * Voucher Redemption Circuit Breaker
 *
 * Checks whether an IP has exceeded the failure threshold
 * (5 failed attempts within a 10-minute sliding window).
 * Uses the Postgres RPC check_voucher_rate_limit.
 *
 * @param {string} ip - Client IP address
 * @returns {Promise<{allowed: boolean, failCount: number, lockoutSeconds: number}>}
 */
async function checkVoucherRateLimit(ip) {
  try {
    const { data, error } = await supabase.rpc('check_voucher_rate_limit', { p_ip: ip });
    if (error) {
      console.error('[VOUCHER RATE] RPC error:', error);
      // Fail-closed: deny on error to prevent bypass by crashing the check
      return { allowed: false, failCount: -1, lockoutSeconds: 60 };
    }
    const row = Array.isArray(data) ? data[0] : data;
    return {
      allowed: row?.allowed ?? false,
      failCount: row?.fail_count ?? 0,
      lockoutSeconds: row?.lockout_remaining_seconds ?? 0,
    };
  } catch (err) {
    console.error('[VOUCHER RATE] Crash:', err);
    return { allowed: false, failCount: -1, lockoutSeconds: 60 };
  }
}

/**
 * Log a failed voucher redemption attempt for the circuit breaker.
 *
 * @param {string} ip         - Client IP address
 * @param {string} codePrefix - First 4 characters of the attempted code (for debugging)
 * @returns {Promise<void>}
 */
async function logVoucherFail(ip, codePrefix) {
  try {
    const { error } = await supabase.rpc('log_voucher_fail', {
      p_ip: ip,
      p_code_prefix: (codePrefix || '').slice(0, 4),
    });
    if (error) console.error('[VOUCHER FAIL LOG] RPC error:', error);
  } catch (err) {
    console.error('[VOUCHER FAIL LOG] Crash:', err);
  }
}

module.exports = { checkQuota, checkVoucherRateLimit, logVoucherFail };
