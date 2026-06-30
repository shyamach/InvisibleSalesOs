/**
 * lib/rateLimiter.js — In-memory fixed-window rate limiter.
 *
 * Pure and dependency-free so it can be unit-tested with an injected clock.
 * Suitable for single-process Phase 1. For multi-instance deployments this
 * should be backed by Redis (noted in DB_AUDIT / security backlog).
 *
 * Usage:
 *   const limiter = createRateLimiter({ windowMs: 60_000, max: 30 });
 *   const { allowed, retryAfterMs } = limiter.check(req.ip);
 */

export function createRateLimiter({ windowMs = 60_000, max = 30 } = {}) {
  /** @type {Map<string, { count: number, resetAt: number }>} */
  const buckets = new Map();

  /**
   * Record a hit for `key` and report whether it is allowed.
   * @param {string} key
   * @param {number} [now] — injectable epoch ms (testability)
   */
  function check(key, now = Date.now()) {
    let bucket = buckets.get(key);

    if (!bucket || now >= bucket.resetAt) {
      bucket = { count: 0, resetAt: now + windowMs };
      buckets.set(key, bucket);
    }

    bucket.count += 1;
    const allowed = bucket.count <= max;

    return {
      allowed,
      remaining: Math.max(0, max - bucket.count),
      retryAfterMs: allowed ? 0 : bucket.resetAt - now,
      limit: max,
    };
  }

  /** Drop expired buckets — call periodically to bound memory. */
  function prune(now = Date.now()) {
    for (const [key, bucket] of buckets) {
      if (now >= bucket.resetAt) buckets.delete(key);
    }
  }

  /** Test/maintenance helper — wipe all state. */
  function reset() {
    buckets.clear();
  }

  return { check, prune, reset, _buckets: buckets };
}
