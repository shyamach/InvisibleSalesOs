/**
 * tests/metaSend.test.js
 * Unit tests for lib/metaSend.js (Rule #1 compliance).
 * fetch is mocked — no real Meta API calls.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { normalizePhoneForMeta, sendWhatsAppMessage } from '../lib/metaSend.js';

// ─── normalizePhoneForMeta ────────────────────────────────────────────────────

describe('normalizePhoneForMeta', () => {
  it('strips @c.us suffix (whatsapp-web.js format)', () => {
    expect(normalizePhoneForMeta('447767902011@c.us')).toBe('447767902011');
  });

  it('returns null for @lid device IDs', () => {
    expect(normalizePhoneForMeta('167568534933604@lid')).toBeNull();
  });

  it('passes through clean phone numbers unchanged', () => {
    expect(normalizePhoneForMeta('447767902011')).toBe('447767902011');
  });

  it('strips leading + sign', () => {
    expect(normalizePhoneForMeta('+447767902011')).toBe('447767902011');
  });

  it('strips spaces and dashes', () => {
    expect(normalizePhoneForMeta('+44 7767 902-011')).toBe('447767902011');
  });

  it('returns null for strings that are too short after stripping', () => {
    expect(normalizePhoneForMeta('123')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(normalizePhoneForMeta('')).toBeNull();
  });
});

// ─── sendWhatsAppMessage ──────────────────────────────────────────────────────

describe('sendWhatsAppMessage', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetAllMocks();
    process.env = {
      ...originalEnv,
      WHATSAPP_PHONE_ID: 'test-phone-id',
      WHATSAPP_ACCESS_TOKEN: 'test-token',
    };
    // Reset global fetch mock
    global.fetch = vi.fn();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('returns success with messageId when Meta API succeeds', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        messages: [{ id: 'wamid.abc123' }],
      }),
    });

    const result = await sendWhatsAppMessage('447767902011', 'Hello, test!');

    expect(result.success).toBe(true);
    expect(result.messageId).toBe('wamid.abc123');
  });

  it('sends to the correct Meta endpoint with auth header', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ messages: [{ id: 'wamid.xyz' }] }),
    });

    await sendWhatsAppMessage('447767902011', 'Hello');

    const [url, opts] = global.fetch.mock.calls[0];
    expect(url).toContain('/test-phone-id/messages');
    expect(opts.headers['Authorization']).toBe('Bearer test-token');
    expect(opts.headers['Content-Type']).toBe('application/json');
  });

  it('normalizes phone number with @c.us suffix before sending', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ messages: [{ id: 'wamid.xyz' }] }),
    });

    await sendWhatsAppMessage('447767902011@c.us', 'Hello');

    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(body.to).toBe('447767902011');
  });

  it('returns error without calling fetch for @lid device IDs', async () => {
    const result = await sendWhatsAppMessage('167568534933604@lid', 'Hello');

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/@lid/);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('returns error when WHATSAPP_PHONE_ID is missing', async () => {
    delete process.env.WHATSAPP_PHONE_ID;
    const result = await sendWhatsAppMessage('447767902011', 'Hello');

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/WHATSAPP_PHONE_ID/);
  });

  it('returns error when Meta API responds with non-OK status', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => ({
        error: { message: 'Invalid phone number format' },
      }),
    });

    const result = await sendWhatsAppMessage('447767902011', 'Hello');

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Invalid phone number format/);
  });

  it('returns error on network failure', async () => {
    global.fetch.mockRejectedValueOnce(new Error('Network unreachable'));

    const result = await sendWhatsAppMessage('447767902011', 'Hello');

    expect(result.success).toBe(false);
    expect(result.error).toBe('Network unreachable');
  });
});
