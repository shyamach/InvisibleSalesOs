/**
 * controllers/calls.js — Call log ingestion + follow-up draft generation.
 * POST /api/calls — log a manual call outcome and optionally generate a follow-up draft.
 *
 * requireAuth added 2026-08-18 (Phase B item B2, master plan from the same
 * day's systems audit) — this route previously sat behind requireInternalKey
 * only, hardcoded every write to DEFAULT_TENANT_ID, and had zero real
 * callers (the leads/[id] detail page's "Log Call" modal inserted directly
 * into Supabase instead, bypassing this endpoint — and its own follow-up
 * draft generation — entirely). Now tenant-scoped via req.tenantId/
 * req.supabase and wired up as that modal's real backend.
 */
import { generateSalesDraft } from '../responder.js';

// Outcomes that warrant an auto-generated follow-up draft
const DRAFT_WORTHY_OUTCOMES = new Set(['interested', 'callback']);
const VALID_OUTCOMES = ['interested', 'not_interested', 'callback', 'won', 'lost', 'no_answer', 'voicemail'];

function requireTenant(req, res) {
  if (req.tenantId) return true;
  res.status(403).json({ success: false, error: 'No tenant associated with this account' });
  return false;
}

/**
 * POST /api/calls
 * Body: { lead_id, direction, duration_secs, outcome, notes }
 */
export async function logCall(req, res) {
  if (!requireTenant(req, res)) return;

  const tenantId = req.tenantId;
  const { lead_id, direction = 'outbound', duration_secs, outcome, notes } = req.body;

  if (!lead_id || !outcome) {
    return res.status(400).json({ success: false, error: 'Missing required fields: lead_id, outcome' });
  }

  if (!VALID_OUTCOMES.includes(outcome)) {
    return res.status(400).json({
      success: false,
      error: `Invalid outcome. Must be one of: ${VALID_OUTCOMES.join(', ')}`,
    });
  }

  try {
    const { data: lead0, error: leadCheckErr } = await req.supabase
      .from('smart_leads')
      .select('id')
      .eq('id', lead_id)
      .eq('tenant_id', tenantId)
      .maybeSingle();

    if (leadCheckErr) return res.status(500).json({ success: false, error: leadCheckErr.message });
    if (!lead0) return res.status(404).json({ success: false, error: 'Lead not found' });

    // 1. INSERT into call_logs
    const { data: callLog, error: callError } = await req.supabase
      .from('call_logs')
      .insert({
        tenant_id: tenantId,
        lead_id,
        direction,
        duration_secs: duration_secs || null,
        outcome,
        notes: notes || null,
        called_at: new Date().toISOString(),
      })
      .select('id')
      .single();

    if (callError) {
      console.error('💥 [Calls]: Error saving call log:', callError.message);
      return res.status(500).json({ success: false, error: 'Failed to save call log' });
    }

    console.log(`📞 [Calls]: Logged ${direction} call for lead ${lead_id} — outcome: ${outcome}`);

    // 2. INSERT into lead_activities
    const activityType = direction === 'inbound' ? 'call_in' : 'call_out';
    await req.supabase.from('lead_activities').insert({
      tenant_id: tenantId,
      lead_id,
      type: activityType,
      channel: 'call',
      direction,
      content: notes || `Call ${outcome}`,
      metadata: { duration_secs, outcome, call_log_id: callLog.id },
    });

    // 3. Generate follow-up draft if outcome warrants it
    let draft_id = null;

    if (DRAFT_WORTHY_OUTCOMES.has(outcome)) {
      // Fetch the lead for context and language preference
      const { data: lead } = await req.supabase
        .from('smart_leads')
        .select('customer_name, company_name, product_interest, reply_language')
        .eq('id', lead_id)
        .eq('tenant_id', tenantId)
        .single();

      if (lead) {
        // Fetch brand_dna for examples
        const { data: brandData } = await req.supabase
          .from('brand_dna')
          .select('successful_examples')
          .eq('tenant_id', tenantId)
          .single();

        const examples = brandData?.successful_examples || [];
        const language = lead.reply_language || 'en';

        const messageContext = notes
          ? notes
          : `Call outcome: ${outcome}. Customer expressed interest. Generate a follow-up message.`;

        const leadData = {
          customer_name: lead.customer_name,
          company_name: lead.company_name,
          product_interest: lead.product_interest,
          reason: `Post-call follow-up — outcome: ${outcome}`,
        };

        const draftResult = await generateSalesDraft(leadData, messageContext, language, examples.slice(0, 3));

        if (draftResult.success) {
          const { data: interaction, error: interactionError } = await req.supabase
            .from('smart_interactions')
            .insert({
              tenant_id: tenantId,
              lead_id,
              message_content: draftResult.draft,
              direction: 'outbound_draft',
              channel: 'whatsapp',
            })
            .select('id')
            .single();

          if (!interactionError && interaction) {
            draft_id = interaction.id;
            console.log(`✅ [Calls]: Follow-up draft generated — interaction ID: ${draft_id}`);
          }
        }
      }
    }

    return res.json({ success: true, draft_id });
  } catch (err) {
    console.error('💥 [Calls]: Unexpected error:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
}
