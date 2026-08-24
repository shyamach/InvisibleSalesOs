import crypto from 'crypto';
import { processLeadThroughCognitiveEngine } from '../engine.js';
import { createSystemClient } from '../lib/supabase.js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

// Only used to mint a role:authenticated JWT to call the SECURITY DEFINER
// RPC below with — the RPC's own body ignores this value and is gated on
// the JWT's `purpose` claim instead, same pattern as
// lib/whatsappSessions.js#rehydrateSessions.
const DEFAULT_TENANT_ID = process.env.DEFAULT_TENANT_ID || '00000000-0000-0000-0000-000000000001';

// Resolves a Meta webhook payload's `phone_number_id` (the WhatsApp Business
// number the message arrived on) to the brand_dna.id that
// processLeadThroughCognitiveEngine expects — previously hardcoded to the
// literal `1`, same bug class as wwebjs's DEFAULT_TENANT_ID hardcode fixed
// alongside this (2026-08-23).
//
// An earlier version of this fix queried `tenants`/`brand_dna` via the
// plain anon-key `supabase` singleton and always failed: `tenants`' RLS
// policy requires auth_tenant_id(), and anon's EXECUTE on that function was
// already revoked (Phase D) — every call errored, every message got
// silently dropped (caught live by security-lead review, 2026-08-23). Goes
// through resolve_brand_id_for_whatsapp_phone_id() instead
// (supabase/migrations/phase_i_2_...) — a SECURITY DEFINER RPC gated on a
// backend-only JWT claim, not a raw anon-client table read. Reopening anon
// SELECT on `tenants` is not the fix: that access was deliberately closed
// as a live PII leak (phase_1_14).
async function resolveBrandIdForPhoneNumberId(phoneNumberId) {
  if (!phoneNumberId) return null;

  const { data, error } = await createSystemClient(DEFAULT_TENANT_ID)
    .rpc('resolve_brand_id_for_whatsapp_phone_id', { p_phone_number_id: phoneNumberId });

  if (error) {
    console.error('💥 [WhatsApp Ingest]: Tenant resolution RPC failed —', error.message);
    return null;
  }

  return data?.[0]?.brand_id ?? null;
}

// Verifies Meta's X-Hub-Signature-256 header — an HMAC-SHA256 of the exact
// raw request body, keyed with the WhatsApp app secret — before trusting
// anything in the payload. Previously entirely unchecked (a standing,
// tracked gap; see .claude/agents/security-lead.md item 6), which was
// lower-blast-radius while every message was misattributed to a single
// hardcoded brand id regardless of payload content. Now that
// resolveBrandIdForPhoneNumberId above resolves a REAL tenant from
// attacker-controllable payload data (phone_number_id), an unsigned POST
// with a known/guessed phone_number_id would let anyone inject fake
// "customer" messages into that tenant's real lead pipeline — so this had
// to ship in the same change, not stay deferred (security-lead review,
// 2026-08-23). Fails closed: missing secret, missing/malformed header, or a
// mismatch are all treated identically — reject, don't process.
function isValidMetaSignature(req) {
  const appSecret = process.env.META_APP_SECRET;
  if (!appSecret) {
    console.error('🚨 [WhatsApp Webhook]: META_APP_SECRET not configured — rejecting all webhook POSTs (fail closed).');
    return false;
  }

  const signatureHeader = req.headers?.['x-hub-signature-256'];
  if (typeof signatureHeader !== 'string' || !signatureHeader.startsWith('sha256=')) {
    return false;
  }

  if (!req.rawBody) {
    console.error('🚨 [WhatsApp Webhook]: req.rawBody missing — cannot verify signature.');
    return false;
  }

  const expected = crypto.createHmac('sha256', appSecret).update(req.rawBody).digest('hex');
  const provided = signatureHeader.slice('sha256='.length);

  const expectedBuf = Buffer.from(expected, 'hex');
  const providedBuf = Buffer.from(provided, 'hex');
  if (expectedBuf.length !== providedBuf.length) return false;

  return crypto.timingSafeEqual(expectedBuf, providedBuf);
}

// -------------------------------------------------------------------
// 1. THE SECURITY HANDSHAKE (GET)
// Meta uses this to verify you actually own the webhook endpoint.
// -------------------------------------------------------------------
export const verifyWhatsAppWebhook = (req, res) => {
    const verify_token = process.env.META_WEBHOOK_VERIFY_TOKEN || process.env.WHATSAPP_VERIFY_TOKEN;
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    console.log(`\n🔒 [Meta Security Watchdog]: Handshake request intercepted from Facebook Cloud.`);

    if (mode && token) {
        if (mode === "subscribe" && token === verify_token) {
            console.log("✅ [Security Verified]: Webhook binding successfully authenticated with Meta.");
            return res.status(200).send(challenge);
        } else {
            console.error("❌ [Security Breach]: Webhook handshake failed. Token mismatch.");
            return res.sendStatus(403);
        }
    }
    return res.sendStatus(400);
};

// -------------------------------------------------------------------
// 2. THE DATA INGESTION STREAM (POST)
// Receives live text messages from users on their mobile phones.
// -------------------------------------------------------------------
export const processWhatsAppWebhook = async (req, res) => {
    // Verify BEFORE acking — an unsigned/forged request gets no 200 at all,
    // it's just rejected outright. Only a genuine Meta-signed delivery gets
    // the "ack now, process after" treatment below.
    if (!isValidMetaSignature(req)) {
        console.error('🚨 [WhatsApp Webhook]: Rejected — invalid or missing X-Hub-Signature-256.');
        return res.sendStatus(401);
    }

    // Meta requires a 200 OK immediately, or they will retry sending the message.
    res.sendStatus(200);

    const body = req.body;

    try {
        // Validate it is a WhatsApp API status update or message
        if (body.object !== "whatsapp_business_account") return;
        
        const entry = body.entry?.[0];
        const changes = entry?.changes?.[0]?.value;
        
        // Isolate actual user messages (ignore delivery receipts and status updates)
        if (changes?.messages && changes.messages.length > 0) {
            const messageObj = changes.messages[0];
            const contactObj = changes.contacts?.[0];
            
            const rawSenderPhone = messageObj.from; // User's phone number
            const senderName = contactObj?.profile?.name || "Unknown Prospect";
            
            let messageText = "";

            // Extract the text depending on message type
            if (messageObj.type === "text") {
                messageText = messageObj.text.body;
            } else if (messageObj.type === "button") {
                messageText = messageObj.button.text;
            } else if (messageObj.type === "interactive") {
                messageText = messageObj.interactive.button_reply?.title || messageObj.interactive.list_reply?.title;
            } else {
                console.warn(`⚠️ [WhatsApp Ingest]: Unsupported message type received: [${messageObj.type}]`);
                return;
            }

            console.log(`\n📱 [Live WhatsApp Intercept]: Stream from +${rawSenderPhone}`);
            console.log(`💬 Message Payload: "${messageText}"`);

            // Compile the data for the Cognitive Brain
            const compiledPayload = `
                [SOURCE CHANNEL: WHATSAPP]
                [SENDER NAME: ${senderName}]
                [SENDER PHONE: +${rawSenderPhone}]
                [MESSAGE]: ${messageText}
            `;

            // Resolve which tenant this number belongs to from the webhook's
            // own metadata — was hardcoded to brand id 1 (every tenant's
            // messages misattributed to one tenant), fixed 2026-08-23
            // alongside the same bug in the wwebjs ingestion path.
            const phoneNumberId = changes.metadata?.phone_number_id;
            const brandId = await resolveBrandIdForPhoneNumberId(phoneNumberId);

            if (!brandId) {
                console.warn(`⚠️ [WhatsApp Ingest]: No tenant found for phone_number_id "${phoneNumberId}" — dropping message.`);
                return;
            }

            // Hand off to the master engine core
            const engineResult = await processLeadThroughCognitiveEngine(
                compiledPayload, 'text', 'whatsapp-inbound-stream', brandId
            );

            if (!engineResult.success) {
                console.error("❌ [WhatsApp Handoff Error]: Engine execution failed.", engineResult.error);
            }
        }
    } catch (error) {
        console.error("🚨 [WhatsApp Processing Fatal Error]:", error);
    }
};