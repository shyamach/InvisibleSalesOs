/**
 * lib/channelRouter.js — Reply-channel resolver.
 *
 * Pure, side-effect-free. Decides which channel (and which address on that
 * channel) an outbound reply should go to, following the board's preference
 * hierarchy (2026-06-28):
 *
 *   (a) contact.preferred_channel        — the person's stored standing preference
 *   (b) lead.requested_channel           — an explicit request in THIS message
 *   (c) lead.source_channel              — the channel the message originated on
 *   (d) tenant default                   — tenantSettings.default_channel
 *   (—) hard fallback                    — 'whatsapp'
 *
 * Each tier only "wins" if we can actually resolve a deliverable address for
 * its channel; otherwise we fall through to the next tier. This keeps the
 * router from confidently routing to, say, email when we hold no email address.
 *
 * Returns STRUCTURED JSON (Rule #2): { channel, address, source, reason }.
 */

// Channels we can route to. 'manual' = no automated channel; a human handles it.
export const SUPPORTED_CHANNELS = Object.freeze([
  'whatsapp',
  'email',
  'sms',
  'instagram',
  'messenger',
  'manual',
]);

const ALIASES = {
  wa: 'whatsapp',
  whatsapp: 'whatsapp',
  'whats-app': 'whatsapp',
  mail: 'email',
  'e-mail': 'email',
  email: 'email',
  text: 'sms',
  sms: 'sms',
  ig: 'instagram',
  insta: 'instagram',
  instagram: 'instagram',
  fb: 'messenger',
  messenger: 'messenger',
  'fb-messenger': 'messenger',
  manual: 'manual',
};

/**
 * Normalise an arbitrary channel string to a supported channel, or null.
 * @param {*} value
 * @returns {string|null}
 */
export function normaliseChannel(value) {
  if (typeof value !== 'string') return null;
  const key = value.trim().toLowerCase();
  return ALIASES[key] || (SUPPORTED_CHANNELS.includes(key) ? key : null);
}

/**
 * Derive a clean reply channel from an arbitrary "source"/origin string.
 *
 * The engine tags leads with origin strings like 'whatsapp-inbound-stream',
 * 'email-imap', 'form:generic', 'global-webhook'. This maps those to a clean
 * channel so the originating-channel tier works. Inbound-only sources that
 * aren't a reply channel (forms, generic webhooks) return null.
 *
 * @param {*} value
 * @returns {string|null}
 */
export function deriveChannelFromSource(value) {
  if (typeof value !== 'string') return null;
  const s = value.trim().toLowerCase();
  if (!s) return null;

  // Exact / alias match first.
  const direct = normaliseChannel(s);
  if (direct) return direct;

  // Substring detection for compound origin tags.
  if (s.includes('whatsapp') || /(^|[^a-z])wa([^a-z]|$)/.test(s)) return 'whatsapp';
  if (s.includes('email') || s.includes('mail') || s.includes('imap') || s.includes('smtp')) return 'email';
  if (s.includes('instagram') || s.includes('insta')) return 'instagram';
  if (s.includes('messenger')) return 'messenger';
  if (s.includes('sms')) return 'sms';

  // Forms / generic webhooks are inbound-only — not a reply channel.
  return null;
}

/**
 * Resolve the deliverable address for a given channel from the contact's
 * endpoint map, falling back to identifiers carried on the lead itself.
 * Returns null when no address is available (e.g. 'manual', or we simply
 * don't hold one).
 *
 * @param {string} channel
 * @param {Object} contact
 * @param {Object} lead
 * @returns {string|null}
 */
export function resolveAddress(channel, contact = {}, lead = {}) {
  const channels = (contact && typeof contact.channels === 'object' && contact.channels) || {};
  const fromContact = (k) => (typeof channels[k] === 'string' && channels[k].trim() ? channels[k].trim() : null);

  switch (channel) {
    case 'whatsapp':
      return fromContact('whatsapp') || lead.phone_number || lead.lead_channel_id || lead.phone || null;
    case 'sms':
      return fromContact('sms') || lead.phone_number || lead.phone || null;
    case 'email':
      return fromContact('email') || lead.email || null;
    case 'instagram':
      return fromContact('instagram') || null;
    case 'messenger':
      return fromContact('messenger') || null;
    case 'manual':
      return null;
    default:
      return null;
  }
}

/**
 * Resolve the channel + address for an outbound reply.
 *
 * @param {Object} args
 * @param {Object} [args.contact]        — { preferred_channel, channels }
 * @param {Object} [args.lead]           — { requested_channel, source_channel, phone_number, email, ... }
 * @param {Object} [args.tenantSettings] — tenant.settings ({ default_channel })
 * @returns {{ channel: string, address: string|null, source: string, reason: string }}
 */
export function resolveReplyChannel({ contact = null, lead = null, tenantSettings = null } = {}) {
  const c = contact || {};
  const l = lead || {};
  const t = tenantSettings || {};

  // Ordered candidate tiers — first one that yields a deliverable address wins.
  const tiers = [
    { source: 'contact_preference', channel: normaliseChannel(c.preferred_channel) },
    { source: 'explicit_request', channel: normaliseChannel(l.requested_channel) },
    { source: 'originating_channel', channel: deriveChannelFromSource(l.source_channel) },
    { source: 'tenant_default', channel: normaliseChannel(t.default_channel) },
  ];

  let firstValid = null; // remember the highest-priority valid channel for the no-address case

  for (const tier of tiers) {
    if (!tier.channel) continue;
    if (!firstValid) firstValid = tier;

    // 'manual' is a deliberate terminal choice — honour it immediately.
    if (tier.channel === 'manual') {
      return { channel: 'manual', address: null, source: tier.source, reason: `${tier.source} → manual handling` };
    }

    const address = resolveAddress(tier.channel, c, l);
    if (address) {
      return {
        channel: tier.channel,
        address,
        source: tier.source,
        reason: `${tier.source} resolved to ${tier.channel}`,
      };
    }
  }

  // No tier produced a deliverable address.
  if (firstValid) {
    return {
      channel: firstValid.channel,
      address: null,
      source: firstValid.source,
      reason: `${firstValid.source} chose ${firstValid.channel} but no deliverable address found`,
    };
  }

  // Nothing usable anywhere — hard fallback to whatsapp, best-effort address.
  const fallbackAddress = resolveAddress('whatsapp', c, l);
  return {
    channel: 'whatsapp',
    address: fallbackAddress,
    source: 'fallback',
    reason: 'no channel preference resolvable — defaulted to whatsapp',
  };
}
