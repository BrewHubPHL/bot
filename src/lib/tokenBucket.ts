/**
 * Token Bucket rate limiter for API cost protection.
 *
 * Unlike a sliding-window limiter (which hard-blocks after N requests),
 * token bucket allows short bursts while enforcing a sustained rate.
 * When the bucket is empty, callers get a `retryAfterMs` hint instead
 * of an opaque rejection.
 *
 * Used to protect expensive external APIs (ElevenLabs TTS, Claude chat)
 * from denial-of-wallet attacks without degrading UX for legitimate users.
 *
 * Usage in Netlify Functions:
 *   const { tokenBucketCheck } = require('../src/lib/tokenBucket');
 *   // Or import the pre-built instances:
 *   const bucket = createTokenBucket({ capacity: 10, refillRate: 2, refillIntervalMs: 1000 });
 *   const result = bucket.consume(ip);
 *   if (!result.allowed) {
 *     return { statusCode: 429, headers: { 'Retry-After': String(Math.ceil(result.retryAfterMs / 1000)) }, body: '...' };
 *   }
 */

interface TokenBucketOptions {
  /** Maximum tokens the bucket can hold (burst capacity). */
  capacity: number;
  /** Number of tokens added per refill interval. */
  refillRate: number;
  /** Milliseconds between refills (default: 1000 = 1 token-add per second). */
  refillIntervalMs?: number;
}

interface BucketState {
  tokens: number;
  lastRefill: number;
}

interface ConsumeResult {
  /** Whether the request is allowed. */
  allowed: boolean;
  /** Tokens remaining after this request (0 if denied). */
  remaining: number;
  /** If denied, milliseconds until enough tokens refill for 1 request. */
  retryAfterMs: number;
}

interface TokenBucket {
  /** Attempt to consume 1 token for the given key (e.g. IP address). */
  consume(key: string): ConsumeResult;
  /** Peek at remaining tokens without consuming. */
  remaining(key: string): number;
  /** Reset a specific key (useful for testing). */
  reset(key: string): void;
}

export function createTokenBucket(opts: TokenBucketOptions): TokenBucket {
  const { capacity, refillRate, refillIntervalMs = 1000 } = opts;
  const buckets = new Map<string, BucketState>();

  // Periodic sweep: remove stale keys every 5 minutes to prevent unbounded growth
  const sweepInterval = setInterval(() => {
    const now = Date.now();
    for (const [key, state] of buckets) {
      // If a bucket has been idle long enough to be full, remove it
      const elapsed = now - state.lastRefill;
      const refilled = state.tokens + Math.floor(elapsed / refillIntervalMs) * refillRate;
      if (refilled >= capacity) {
        buckets.delete(key);
      }
    }
  }, 300_000);

  if (typeof sweepInterval === "object" && "unref" in sweepInterval) {
    (sweepInterval as NodeJS.Timeout).unref();
  }

  function refill(state: BucketState): void {
    const now = Date.now();
    const elapsed = now - state.lastRefill;
    const tokensToAdd = Math.floor(elapsed / refillIntervalMs) * refillRate;
    if (tokensToAdd > 0) {
      state.tokens = Math.min(capacity, state.tokens + tokensToAdd);
      state.lastRefill = now;
    }
  }

  function getOrCreate(key: string): BucketState {
    let state = buckets.get(key);
    if (!state) {
      state = { tokens: capacity, lastRefill: Date.now() };
      buckets.set(key, state);
    }
    return state;
  }

  return {
    consume(key: string): ConsumeResult {
      const state = getOrCreate(key);
      refill(state);

      if (state.tokens >= 1) {
        state.tokens -= 1;
        return { allowed: true, remaining: state.tokens, retryAfterMs: 0 };
      }

      // Calculate time until 1 token refills
      const msPerToken = refillIntervalMs / refillRate;
      const deficit = 1 - state.tokens;
      const retryAfterMs = Math.ceil(deficit * msPerToken);

      return { allowed: false, remaining: 0, retryAfterMs };
    },

    remaining(key: string): number {
      const state = getOrCreate(key);
      refill(state);
      return Math.floor(state.tokens);
    },

    reset(key: string): void {
      buckets.delete(key);
    },
  };
}

/* ── Pre-built instances for BrewHub API protection ──────────── */

/**
 * ElevenLabs TTS: 10 requests burst, refills at 2/sec.
 * Sustainable rate: ~120 requests/min. Burst allows 10 rapid-fire.
 */
export const ttsBucket = createTokenBucket({
  capacity: 10,
  refillRate: 2,
  refillIntervalMs: 1000,
});

/**
 * Claude Chat: 8 requests burst, refills at 1/sec.
 * Sustainable rate: ~60 requests/min. Burst allows 8 rapid-fire.
 */
export const chatBucket = createTokenBucket({
  capacity: 8,
  refillRate: 1,
  refillIntervalMs: 1000,
});

/**
 * AI Order placement (via Claude tool): 3 requests burst, refill 1/5s.
 * Very conservative — orders are expensive operations.
 */
export const orderBucket = createTokenBucket({
  capacity: 3,
  refillRate: 1,
  refillIntervalMs: 5000,
});
