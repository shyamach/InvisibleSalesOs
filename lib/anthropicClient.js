/**
 * lib/anthropicClient.js — Shared Claude client, retry, and circuit breaker.
 *
 * Phase E, item E2. Before this, AI_Triage.js, responder.js, and writer.js
 * each instantiated their own Anthropic client and defined their own copy of
 * an exponential-backoff `withRetry` — already drifted from each other
 * (800ms/800ms/1000ms base delay) despite being conceptually identical.
 * During a real Anthropic outage, every inbound message across all three
 * callers still burned ~5-6s on doomed retries with nothing tracking that
 * failures were correlated across calls, not independent per-message events.
 *
 * This adds a circuit breaker on top of the shared retry: once
 * FAILURE_THRESHOLD *whole operations* (not individual attempts) fail
 * consecutively, the breaker opens and short-circuits further calls
 * immediately for OPEN_COOLDOWN_MS, instead of letting every new inbound
 * message independently discover the outage via its own 3 retries.
 */
import Anthropic from '@anthropic-ai/sdk';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { logSystemEvent } from './systemLog.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

// Module-level singleton — one Anthropic client for the whole backend,
// replacing three separate instantiations.
export const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const FAILURE_THRESHOLD = 5;
const OPEN_COOLDOWN_MS = 30_000;

const breaker = {
  state: 'closed', // 'closed' | 'open' | 'half-open'
  consecutiveFailures: 0,
  openedAt: null,
  lastError: null,
};

/** Read-only snapshot — for Phase E's E3 health endpoint. */
export function getCircuitBreakerStatus() {
  return { ...breaker };
}

/** Test-only: force the breaker back to a clean closed state between tests. */
export function resetCircuitBreaker() {
  breaker.state = 'closed';
  breaker.consecutiveFailures = 0;
  breaker.openedAt = null;
  breaker.lastError = null;
}

function canAttempt() {
  if (breaker.state !== 'open') return true;
  if (Date.now() - breaker.openedAt >= OPEN_COOLDOWN_MS) {
    // Cooldown elapsed — let exactly one trial call through. Its own
    // recordSuccess/recordFailure decides whether the breaker closes again
    // or reopens; canAttempt() doesn't flip state on its own.
    breaker.state = 'half-open';
    return true;
  }
  return false;
}

function recordSuccess() {
  breaker.state = 'closed';
  breaker.consecutiveFailures = 0;
  breaker.openedAt = null;
  breaker.lastError = null;
}

function recordFailure(err) {
  breaker.consecutiveFailures += 1;
  breaker.lastError = err?.message || String(err);
  const wasOpen = breaker.state === 'open';
  // A failed half-open trial reopens immediately, regardless of the
  // threshold — one bad trial is enough to know the outage isn't over yet.
  if (breaker.state === 'half-open' || breaker.consecutiveFailures >= FAILURE_THRESHOLD) {
    breaker.state = 'open';
    breaker.openedAt = Date.now();
    // Log once on the actual open transition, not on every failure below
    // threshold and not repeatedly while already open.
    if (!wasOpen) {
      logSystemEvent({
        category: 'claude',
        severity: 'error',
        message: `Circuit breaker opened after ${breaker.consecutiveFailures} consecutive failures: ${breaker.lastError}`,
        detail: { consecutiveFailures: breaker.consecutiveFailures },
        source: 'lib/anthropicClient.js#recordFailure',
      });
    }
  }
}

/**
 * Exponential backoff retry, shared across all three Claude callers, gated
 * by the circuit breaker above. Breaker state updates once per call to this
 * function — after all retries either succeed or are exhausted — not once
 * per individual attempt inside the loop. That's what keeps "3 retries in a
 * row" and "5 consecutive failed *operations* trips the breaker" as two
 * independent, non-interfering concerns.
 *
 * @param {Function} fn        — async () => result
 * @param {Object}   [opts]
 * @param {number}   [opts.retries=3]
 * @param {number}   [opts.delayMs=800]
 * @param {string}   [opts.label='claude'] — for log lines
 */
export async function withRetry(fn, { retries = 3, delayMs = 800, label = 'claude' } = {}) {
  if (!canAttempt()) {
    throw new Error(`[${label}] Circuit breaker open — Anthropic API assumed down, skipping call`);
  }

  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const result = await fn();
      recordSuccess();
      return result;
    } catch (err) {
      if (attempt === retries - 1) {
        recordFailure(err);
        throw err;
      }
      const wait = delayMs * 2 ** attempt;
      console.warn(`⚠️ [${label}] API error, retrying in ${wait}ms... (attempt ${attempt + 1}/${retries})`);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
}
