/**
 * tests/rateLimiter.test.js
 * Rule #1 coverage for the in-memory fixed-window rate limiter.
 * Deterministic via an injected clock.
 */
import { describe, it, expect } from 'vitest';
import { createRateLimiter } from '../lib/rateLimiter.js';

describe('createRateLimiter', () => {
  it('allows up to `max` hits then blocks within the window', () => {
    const rl = createRateLimiter({ windowMs: 1000, max: 3 });
    const t = 10_000;
    expect(rl.check('ip', t).allowed).toBe(true);
    expect(rl.check('ip', t).allowed).toBe(true);
    expect(rl.check('ip', t).allowed).toBe(true);
    const blocked = rl.check('ip', t);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterMs).toBe(1000);
  });

  it('reports decreasing remaining quota', () => {
    const rl = createRateLimiter({ windowMs: 1000, max: 2 });
    expect(rl.check('ip', 0).remaining).toBe(1);
    expect(rl.check('ip', 0).remaining).toBe(0);
  });

  it('resets after the window elapses', () => {
    const rl = createRateLimiter({ windowMs: 1000, max: 1 });
    expect(rl.check('ip', 0).allowed).toBe(true);
    expect(rl.check('ip', 500).allowed).toBe(false); // still in window
    expect(rl.check('ip', 1000).allowed).toBe(true); // window rolled over
  });

  it('tracks keys independently', () => {
    const rl = createRateLimiter({ windowMs: 1000, max: 1 });
    expect(rl.check('a', 0).allowed).toBe(true);
    expect(rl.check('b', 0).allowed).toBe(true);
    expect(rl.check('a', 0).allowed).toBe(false);
  });

  it('prune() drops expired buckets', () => {
    const rl = createRateLimiter({ windowMs: 1000, max: 5 });
    rl.check('a', 0);
    rl.check('b', 0);
    expect(rl._buckets.size).toBe(2);
    rl.prune(2000);
    expect(rl._buckets.size).toBe(0);
  });
});
