/**
 * In-memory sliding-window rate limiter (zero dependencies).
 *
 * Uses a Map<string, number[]> keyed by IP address. Each value is an
 * array of request timestamps. Stale entries are lazily evicted on
 * every check, and a periodic sweep removes IPs with no recent hits
 * so the Map never grows unbounded in a long-lived serverless instance.
 *
 * Usage:
 *   const limiter = createRateLimiter({ windowMs: 60_000, max: 5 });
 *   if (!limiter.check(ip)) return NextResponse.json(..., { status: 429 });
 */

interface RateLimiterOptions {
  /** Time window in milliseconds (default: 60 000 = 1 minute). */
  windowMs?: number;
  /** Maximum requests allowed per IP within the window (default: 5). */
  max?: number;
}

interface RateLimiter {
  /** Returns `true` if the request is allowed, `false` if rate-limited. */
  check(key: string): boolean;
  /** Returns remaining requests for a key (useful for headers). */
  remaining(key: string): number;
}

export function createRateLimiter(opts: RateLimiterOptions = {}): RateLimiter {
  const windowMs = opts.windowMs ?? 60_000;
  const max = opts.max ?? 5;

  const hits = new Map<string, number[]>();

  // Periodic sweep: every 2× the window, drop stale keys entirely.
  // setInterval is unref'd so it never prevents serverless shutdown.
  const sweep = setInterval(() => {
    const cutoff = Date.now() - windowMs;
    for (const [key, timestamps] of hits) {
      const live = timestamps.filter((t) => t > cutoff);
      if (live.length === 0) {
        hits.delete(key);
      } else {
        hits.set(key, live);
      }
    }
  }, windowMs * 2);

  if (typeof sweep === "object" && "unref" in sweep) {
    (sweep as NodeJS.Timeout).unref();
  }

  function prune(key: string): number[] {
    const cutoff = Date.now() - windowMs;
    const timestamps = (hits.get(key) ?? []).filter((t) => t > cutoff);
    hits.set(key, timestamps);
    return timestamps;
  }

  return {
    check(key: string): boolean {
      const timestamps = prune(key);
      if (timestamps.length >= max) return false;
      timestamps.push(Date.now());
      return true;
    },

    remaining(key: string): number {
      return Math.max(0, max - prune(key).length);
    },
  };
}

/* ── Singleton: 5 requests / 60 s (shared across all routes in this process) */
export const globalLimiter = createRateLimiter({ windowMs: 60_000, max: 5 });
