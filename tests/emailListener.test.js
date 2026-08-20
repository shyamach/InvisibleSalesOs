/**
 * tests/emailListener.test.js
 * Phase E, item E1 — IMAP supervisor coverage.
 *
 * fetchEmails and scheduleTimeout are both injected, so this drives the
 * actual tick/backoff/status logic deterministically — no real IMAP
 * connection, no real timers. `scheduleTimeout` is captured rather than
 * executed automatically; tests call the captured callback themselves to
 * advance one tick at a time.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { startEmailListener, getEmailListenerStatus, classifyImapError } from '../lib/emailListener.js';

const originalEnabled = process.env.EMAIL_IMAP_ENABLED;

beforeEach(() => {
  process.env.EMAIL_IMAP_ENABLED = 'true';
});

afterEach(() => {
  process.env.EMAIL_IMAP_ENABLED = originalEnabled;
});

/** Injectable scheduleTimeout that captures the callback instead of running it. */
function makeScheduler() {
  const calls = [];
  const scheduleTimeout = vi.fn((fn, delayMs) => {
    calls.push({ fn, delayMs });
    return calls.length; // fake timer id
  });
  return { scheduleTimeout, calls, latest: () => calls[calls.length - 1] };
}

describe('classifyImapError', () => {
  it('classifies an authenticationFailed error as auth', () => {
    expect(classifyImapError({ authenticationFailed: true })).toBe('auth');
  });

  it('classifies a connection-refused error as network', () => {
    expect(classifyImapError({ code: 'ECONNREFUSED' })).toBe('network');
    expect(classifyImapError({ code: 'ENOTFOUND' })).toBe('network');
  });

  it('falls back to other for an unrecognized error shape', () => {
    expect(classifyImapError({ message: 'something weird' })).toBe('other');
    expect(classifyImapError(null)).toBe('other');
  });
});

describe('startEmailListener — disabled/missing-dependency guards', () => {
  it('does nothing and returns undefined when EMAIL_IMAP_ENABLED is not "true"', async () => {
    process.env.EMAIL_IMAP_ENABLED = 'false';
    const { scheduleTimeout } = makeScheduler();
    const fetchEmails = vi.fn();

    const result = startEmailListener(vi.fn(), { fetchEmails, scheduleTimeout });

    expect(result).toBeUndefined();
    expect(fetchEmails).not.toHaveBeenCalled();
    expect(scheduleTimeout).not.toHaveBeenCalled();
  });
});

describe('startEmailListener — success path', () => {
  it('routes each fetched email to onEmail and schedules the next tick at the normal interval', async () => {
    const { scheduleTimeout, latest } = makeScheduler();
    const emails = [{ from: 'a@x.com', subject: 'Hi', body: 'test' }];
    const fetchEmails = vi.fn().mockResolvedValue(emails);
    const onEmail = vi.fn().mockResolvedValue(undefined);

    startEmailListener(onEmail, { fetchEmails, scheduleTimeout });
    await vi.waitFor(() => expect(scheduleTimeout).toHaveBeenCalledTimes(1));

    expect(onEmail).toHaveBeenCalledWith(emails[0]);
    expect(latest().delayMs).toBe(60_000);

    const status = getEmailListenerStatus();
    expect(status.consecutiveFailures).toBe(0);
    expect(status.lastError).toBeNull();
    expect(status.lastSuccessAt).not.toBeNull();
  });

  it('an individual pipeline error for one email does not affect backoff state', async () => {
    const { scheduleTimeout, latest } = makeScheduler();
    const fetchEmails = vi.fn().mockResolvedValue([{ from: 'a@x.com', subject: 'Hi', body: 'test' }]);
    const onEmail = vi.fn().mockRejectedValue(new Error('pipeline exploded'));

    startEmailListener(onEmail, { fetchEmails, scheduleTimeout });
    await vi.waitFor(() => expect(scheduleTimeout).toHaveBeenCalledTimes(1));

    // Still counts as a successful poll — the fetch itself succeeded.
    expect(latest().delayMs).toBe(60_000);
    expect(getEmailListenerStatus().consecutiveFailures).toBe(0);
  });
});

describe('startEmailListener — auth failure backs off hard', () => {
  it('schedules the long auth backoff instead of the normal interval', async () => {
    const { scheduleTimeout, latest } = makeScheduler();
    const authError = Object.assign(new Error('Invalid credentials'), { authenticationFailed: true });
    const fetchEmails = vi.fn().mockRejectedValue(authError);

    startEmailListener(vi.fn(), { fetchEmails, scheduleTimeout });
    await vi.waitFor(() => expect(scheduleTimeout).toHaveBeenCalledTimes(1));

    expect(latest().delayMs).toBe(30 * 60_000);

    const status = getEmailListenerStatus();
    expect(status.lastErrorClass).toBe('auth');
    expect(status.consecutiveFailures).toBe(1);
    expect(status.lastError).toMatch(/invalid credentials/i);
  });

  it('does not shorten the auth backoff even after repeated consecutive failures', async () => {
    const { scheduleTimeout, latest, calls } = makeScheduler();
    const authError = Object.assign(new Error('Invalid credentials'), { authenticationFailed: true });
    const fetchEmails = vi.fn().mockRejectedValue(authError);

    startEmailListener(vi.fn(), { fetchEmails, scheduleTimeout });
    await vi.waitFor(() => expect(scheduleTimeout).toHaveBeenCalledTimes(1));
    await calls[0].fn(); // manually fire the next tick
    await vi.waitFor(() => expect(scheduleTimeout).toHaveBeenCalledTimes(2));

    expect(latest().delayMs).toBe(30 * 60_000);
    expect(getEmailListenerStatus().consecutiveFailures).toBe(2);
  });
});

describe('startEmailListener — transient network failure backs off with a cap', () => {
  it('grows the backoff on repeated failures, capped at MAX_NETWORK_BACKOFF_MS', async () => {
    const { scheduleTimeout, calls } = makeScheduler();
    const netError = Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
    const fetchEmails = vi.fn().mockRejectedValue(netError);

    startEmailListener(vi.fn(), { fetchEmails, scheduleTimeout });
    await vi.waitFor(() => expect(scheduleTimeout).toHaveBeenCalledTimes(1));
    expect(calls[0].delayMs).toBe(120_000); // 60s * 2^1

    await calls[0].fn();
    await vi.waitFor(() => expect(scheduleTimeout).toHaveBeenCalledTimes(2));
    expect(calls[1].delayMs).toBe(240_000); // 60s * 2^2

    // Fire enough more ticks to reach the cap.
    for (let i = 1; i < 6; i++) {
      await calls[calls.length - 1].fn();
      await vi.waitFor(() => expect(scheduleTimeout).toHaveBeenCalledTimes(i + 2));
    }

    expect(calls[calls.length - 1].delayMs).toBe(10 * 60_000);
    expect(getEmailListenerStatus().lastErrorClass).toBe('network');
  });

  it('resets consecutiveFailures and returns to the normal interval after a subsequent success', async () => {
    const { scheduleTimeout, calls } = makeScheduler();
    const netError = Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
    const fetchEmails = vi.fn()
      .mockRejectedValueOnce(netError)
      .mockResolvedValueOnce([]);

    startEmailListener(vi.fn(), { fetchEmails, scheduleTimeout });
    await vi.waitFor(() => expect(scheduleTimeout).toHaveBeenCalledTimes(1));
    expect(calls[0].delayMs).toBe(120_000);

    await calls[0].fn();
    await vi.waitFor(() => expect(scheduleTimeout).toHaveBeenCalledTimes(2));

    expect(calls[1].delayMs).toBe(60_000);
    expect(getEmailListenerStatus().consecutiveFailures).toBe(0);
  });
});

describe('startEmailListener — stop()', () => {
  it('clears the pending timer', async () => {
    const clearSpy = vi.spyOn(global, 'clearTimeout');
    const { scheduleTimeout } = makeScheduler();
    const fetchEmails = vi.fn().mockResolvedValue([]);

    const controls = startEmailListener(vi.fn(), { fetchEmails, scheduleTimeout });
    await vi.waitFor(() => expect(scheduleTimeout).toHaveBeenCalledTimes(1));

    controls.stop();
    expect(clearSpy).toHaveBeenCalled();
    clearSpy.mockRestore();
  });
});
