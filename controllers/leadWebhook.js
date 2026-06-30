/**
 * controllers/leadWebhook.js — Generic form webhook (POST /webhook/lead).
 *
 * Hardened ingestion endpoint for Tally / Typeform / Google Forms etc.
 * Security Lead requirements: rate limiting + Zod validation + (optional)
 * per-deploy shared secret. Channel-agnostic: a form lead can arrive with an
 * email, a phone, or both, and is routed through the same cognitive engine as
 * WhatsApp/email — so email is a first-class channel here.
 *
 * The pure `processFormLead({ body, headers, ip, deps })` core takes all of its
 * collaborators as injected `deps`, making it fully unit-testable without
 * Express, Supabase, or the AI engine. The Express `handleFormLead` wires the
 * real implementations.
 */
import { supabase } from '../lib/supabase.js';
import { processLeadThroughCognitiveEngine } from '../engine.js';
import { createRateLimiter } from '../lib/rateLimiter.js';
import { formLeadSchema } from '../lib/webhookLeadSchema.js';
import { processFormLead } from '../lib/formLeadCore.js';

const DEFAULT_TENANT_ID = process.env.DEFAULT_TENANT_ID || '00000000-0000-0000-0000-000000000001';

// Pure core lives in lib/formLeadCore.js (kept import-light for testability).
export { processFormLead };

// ─── Real dependency implementations ──────────────────────────────────────────

// Module-level singleton so the window persists across requests.
const formRateLimiter = createRateLimiter({
  windowMs: Number(process.env.WEBHOOK_RATE_WINDOW_MS) || 60_000,
  max: Number(process.env.WEBHOOK_RATE_MAX) || 30,
});

/** Upsert a contact by matching email/phone within the tenant's channel map. */
async function upsertContact({ tenantId, data }) {
  const channels = {};
  if (data.email) channels.email = data.email;
  if (data.phone) channels.whatsapp = data.phone; // phone assumed WhatsApp-reachable
  const preferred = data.channel || (data.email && !data.phone ? 'email' : 'whatsapp');

  // Find an existing contact by any known endpoint.
  let existing = null;
  if (data.email) {
    const { data: rows } = await supabase
      .from('contacts')
      .select('id')
      .eq('tenant_id', tenantId)
      .contains('channels', { email: data.email })
      .is('deleted_at', null)
      .limit(1);
    existing = rows?.[0] || null;
  }
  if (!existing && data.phone) {
    const { data: rows } = await supabase
      .from('contacts')
      .select('id')
      .eq('tenant_id', tenantId)
      .contains('channels', { whatsapp: data.phone })
      .is('deleted_at', null)
      .limit(1);
    existing = rows?.[0] || null;
  }

  if (existing) {
    const patch = { preferred_channel: preferred, channels };
    if (data.name) patch.name = data.name;
    if (data.company) patch.company_name = data.company;
    await supabase.from('contacts').update(patch).eq('id', existing.id);
    return { id: existing.id };
  }

  const { data: created, error } = await supabase
    .from('contacts')
    .insert({
      tenant_id: tenantId,
      name: data.name || null,
      company_name: data.company || null,
      preferred_channel: preferred,
      channels,
    })
    .select('id')
    .single();

  if (error) throw error;
  return created;
}

/** Build a compiled payload and run it through the engine. */
async function runEngine({ data }) {
  const payload = [
    `[SOURCE CHANNEL: FORM${data.source ? ` / ${data.source}` : ''}]`,
    `[SENDER NAME: ${data.name || 'Unknown Prospect'}]`,
    `[COMPANY: ${data.company || '—'}]`,
    `[EMAIL: ${data.email || '—'}]`,
    `[PHONE: ${data.phone || '—'}]`,
    `[PREFERRED CHANNEL: ${data.channel || '(unset)'}]`,
    `[MESSAGE]: ${data.message}`,
  ].join('\n');

  return processLeadThroughCognitiveEngine(payload, 'text', `form:${data.source || 'generic'}`, 1);
}

/** Attach the engine-created lead to the contact row. */
async function linkLeadContact(leadId, contactId) {
  await supabase.from('smart_leads').update({ contact_id: contactId }).eq('id', leadId);
}

// ─── Express handler ──────────────────────────────────────────────────────────

export async function handleFormLead(req, res) {
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || req.socket?.remoteAddress || 'unknown';

  const { status, body } = await processFormLead({
    body: req.body,
    headers: req.headers,
    ip,
    deps: {
      rateLimiter: formRateLimiter,
      schema: formLeadSchema,
      upsertContact,
      runEngine,
      linkLeadContact,
      secret: process.env.WEBHOOK_SECRET || null,
    },
  });

  return res.status(status).json(body);
}
