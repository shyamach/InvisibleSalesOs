/**
 * lib/webhookLeadSchema.js — Zod schema for the generic form webhook.
 *
 * Validates inbound payloads from Tally / Typeform / Google Forms (and any
 * other generic form source) hitting POST /webhook/lead. Exported separately
 * so it can be unit-tested in isolation (Security Lead: webhook needs Zod
 * validation + rate limiting).
 */
import { z } from 'zod';

export const FORM_CHANNELS = ['whatsapp', 'email', 'sms', 'instagram', 'messenger', 'manual'];

export const formLeadSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    company: z.string().trim().max(200).optional(),
    email: z.string().trim().toLowerCase().email().max(320).optional(),
    phone: z
      .string()
      .trim()
      .min(5)
      .max(32)
      .regex(/^[+\d][\d\s().-]+$/, 'Invalid phone number format')
      .optional(),
    // The actual enquiry text — this is what triage classifies.
    message: z.string().trim().min(1, 'message is required').max(5000),
    // Optional explicit reply-channel preference from the form.
    channel: z.enum(FORM_CHANNELS).optional(),
    // Free-text source tag, e.g. "tally", "typeform", "homepage-contact".
    source: z.string().trim().max(80).optional(),
    consent: z.boolean().optional(),
  })
  // A lead is useless without a way to reply.
  .refine((d) => Boolean(d.email || d.phone), {
    message: 'At least one of email or phone is required',
    path: ['contact'],
  });

/**
 * Convenience wrapper returning a flat, client-friendly result.
 * @param {unknown} payload
 * @returns {{ ok: true, data: object } | { ok: false, issues: Array<{field:string,message:string}> }}
 */
export function validateFormLead(payload) {
  const result = formLeadSchema.safeParse(payload);
  if (result.success) return { ok: true, data: result.data };
  return {
    ok: false,
    issues: result.error.issues.map((i) => ({ field: i.path.join('.') || '(root)', message: i.message })),
  };
}
