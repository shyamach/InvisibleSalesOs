/**
 * tests/emailSend.test.js
 * Unit tests for lib/emailSend.js
 * fetch is mocked — no real Resend API calls.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { sendEmailReply } from '../lib/emailSend.js';

describe('sendEmailReply', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetAllMocks();
    process.env = {
      ...originalEnv,
      RESEND_API_KEY: 'test-resend-key',
      RESEND_FROM_EMAIL: 'sales@example.com',
    };
    global.fetch = vi.fn();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  // ─── Success path ───────────────────────────────────────────────────────────

  it('returns success with id when Resend API responds 200', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: 're_abc123xyz' }),
    });

    const result = await sendEmailReply({
      to: 'prospect@corp.com',
      subject: 'Re: Your enquiry',
      text: 'Thank you for reaching out...',
    });

    expect(result.success).toBe(true);
    expect(result.id).toBe('re_abc123xyz');
  });

  it('sends to correct Resend endpoint with Authorization header', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: 're_xyz' }),
    });

    await sendEmailReply({
      to: 'test@example.com',
      subject: 'Hello',
      text: 'Message body',
    });

    const [url, opts] = global.fetch.mock.calls[0];
    expect(url).toBe('https://api.resend.com/emails');
    expect(opts.headers['Authorization']).toBe('Bearer test-resend-key');
    expect(opts.headers['Content-Type']).toBe('application/json');
  });

  it('sends correct payload including from, to, subject, text', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: 're_abc' }),
    });

    await sendEmailReply({
      to: 'prospect@corp.com',
      subject: 'Re: Your quote',
      text: 'Here is our proposal...',
    });

    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(body.from).toBe('sales@example.com');
    expect(body.to).toBe('prospect@corp.com');
    expect(body.subject).toBe('Re: Your quote');
    expect(body.text).toBe('Here is our proposal...');
  });

  // ─── Failure path (API error) ───────────────────────────────────────────────

  it('returns error when Resend API responds with non-OK status', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => ({ message: 'Invalid email address' }),
    });

    const result = await sendEmailReply({
      to: 'bad-email',
      subject: 'Test',
      text: 'Body',
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Invalid email address/);
  });

  it('returns error on network failure without throwing', async () => {
    global.fetch.mockRejectedValueOnce(new Error('Network unreachable'));

    const result = await sendEmailReply({
      to: 'prospect@corp.com',
      subject: 'Test',
      text: 'Body',
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe('Network unreachable');
  });

  // ─── Missing API key ────────────────────────────────────────────────────────

  it('returns error without calling fetch when RESEND_API_KEY is missing', async () => {
    delete process.env.RESEND_API_KEY;

    const result = await sendEmailReply({
      to: 'prospect@corp.com',
      subject: 'Test',
      text: 'Body',
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/RESEND_API_KEY/);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('returns error without calling fetch when RESEND_FROM_EMAIL is missing', async () => {
    delete process.env.RESEND_FROM_EMAIL;

    const result = await sendEmailReply({
      to: 'prospect@corp.com',
      subject: 'Test',
      text: 'Body',
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/RESEND_FROM_EMAIL/);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('returns error without calling fetch when recipient address is missing', async () => {
    const result = await sendEmailReply({
      to: '',
      subject: 'Test',
      text: 'Body',
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/recipient/);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
