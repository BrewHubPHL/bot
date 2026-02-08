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

module.exports = { checkQuota };
