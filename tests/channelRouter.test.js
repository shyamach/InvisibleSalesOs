/**
 * tests/channelRouter.test.js
 * Rule #1 coverage for the reply-channel resolver (lib/channelRouter.js).
 * Pure functions — deterministic, no mocks.
 */
import { describe, it, expect } from 'vitest';
import {
  resolveReplyChannel,
  resolveAddress,
  normaliseChannel,
  deriveChannelFromSource,
  SUPPORTED_CHANNELS,
} from '../lib/channelRouter.js';

describe('normaliseChannel', () => {
  it('passes through supported channels', () => {
    for (const ch of SUPPORTED_CHANNELS) expect(normaliseChannel(ch)).toBe(ch);
  });

  it('resolves common aliases', () => {
    expect(normaliseChannel('WA')).toBe('whatsapp');
    expect(normaliseChannel('e-mail')).toBe('email');
    expect(normaliseChannel('Text')).toBe('sms');
    expect(normaliseChannel('IG')).toBe('instagram');
    expect(normaliseChannel('fb')).toBe('messenger');
  });

  it('returns null for unknown or non-string input', () => {
    expect(normaliseChannel('carrier-pigeon')).toBeNull();
    expect(normaliseChannel(null)).toBeNull();
    expect(normaliseChannel(42)).toBeNull();
  });
});

describe('resolveAddress', () => {
  const contact = { channels: { whatsapp: '+447700111222', email: 'buyer@acme.co.uk' } };
  const lead = { phone_number: '+447900000000', email: 'lead@fallback.com' };

  it('prefers the contact channel endpoint', () => {
    expect(resolveAddress('whatsapp', contact, lead)).toBe('+447700111222');
    expect(resolveAddress('email', contact, lead)).toBe('buyer@acme.co.uk');
  });

  it('falls back to lead identifiers when contact has no endpoint', () => {
    expect(resolveAddress('whatsapp', {}, lead)).toBe('+447900000000');
    expect(resolveAddress('email', {}, lead)).toBe('lead@fallback.com');
  });

  it('returns null for manual and for channels with no address', () => {
    expect(resolveAddress('manual', contact, lead)).toBeNull();
    expect(resolveAddress('instagram', {}, {})).toBeNull();
  });
});

describe('deriveChannelFromSource', () => {
  it('maps compound origin tags to clean channels', () => {
    expect(deriveChannelFromSource('whatsapp-inbound-stream')).toBe('whatsapp');
    expect(deriveChannelFromSource('email-imap')).toBe('email');
    expect(deriveChannelFromSource('imap-poll')).toBe('email');
    expect(deriveChannelFromSource('instagram-dm')).toBe('instagram');
  });

  it('returns null for inbound-only / non-reply sources', () => {
    expect(deriveChannelFromSource('form:generic')).toBeNull();
    expect(deriveChannelFromSource('global-webhook')).toBeNull();
    expect(deriveChannelFromSource(null)).toBeNull();
    expect(deriveChannelFromSource('')).toBeNull();
  });

  it('still handles clean channel names and aliases', () => {
    expect(deriveChannelFromSource('email')).toBe('email');
    expect(deriveChannelFromSource('WA')).toBe('whatsapp');
  });
});

// The core "make email symmetric" use cases: with no explicit request and no
// stored contact preference, the reply goes back on the channel they used.
describe('resolveReplyChannel — channel symmetry (no explicit preference)', () => {
  it('email-origin lead replies on email', () => {
    const r = resolveReplyChannel({
      contact: null,
      lead: { source_channel: 'email-imap', email: 'buyer@acme.co.uk', requested_channel: null },
    });
    expect(r.channel).toBe('email');
    expect(r.address).toBe('buyer@acme.co.uk');
    expect(r.source).toBe('originating_channel');
  });

  it('whatsapp-origin lead replies on whatsapp', () => {
    const r = resolveReplyChannel({
      contact: null,
      lead: { source_channel: 'whatsapp-inbound-stream', phone_number: '+447700111222', requested_channel: null },
    });
    expect(r.channel).toBe('whatsapp');
    expect(r.address).toBe('+447700111222');
    expect(r.source).toBe('originating_channel');
  });

  it('an explicit request still overrides the originating channel', () => {
    const r = resolveReplyChannel({
      contact: null,
      lead: { source_channel: 'whatsapp-inbound-stream', requested_channel: 'email', email: 'x@y.com', phone_number: '+447700111222' },
    });
    expect(r.channel).toBe('email');
    expect(r.source).toBe('explicit_request');
  });

  it('a stored contact preference still beats the originating channel', () => {
    const r = resolveReplyChannel({
      contact: { preferred_channel: 'email', channels: { email: 'pref@acme.co.uk' } },
      lead: { source_channel: 'whatsapp-inbound-stream', phone_number: '+447700111222', requested_channel: null },
    });
    expect(r.channel).toBe('email');
    expect(r.source).toBe('contact_preference');
  });
});

describe('resolveReplyChannel — hierarchy precedence', () => {
  it('(a) contact.preferred_channel wins over everything when address exists', () => {
    const r = resolveReplyChannel({
      contact: { preferred_channel: 'email', channels: { email: 'pref@acme.co.uk' } },
      lead: { requested_channel: 'whatsapp', source_channel: 'whatsapp', phone_number: '+447900000000' },
      tenantSettings: { default_channel: 'sms' },
    });
    expect(r.channel).toBe('email');
    expect(r.address).toBe('pref@acme.co.uk');
    expect(r.source).toBe('contact_preference');
  });

  it('(b) explicit request wins when no contact preference', () => {
    const r = resolveReplyChannel({
      contact: { channels: { email: 'x@y.com' } },
      lead: { requested_channel: 'email', source_channel: 'whatsapp' },
      tenantSettings: { default_channel: 'whatsapp' },
    });
    expect(r.channel).toBe('email');
    expect(r.source).toBe('explicit_request');
  });

  it('(c) originating channel wins when no preference or explicit request', () => {
    const r = resolveReplyChannel({
      contact: {},
      lead: { source_channel: 'whatsapp', phone_number: '+447900000000' },
      tenantSettings: { default_channel: 'email' },
    });
    expect(r.channel).toBe('whatsapp');
    expect(r.source).toBe('originating_channel');
  });

  it('(d) tenant default wins as last configured tier', () => {
    const r = resolveReplyChannel({
      contact: {},
      lead: { email: 'lead@fallback.com' },
      tenantSettings: { default_channel: 'email' },
    });
    expect(r.channel).toBe('email');
    expect(r.source).toBe('tenant_default');
  });
});

describe('resolveReplyChannel — address-aware fall-through', () => {
  it('skips a higher tier with no deliverable address and uses the next', () => {
    // Contact prefers email but we hold no email address anywhere → fall to originating whatsapp.
    const r = resolveReplyChannel({
      contact: { preferred_channel: 'email', channels: {} },
      lead: { source_channel: 'whatsapp', phone_number: '+447900000000' },
      tenantSettings: {},
    });
    expect(r.channel).toBe('whatsapp');
    expect(r.address).toBe('+447900000000');
    expect(r.source).toBe('originating_channel');
  });

  it('returns the top valid channel with null address when nothing is deliverable', () => {
    const r = resolveReplyChannel({
      contact: { preferred_channel: 'instagram', channels: {} },
      lead: {},
      tenantSettings: {},
    });
    expect(r.channel).toBe('instagram');
    expect(r.address).toBeNull();
    expect(r.reason).toMatch(/no deliverable address/);
  });
});

describe('resolveReplyChannel — manual + edge cases', () => {
  it('honours an explicit manual preference immediately (null address)', () => {
    const r = resolveReplyChannel({
      contact: { preferred_channel: 'manual', channels: { whatsapp: '+447700111222' } },
      lead: { source_channel: 'whatsapp' },
    });
    expect(r.channel).toBe('manual');
    expect(r.address).toBeNull();
  });

  it('hard-falls back to whatsapp when no tier is configured at all', () => {
    const r = resolveReplyChannel({
      contact: {},
      lead: { phone_number: '+447900000000' },
      tenantSettings: {},
    });
    expect(r.channel).toBe('whatsapp');
    expect(r.address).toBe('+447900000000');
    expect(r.source).toBe('fallback');
  });

  it('never throws on empty / undefined input and returns the documented shape', () => {
    const r = resolveReplyChannel();
    expect(r).toMatchObject({
      channel: expect.any(String),
      source: expect.any(String),
      reason: expect.any(String),
    });
    expect(r).toHaveProperty('address');
  });
});
