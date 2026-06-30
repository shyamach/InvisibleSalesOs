/**
 * outbox.js — Unified outbound dispatch authority.
 *
 * Single place where a generated draft becomes a real message. Channel + address
 * are resolved by the pure channel router (lib/channelRouter.js), then routed to
 * the appropriate transport:
 *   - whatsapp → lib/metaSend.sendWhatsAppMessage (Meta Cloud API)
 *   - email    → lib/emailSend.sendEmailReply     (Resend)
 *   - sms / instagram / messenger → not yet wired (Phase 2)
 *   - manual   → deliberately not sent (human handles it)
 *
 * Both the cognitive engine and the auto-reply sweeper call this, so channel
 * resolution behaves identically everywhere.
 */
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { resolveReplyChannel } from './lib/channelRouter.js';
import { sendWhatsAppMessage } from './lib/metaSend.js';
import { sendEmailReply } from './lib/emailSend.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '.env.local') });

const DEFAULT_EMAIL_SUBJECT = 'Re: your enquiry';

/**
 * Dispatch a draft on the best channel for this lead.
 *
 * @param {Object} profile      — lead/contact context. Recognised fields:
 *   { contact, tenantSettings, preferred_channel, requested_channel,
 *     source_channel, phone, phone_number, lead_channel_id, email,
 *     product_interest, email_subject }
 * @param {string} draftText    — message body
 * @param {Object|null} [route] — pre-resolved { channel, address } (skips routing)
 * @returns {Promise<{dispatched:boolean, channel:string, address:string|null, status:string, messageId?:string, error?:string, source:string}>}
 */
export async function dispatchOutreachMessage(profile = {}, draftText = '', route = null) {
  const resolved =
    route ||
    resolveReplyChannel({
      contact: profile.contact || null,
      lead: {
        // parser/contact preference for THIS message is treated as the explicit request
        requested_channel: profile.requested_channel || profile.preferred_channel,
        source_channel: profile.source_channel,
        phone_number: profile.phone || profile.phone_number,
        lead_channel_id: profile.lead_channel_id,
        email: profile.email,
      },
      tenantSettings: profile.tenantSettings || null,
    });

  const { channel, address, source } = resolved;

  console.log(`\n⚡ [Outbox]: Resolved channel → ${channel?.toUpperCase()} (${source})`);

  // Manual handling — intentionally not auto-sent.
  if (channel === 'manual') {
    return { dispatched: false, channel: 'manual', address: null, status: 'manual', source };
  }

  // We picked a channel but hold no deliverable address for it.
  if (!address) {
    console.warn(`⚠️ [Outbox]: No deliverable address for ${channel} — skipping dispatch.`);
    return { dispatched: false, channel, address: null, status: 'no_address', source };
  }

  // ── WhatsApp ────────────────────────────────────────────────────────────────
  if (channel === 'whatsapp') {
    const r = await sendWhatsAppMessage(address, draftText);
    return {
      dispatched: r.success,
      channel,
      address,
      status: r.success ? 'delivered' : 'failed',
      messageId: r.messageId,
      error: r.error,
      source,
    };
  }

  // ── Email ─────────────────────────────────────────────────────────────────────
  if (channel === 'email') {
    const subject =
      profile.email_subject ||
      (profile.product_interest ? `Re: ${profile.product_interest}` : DEFAULT_EMAIL_SUBJECT);
    const r = await sendEmailReply({ to: address, subject, text: draftText });
    return {
      dispatched: r.success,
      channel,
      address,
      status: r.success ? 'sent' : 'failed',
      messageId: r.id,
      error: r.error,
      source,
    };
  }

  // ── Not yet wired (Phase 2): sms, instagram, messenger ───────────────────────
  console.warn(`⚠️ [Outbox]: Channel "${channel}" is not yet supported for dispatch.`);
  return { dispatched: false, channel, address, status: 'unsupported_channel', source };
}
