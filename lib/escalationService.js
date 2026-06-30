/**
 * lib/escalationService.js — Create an escalation + notify the rep/owner.
 *
 * Thin I/O wrapper used by the engine. Detection logic stays pure in
 * lib/escalation.js; this just persists the row, flags the lead, and fires
 * push + email notifications. Everything is best-effort (non-fatal): a
 * notification failure must never break the lead pipeline.
 */
import { sendPushToTenant } from './pushNotify.js';
import { sendEmailReply } from './emailSend.js';

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {Object} args
 * @param {string} args.tenantId
 * @param {string} args.leadId
 * @param {string} args.reason
 * @param {string} [args.context]
 * @param {Object} [args.profile]      — for notification copy (customer_name etc.)
 * @param {string} [args.ownerEmail]   — tenant owner email for the alert
 * @param {Object} [args.deps]         — injectable { sendPush, sendEmail } for tests
 * @returns {Promise<{ created: boolean, escalationId?: string }>}
 */
export async function createAndNotifyEscalation(
  supabase,
  { tenantId, leadId, reason, context, profile = {}, ownerEmail = null, deps = {} }
) {
  const sendPush = deps.sendPush || sendPushToTenant;
  const sendEmail = deps.sendEmail || sendEmailReply;

  if (!tenantId || !leadId) return { created: false };

  // Don't double-escalate an already-pending lead.
  const { data: existing } = await supabase
    .from('escalations')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('lead_id', leadId)
    .eq('status', 'pending')
    .limit(1);
  if (existing && existing.length > 0) return { created: false, escalationId: existing[0].id };

  const { data: row, error } = await supabase
    .from('escalations')
    .insert({ tenant_id: tenantId, lead_id: leadId, reason, trigger_context: context || null })
    .select('id')
    .single();

  if (error) {
    console.error('⚠️ [Escalation]: insert failed —', error.message);
    return { created: false };
  }

  await supabase
    .from('smart_leads')
    .update({ escalation_status: 'pending', escalated_at: new Date().toISOString() })
    .eq('tenant_id', tenantId)
    .eq('id', leadId);

  const who = profile.customer_name || profile.company || 'A lead';
  const title =
    reason === 'out_of_stock'
      ? 'Stock handoff needed'
      : reason === 'price_negotiation'
        ? 'Price negotiation'
        : 'Lead escalated';
  const body = `${who}: ${context || reason}`;

  // Fire-and-forget notifications.
  try {
    await sendPush(supabase, tenantId, { title, body, url: '/app/escalations', tag: 'escalation', requireInteraction: true });
  } catch (err) {
    console.warn('⚠️ [Escalation]: push failed —', err.message);
  }

  if (ownerEmail) {
    try {
      await sendEmail({ to: ownerEmail, subject: `Action needed: ${title}`, text: `${body}\n\nReview it in your Escalations queue.` });
    } catch (err) {
      console.warn('⚠️ [Escalation]: email failed —', err.message);
    }
  }

  return { created: true, escalationId: row.id };
}
