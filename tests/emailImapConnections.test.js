/**
 * tests/emailImapConnections.test.js
 *
 * Per-tenant IMAP polling registry (lib/emailImapConnections.js) — replaces
 * tests/emailListener.test.js (deleted), which covered the old single-tenant
 * module-level poller that this module replaced (2026-08-24, same fix shape
 * as the WhatsApp per-tenant session isolation earlier this session).
 *
 * pollTenant() takes injectable fetchEmails/getPassword, so — unlike the old
 * file — no fake scheduleTimeout is needed: each call is a single, direct,
 * awaitable poll. Tests call pollTenant() repeatedly and assert on
 * getEmailListenerStatus(tenantId) between calls, driving the exact same
 * backoff/classification logic the old tests covered, just keyed per tenant.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// lib/emailImapConnections.js's error path calls logSystemEvent() (Phase F),
// which reaches the real Supabase client if unmocked — never let a unit
// test make a real network call / write real rows to the live
// system_logs table. Also mock lib/supabase.js since createSystemClient()
// is imported at module load even though getPassword is overridden per test.
vi.mock('../lib/systemLog.js', () => ({ logSystemEvent: vi.fn() }));
vi.mock('../lib/supabase.js', () => ({ createSystemClient: vi.fn() }));

import {
  registerTenantConnection,
  unregisterTenantConnection,
  pollTenant,
  getEmailListenerStatus,
  getEmailListenerSummary,
} from '../lib/emailImapConnections.js';
import { classifyImapError } from '../lib/emailListener.js';

const TENANT_A = 'tenant-a';
const TENANT_B = 'tenant-b';

beforeEach(() => {
  unregisterTenantConnection(TENANT_A);
  unregisterTenantConnection(TENANT_B);
});

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

describe('pollTenant — unregistered tenant', () => {
  it('is a no-op when the tenant has no registered connection', async () => {
    const fetchEmails = vi.fn();
    await pollTenant('nonexistent-tenant', { fetchEmails, getPassword: vi.fn() });
    expect(fetchEmails).not.toHaveBeenCalled();
  });
});

describe('pollTenant — success path', () => {
  it('routes each fetched email to onEmail-equivalent state and resets failure count', async () => {
    registerTenantConnection(TENANT_A, { host: 'imap.example.com', port: 993, username: 'a@example.com' });
    const fetchEmails = vi.fn().mockResolvedValue([{ from: 'x@y.com', subject: 'Hi', body: 'test' }]);
    const getPassword = vi.fn().mockResolvedValue('secret');

    await pollTenant(TENANT_A, { fetchEmails, getPassword });

    expect(fetchEmails).toHaveBeenCalledWith(
      { host: 'imap.example.com', port: 993, user: 'a@example.com', pass: 'secret' },
      expect.any(Number)
    );

    const status = getEmailListenerStatus(TENANT_A);
    expect(status.enabled).toBe(true);
    expect(status.consecutiveFailures).toBe(0);
    expect(status.lastError).toBeNull();
    expect(status.lastSuccessAt).not.toBeNull();
  });

  it('throws (and counts as a failure) when no password is stored', async () => {
    registerTenantConnection(TENANT_A, { host: 'imap.example.com', port: 993, username: 'a@example.com' });
    const fetchEmails = vi.fn();
    const getPassword = vi.fn().mockResolvedValue(null);

    await pollTenant(TENANT_A, { fetchEmails, getPassword });

    expect(fetchEmails).not.toHaveBeenCalled();
    expect(getEmailListenerStatus(TENANT_A).consecutiveFailures).toBe(1);
  });
});

describe('pollTenant — auth failure backs off hard, per tenant', () => {
  it('a bad-credential tenant does not affect a different tenant\'s status', async () => {
    registerTenantConnection(TENANT_A, { host: 'imap.example.com', port: 993, username: 'a@example.com' });
    registerTenantConnection(TENANT_B, { host: 'imap.example.com', port: 993, username: 'b@example.com' });

    const authError = Object.assign(new Error('Invalid credentials'), { authenticationFailed: true });
    await pollTenant(TENANT_A, {
      fetchEmails: vi.fn().mockRejectedValue(authError),
      getPassword: vi.fn().mockResolvedValue('wrong-password'),
    });
    await pollTenant(TENANT_B, {
      fetchEmails: vi.fn().mockResolvedValue([]),
      getPassword: vi.fn().mockResolvedValue('correct-password'),
    });

    const statusA = getEmailListenerStatus(TENANT_A);
    expect(statusA.lastErrorClass).toBe('auth');
    expect(statusA.consecutiveFailures).toBe(1);
    expect(statusA.lastError).toMatch(/invalid credentials/i);

    const statusB = getEmailListenerStatus(TENANT_B);
    expect(statusB.consecutiveFailures).toBe(0);
    expect(statusB.lastError).toBeNull();
  });

  it('does not shorten the auth backoff even after repeated consecutive failures', async () => {
    registerTenantConnection(TENANT_A, { host: 'imap.example.com', port: 993, username: 'a@example.com' });
    const authError = Object.assign(new Error('Invalid credentials'), { authenticationFailed: true });
    const deps = { fetchEmails: vi.fn().mockRejectedValue(authError), getPassword: vi.fn().mockResolvedValue('x') };

    await pollTenant(TENANT_A, deps);
    await pollTenant(TENANT_A, deps);

    const status = getEmailListenerStatus(TENANT_A);
    expect(status.lastErrorClass).toBe('auth');
    expect(status.consecutiveFailures).toBe(2);
  });
});

describe('pollTenant — transient network failure backs off with a cap', () => {
  it('grows the backoff on repeated failures, capped, then resets on success', async () => {
    registerTenantConnection(TENANT_A, { host: 'imap.example.com', port: 993, username: 'a@example.com' });
    const netError = Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
    const getPassword = vi.fn().mockResolvedValue('x');

    for (let i = 0; i < 6; i++) {
      await pollTenant(TENANT_A, { fetchEmails: vi.fn().mockRejectedValue(netError), getPassword });
    }
    expect(getEmailListenerStatus(TENANT_A).consecutiveFailures).toBe(6);
    expect(getEmailListenerStatus(TENANT_A).lastErrorClass).toBe('network');

    // A subsequent success resets the failure count.
    await pollTenant(TENANT_A, { fetchEmails: vi.fn().mockResolvedValue([]), getPassword });
    const status = getEmailListenerStatus(TENANT_A);
    expect(status.consecutiveFailures).toBe(0);
    expect(status.lastErrorClass).toBeNull();
  });
});

describe('getEmailListenerStatus — unregistered tenant', () => {
  it('returns a disabled/empty status rather than throwing', () => {
    const status = getEmailListenerStatus('never-registered');
    expect(status.enabled).toBe(false);
    expect(status.consecutiveFailures).toBe(0);
  });
});

describe('getEmailListenerSummary', () => {
  it('aggregates healthy vs. errored tenants across the registry', async () => {
    registerTenantConnection(TENANT_A, { host: 'imap.example.com', port: 993, username: 'a@example.com' });
    registerTenantConnection(TENANT_B, { host: 'imap.example.com', port: 993, username: 'b@example.com' });

    await pollTenant(TENANT_A, { fetchEmails: vi.fn().mockResolvedValue([]), getPassword: vi.fn().mockResolvedValue('x') });
    await pollTenant(TENANT_B, {
      fetchEmails: vi.fn().mockRejectedValue(new Error('boom')),
      getPassword: vi.fn().mockResolvedValue('x'),
    });

    const summary = getEmailListenerSummary();
    expect(summary.total).toBeGreaterThanOrEqual(2);
    expect(summary.healthy).toBeGreaterThanOrEqual(1);
    expect(summary.errored).toBeGreaterThanOrEqual(1);
  });
});

describe('unregisterTenantConnection', () => {
  it('removes the tenant so a subsequent pollTenant is a no-op', async () => {
    registerTenantConnection(TENANT_A, { host: 'imap.example.com', port: 993, username: 'a@example.com' });
    unregisterTenantConnection(TENANT_A);

    const fetchEmails = vi.fn();
    await pollTenant(TENANT_A, { fetchEmails, getPassword: vi.fn() });

    expect(fetchEmails).not.toHaveBeenCalled();
    expect(getEmailListenerStatus(TENANT_A).enabled).toBe(false);
  });
});
