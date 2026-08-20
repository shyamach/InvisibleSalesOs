/**
 * tests/anthropicClient.test.js
 * Phase E, item E2 — shared retry + circuit breaker coverage.
 * Exercises withRetry()/the breaker directly with a fake fn, no real
 * Anthropic SDK call needed. Uses real timers with a tiny delayMs (matching
 * the existing AI_Triage.test.js/writer.test.js/responder.test.js
 * convention) rather than vi.useFakeTimers() — fake timers interact badly
 * with unhandled-rejection detection on the retry loop's internal promises
 * and misattribute failures to the wrong test.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { withRetry, getCircuitBreakerStatus, resetCircuitBreaker } from '../lib/anthropicClient.js';

const DELAY_MS = 5; // small enough to keep the suite fast, non-zero to exercise the real backoff path

beforeEach(() => {
  resetCircuitBreaker();
});

describe('withRetry — basic retry behavior (unchanged from the old per-file wrappers)', () => {
  it('returns the result on first success without retrying', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    const result = await withRetry(fn, { label: 'test' });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries up to `retries` times, then throws', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('boom'));
    await expect(withRetry(fn, { retries: 3, delayMs: DELAY_MS, label: 'test' })).rejects.toThrow('boom');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('succeeds on a later attempt without exhausting retries', async () => {
    const fn = vi.fn().mockRejectedValueOnce(new Error('transient')).mockResolvedValueOnce('recovered');
    const result = await withRetry(fn, { retries: 3, delayMs: DELAY_MS, label: 'test' });
    expect(result).toBe('recovered');
    expect(fn).toHaveBeenCalledTimes(2);
  });
});

describe('circuit breaker — state transitions', () => {
  it('stays closed and lets every call through below the failure threshold', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('boom'));

    for (let i = 0; i < 4; i++) {
      await expect(withRetry(fn, { retries: 1, delayMs: DELAY_MS, label: 'test' })).rejects.toThrow();
    }

    const status = getCircuitBreakerStatus();
    expect(status.state).toBe('closed');
    expect(status.consecutiveFailures).toBe(4);
  });

  it('opens after 5 consecutive whole-operation failures and short-circuits further calls', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('boom'));

    for (let i = 0; i < 5; i++) {
      await expect(withRetry(fn, { retries: 1, delayMs: DELAY_MS, label: 'test' })).rejects.toThrow();
    }
    expect(getCircuitBreakerStatus().state).toBe('open');

    fn.mockClear();
    await expect(withRetry(fn, { retries: 1, delayMs: DELAY_MS, label: 'test' })).rejects.toThrow(/circuit breaker open/i);
    expect(fn).not.toHaveBeenCalled(); // short-circuited before ever calling fn
  });

  it('a single call exhausting its own retries only counts as ONE breaker failure, not `retries`', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('boom'));

    await expect(withRetry(fn, { retries: 3, delayMs: DELAY_MS, label: 'test' })).rejects.toThrow();

    expect(fn).toHaveBeenCalledTimes(3); // all 3 attempts happened
    expect(getCircuitBreakerStatus().consecutiveFailures).toBe(1); // but only 1 breaker failure
  });

  it('moves to half-open after the cooldown and allows exactly one trial call', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('boom'));
    const dateSpy = vi.spyOn(Date, 'now').mockReturnValue(1_000_000);

    for (let i = 0; i < 5; i++) {
      await expect(withRetry(fn, { retries: 1, delayMs: DELAY_MS, label: 'test' })).rejects.toThrow();
    }
    expect(getCircuitBreakerStatus().state).toBe('open');

    dateSpy.mockReturnValue(1_000_000 + 30_001); // past OPEN_COOLDOWN_MS
    fn.mockClear();
    fn.mockResolvedValueOnce('recovered');

    const result = await withRetry(fn, { retries: 1, delayMs: DELAY_MS, label: 'test' });
    expect(result).toBe('recovered');
    expect(fn).toHaveBeenCalledTimes(1);
    expect(getCircuitBreakerStatus().state).toBe('closed');

    dateSpy.mockRestore();
  });

  it('a failed half-open trial reopens immediately, without needing the full threshold again', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('boom'));
    const dateSpy = vi.spyOn(Date, 'now').mockReturnValue(1_000_000);

    for (let i = 0; i < 5; i++) {
      await expect(withRetry(fn, { retries: 1, delayMs: DELAY_MS, label: 'test' })).rejects.toThrow();
    }

    dateSpy.mockReturnValue(1_000_000 + 30_001);

    // One failed trial in half-open state.
    await expect(withRetry(fn, { retries: 1, delayMs: DELAY_MS, label: 'test' })).rejects.toThrow();
    expect(getCircuitBreakerStatus().state).toBe('open');

    // Immediately after — no further cooldown elapsed — still short-circuited.
    fn.mockClear();
    await expect(withRetry(fn, { retries: 1, delayMs: DELAY_MS, label: 'test' })).rejects.toThrow(/circuit breaker open/i);
    expect(fn).not.toHaveBeenCalled();

    dateSpy.mockRestore();
  });
});
