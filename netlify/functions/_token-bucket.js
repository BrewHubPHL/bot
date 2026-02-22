/**
 * Token Bucket rate limiter — CommonJS version for Netlify Functions.
 *
 * Mirrors the TypeScript implementation in src/lib/tokenBucket.ts
 * but in plain JS for serverless compatibility (no build step).
 *
 * Usage:
 *   const { createTokenBucket, ttsBucket, chatBucket } = require('./_token-bucket');
 *   const result = ttsBucket.consume(clientIp);
 *   if (!result.allowed) return { statusCode: 429, ... };
 */

function createTokenBucket({ capacity, refillRate, refillIntervalMs = 1000 }) {
  const buckets = new Map();

  // Periodic sweep every 5 min to prevent unbounded growth
  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [key, state] of buckets) {
      const elapsed = now - state.lastRefill;
      const refilled = state.tokens + Math.floor(elapsed / refillIntervalMs) * refillRate;
      if (refilled >= capacity) buckets.delete(key);
    }
  }, 300_000);
  if (sweep && typeof sweep.unref === 'function') sweep.unref();

  function refill(state) {
    const now = Date.now();
    const elapsed = now - state.lastRefill;
    const tokensToAdd = Math.floor(elapsed / refillIntervalMs) * refillRate;
    if (tokensToAdd > 0) {
      state.tokens = Math.min(capacity, state.tokens + tokensToAdd);
      state.lastRefill = now;
    }
  }

  function getOrCreate(key) {
    let state = buckets.get(key);
    if (!state) {
      state = { tokens: capacity, lastRefill: Date.now() };
      buckets.set(key, state);
    }
    return state;
  }

  return {
    consume(key) {
      const state = getOrCreate(key);
      refill(state);

      if (state.tokens >= 1) {
        state.tokens -= 1;
        return { allowed: true, remaining: state.tokens, retryAfterMs: 0 };
      }

      const msPerToken = refillIntervalMs / refillRate;
      const deficit = 1 - state.tokens;
      const retryAfterMs = Math.ceil(deficit * msPerToken);

      return { allowed: false, remaining: 0, retryAfterMs };
    },

    remaining(key) {
      const state = getOrCreate(key);
      refill(state);
      return Math.floor(state.tokens);
    },

    reset(key) {
      buckets.delete(key);
    },
  };
}

// Pre-built instances (shared across warm invocations in the same container)
const ttsBucket = createTokenBucket({ capacity: 10, refillRate: 2, refillIntervalMs: 1000 });
const chatBucket = createTokenBucket({ capacity: 8, refillRate: 1, refillIntervalMs: 1000 });
const orderBucket = createTokenBucket({ capacity: 3, refillRate: 1, refillIntervalMs: 5000 });

module.exports = { createTokenBucket, ttsBucket, chatBucket, orderBucket };
