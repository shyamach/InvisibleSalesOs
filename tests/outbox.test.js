/**
 * tests/outbox.test.js
 * Rule #1 coverage for the router-driven dispatch authority (outbox.js).
 * Transport libs are mocked — no Meta/Resend calls.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockWa = vi.hoisted(() => vi.fn());
const mockEmail = vi.hoisted(() => vi.fn());

vi.mock('../lib/metaSend.js', () => ({
  sendWhatsAppMessage: mockWa,
  normalizePhoneForMeta: (x) => x,
}));
vi.mock('../lib/emailSend.js', () => ({
  sendEmailReply: mockEmail,
}));

import { dispatchOutreachMessage } from '../outbox.js';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('dispatchOutreachMessage — WhatsApp', () => {
  it('sends via Meta and reports delivered on success', async () => {
    mockWa.mockResolvedValueOnce({ success: true, messageId: 'wamid.123' });
    const r = await dispatchOutreachMessage(
      { preferred_channel: 'whatsapp', phone: '+447700111222' },
      'Hello there'
    );
    expect(mockWa).toHaveBeenCalledWith('+447700111222', 'Hello there');
    expect(r).toMatchObject({ dispatched: true, channel: 'whatsapp', status: 'delivered', messageId: 'wamid.123' });
    expect(mockEmail).not.toHaveBeenCalled();
  });

  it('reports failed when Meta send fails', async () => {
    mockWa.mockResolvedValueOnce({ success: false, error: 'token expired' });
    const r = await dispatchOutreachMessage({ preferred_channel: 'whatsapp', phone: '+447700111222' }, 'Hi');
    expect(r).toMatchObject({ dispatched: false, channel: 'whatsapp', status: 'failed', error: 'token expired' });
  });
});

describe('dispatchOutreachMessage — Email', () => {
  it('routes to email via contact preference and sends via Resend', async () => {
    mockEmail.mockResolvedValueOnce({ success: true, id: 're_abc' });
    const r = await dispatchOutreachMessage(
      {
        contact: { preferred_channel: 'email', channels: { email: 'buyer@acme.co.uk' } },
        phone: '+447700111222',
        product_interest: 'basmati rice',
      },
      'Quote attached.'
    );
    expect(mockEmail).toHaveBeenCalledWith({
      to: 'buyer@acme.co.uk',
      subject: 'Re: basmati rice',
      text: 'Quote attached.',
    });
    expect(r).toMatchObject({ dispatched: true, channel: 'email', status: 'sent', messageId: 're_abc' });
    expect(mockWa).not.toHaveBeenCalled();
  });

  it('routes to email via explicit preferred_channel + lead email', async () => {
    mockEmail.mockResolvedValueOnce({ success: true, id: 're_def' });
    const r = await dispatchOutreachMessage({ preferred_channel: 'email', email: 'lead@x.com' }, 'Hi');
    expect(mockEmail).toHaveBeenCalled();
    expect(r.channel).toBe('email');
    expect(r.address).toBe('lead@x.com');
  });

  it('uses the default subject when no product interest is present', async () => {
    mockEmail.mockResolvedValueOnce({ success: true, id: 're_ghi' });
    await dispatchOutreachMessage({ preferred_channel: 'email', email: 'lead@x.com' }, 'Hi');
    expect(mockEmail.mock.calls[0][0].subject).toBe('Re: your enquiry');
  });
});

describe('dispatchOutreachMessage — non-sending outcomes', () => {
  it('does not send for a manual channel', async () => {
    const r = await dispatchOutreachMessage({ contact: { preferred_channel: 'manual' }, phone: '+447700111222' }, 'Hi');
    expect(r).toMatchObject({ dispatched: false, channel: 'manual', status: 'manual' });
    expect(mockWa).not.toHaveBeenCalled();
    expect(mockEmail).not.toHaveBeenCalled();
  });

  it('reports no_address when the chosen channel has no endpoint', async () => {
    const r = await dispatchOutreachMessage({ preferred_channel: 'email' }, 'Hi'); // no email anywhere
    expect(r).toMatchObject({ dispatched: false, status: 'no_address' });
    expect(mockEmail).not.toHaveBeenCalled();
  });

  it('reports unsupported_channel for a not-yet-wired channel (sms)', async () => {
    const r = await dispatchOutreachMessage({ preferred_channel: 'sms', phone: '+447700111222' }, 'Hi');
    expect(r).toMatchObject({ dispatched: false, channel: 'sms', status: 'unsupported_channel' });
    expect(mockWa).not.toHaveBeenCalled();
  });

  it('honours a pre-resolved route, skipping the router', async () => {
    mockWa.mockResolvedValueOnce({ success: true, messageId: 'wamid.x' });
    const r = await dispatchOutreachMessage({}, 'Hi', { channel: 'whatsapp', address: '+447000000000', source: 'preset' });
    expect(mockWa).toHaveBeenCalledWith('+447000000000', 'Hi');
    expect(r.source).toBe('preset');
  });
});
