/**
 * engine.js — The Unified Cognitive Brain Kernel.
 * Orchestrates: Brand DNA fetch → Lead Parse → Score → Outreach Generate → DB Sync → Dispatch.
 *
 * Uses canonical Supabase client (no raw pg.Pool).
 * Returns { success, leadId, profile, deliveryStatus } so controllers get real data.
 */
import { parseIncomingLead } from './parser.js';
import { generateTailoredOutreach } from './writer.js';
import { appendLeadToSpreadsheet } from './sheets.js';
import { saveLeadAndLogToDatabase } from './db.js';
import { dispatchOutreachMessage } from './outbox.js';
import { decideAutoReply } from './lib/autoReply.js';
import { getCatalogueContext } from './lib/catalogueContext.js';
import { detectEscalation } from './lib/escalation.js';
import { createAndNotifyEscalation } from './lib/escalationService.js';
import { supabase } from './lib/supabase.js';

// ==========================================
// RAG MEMORY VAULT
// Vector search is DISABLED until a real embedding service is configured.
// The previous generateMockEmbedding() used Math.random() — random vectors
// corrupt context retrieval and have been removed.
// ==========================================
async function searchCompanyKnowledge(brandId, _customerQuery) {
  // TODO: Implement real embeddings via Voyage / pgvector when ready:
  //   const embedding = await generateRealEmbedding(_customerQuery);
  //   const { data } = await supabase.rpc('match_company_knowledge', {
  //     query_embedding: embedding, match_threshold: 0.1, match_count: 3, p_brand_id: brandId
  //   });
  //   return data?.map(r => `- ${r.content_chunk}`).join('\n') || null;
  console.log(`🔍 [Vault]: Vector search not yet active — skipping (brand ${brandId}).`);
  return null;
}

// ==========================================
// THE UNIFIED COGNITIVE BRAIN KERNEL
// ==========================================
export async function processLeadThroughCognitiveEngine(
  rawInput,
  inputFormat = 'text',
  incomingChannel = 'webhook',
  brandId = 1
) {
  console.log(`\n👑 [Engine]: Activating cognitive loop for Brand ID: ${brandId}...`);

  try {
    // ---------------------------------------------------------
    // PASS 1: FETCH BRAND DNA & SEARCH MEMORY VAULT
    // ---------------------------------------------------------
    console.log(`🏢 [Pass 1/4]: Fetching Brand DNA from Supabase...`);
    const { data: brandDna, error: brandError } = await supabase
      .from('brand_dna')
      .select('brand_name, brand_voice_guidelines, tenant_id')
      .eq('id', brandId)
      .single();

    if (brandError || !brandDna) {
      throw new Error(`Critical: Brand DNA not found for ID ${brandId}.`);
    }

    const historicalContext = await searchCompanyKnowledge(brandId, rawInput);

    // ---------------------------------------------------------
    // PASS 2: PARSE & EXTRACT (BOUNCER LAYER)
    // ---------------------------------------------------------
    console.log(`🧠 [Pass 2/4]: Invoking multimodal Claude parser...`);
    const structuredProfile = await parseIncomingLead(rawInput, inputFormat);

    if (!structuredProfile) {
      console.warn(`⚠️ [Engine]: Parser returned null — dropping lead.`);
      return { success: false, status: 'parse_failed' };
    }

    if (structuredProfile.is_valid_lead === false) {
      console.warn(`🗑️ [Bouncer]: Lead rejected. Reason: ${structuredProfile.spam_reason}`);
      return { success: false, status: 'rejected_by_bouncer' };
    }

    // Attach routing metadata to profile
    structuredProfile.brand_id = brandId;
    structuredProfile.source_channel = incomingChannel;
    // Keep preferred_channel as an EXPLICIT-request signal only (null = none asked).
    // The channel router then falls back to contact preference → originating channel,
    // which keeps replies symmetric (email-origin → email, whatsapp-origin → whatsapp).
    structuredProfile.preferred_channel = structuredProfile.preferred_channel || null;
    structuredProfile.qualification_score = structuredProfile.ptc_score || 50;

    // ---------------------------------------------------------
    // PASS 3: SCORE & PREDICT (reserved for scoring logic expansion)
    // ---------------------------------------------------------
    console.log(`📊 [Pass 3/4]: Qualification scoring complete.`);

    // ---------------------------------------------------------
    // PASS 4: GENERATE OUTREACH (INJECT BRAND CONTEXT + RAG)
    // ---------------------------------------------------------
    console.log(`🖋️  [Pass 4/4]: Generating hyper-personalized outreach...`);
    // Inject live catalogue context (real price/stock) when we can match the enquiry.
    let catalogueContext = null;
    if (brandDna.tenant_id) {
      try {
        const cat = await getCatalogueContext(
          supabase,
          brandDna.tenant_id,
          structuredProfile.query || structuredProfile.product_interest
        );
        catalogueContext = cat.context;
        if (cat.matches?.length) structuredProfile.catalogue_matches = cat.matches; // structured, for Data Head
      } catch (err) {
        console.warn('⚠️ [Engine]: catalogue context fetch failed (non-fatal):', err.message);
      }
    }

    const combinedGuidelines = [
      `Base Guidelines: ${brandDna.brand_voice_guidelines}`,
      historicalContext ? `Historical Company Context:\n${historicalContext}` : null,
      catalogueContext,
    ]
      .filter(Boolean)
      .join('\n\n');

    const optimizedOutreachDraft = await generateTailoredOutreach(
      structuredProfile,
      combinedGuidelines
    );

    if (!optimizedOutreachDraft) {
      console.warn(`⚠️ [Engine]: Writer returned null — skipping dispatch.`);
      return { success: false, status: 'writer_failed' };
    }

    // ---------------------------------------------------------
    // LAYER 3: DUAL-WRITE SYNC & DISPATCH
    // ---------------------------------------------------------
    console.log(`📋 [Layer 3]: Initiating dual-write sync...`);

    // Google Sheets backup — non-blocking, failure is logged but doesn't crash
    appendLeadToSpreadsheet(structuredProfile, optimizedOutreachDraft).catch((err) =>
      console.warn('⚠️ [Sheets backup failed]:', err.message)
    );

    // Primary DB write
    const dbResult = await saveLeadAndLogToDatabase(
      structuredProfile,
      optimizedOutreachDraft,
      incomingChannel
    ).catch((err) => {
      console.error('❌ [Engine]: DB sync failed (non-fatal):', err.message);
      return null;
    });

    // ---------------------------------------------------------
    // AUTO-REPLY GATE: decide dispatch vs schedule vs manual
    // ---------------------------------------------------------
    let autoReplyConfig = null;
    let ownerEmail = null;
    if (brandDna.tenant_id) {
      const { data: tenantRow } = await supabase
        .from('tenants')
        .select('auto_reply, settings, owner_email')
        .eq('id', brandDna.tenant_id)
        .maybeSingle();
      autoReplyConfig = tenantRow?.auto_reply ?? null;
      ownerEmail = tenantRow?.owner_email ?? null;
      // Tenant default channel feeds the channel router at dispatch time.
      structuredProfile.tenantSettings = tenantRow?.settings ?? null;
    }

    // Best-effort: attach the contact's standing channel preference (if we know them).
    // Non-fatal — the router falls back to lead fields when no contact is found.
    if (brandDna.tenant_id && (structuredProfile.email || structuredProfile.phone)) {
      try {
        let contactRow = null;
        if (structuredProfile.email) {
          const { data } = await supabase
            .from('contacts')
            .select('preferred_channel, channels')
            .eq('tenant_id', brandDna.tenant_id)
            .contains('channels', { email: structuredProfile.email })
            .is('deleted_at', null)
            .limit(1);
          contactRow = data?.[0] || null;
        }
        if (!contactRow && structuredProfile.phone) {
          const { data } = await supabase
            .from('contacts')
            .select('preferred_channel, channels')
            .eq('tenant_id', brandDna.tenant_id)
            .contains('channels', { whatsapp: structuredProfile.phone })
            .is('deleted_at', null)
            .limit(1);
          contactRow = data?.[0] || null;
        }
        if (contactRow) structuredProfile.contact = contactRow;
      } catch (err) {
        console.warn('⚠️ [Engine]: contact preference lookup failed (non-fatal):', err.message);
      }
    }

    const decision = decideAutoReply({
      priority: structuredProfile.priority,
      score: structuredProfile.ptc_score ?? structuredProfile.qualification_score,
      tenantAutoReply: autoReplyConfig,
    });
    console.log(`🚦 [Auto-reply]: ${decision.action} — ${decision.reason}`);

    // Persist the decision onto the lead (non-fatal — gives the Data Head an audit trail)
    if (dbResult?.leadId) {
      const { error: decisionErr } = await supabase
        .from('smart_leads')
        .update({
          auto_reply_decision: decision.action,
          auto_reply_status: decision.status,
          scheduled_dispatch_at: decision.scheduled_dispatch_at,
        })
        .eq('id', dbResult.leadId);
      if (decisionErr) {
        console.warn('⚠️ [Engine]: Failed to persist auto-reply decision:', decisionErr.message);
      }
    }

    // Only auto_dispatch sends immediately. scheduled/manual hold the draft
    // (already saved to smart_interactions) for the approval window or human.
    let deliveryStatus;
    if (decision.action === 'auto_dispatch') {
      console.log(`📲 [Layer 3]: Executing outbox dispatch...`);
      deliveryStatus = await dispatchOutreachMessage(structuredProfile, optimizedOutreachDraft);
    } else {
      console.log(
        `⏸️  [Layer 3]: Dispatch withheld (${decision.action}). Draft held for ` +
          (decision.action === 'scheduled'
            ? `${decision.window_minutes}-min approval window.`
            : 'manual approval.')
      );
      deliveryStatus = {
        dispatched: false,
        channel: structuredProfile.preferred_channel,
        status: decision.action === 'scheduled' ? 'scheduled' : 'awaiting_approval',
      };
    }

    // ---------------------------------------------------------
    // SALES-REP HANDOFF: escalate OOS / price-negotiation leads
    // ---------------------------------------------------------
    let escalation = { escalate: false };
    if (brandDna.tenant_id && dbResult?.leadId) {
      escalation = detectEscalation({
        profile: structuredProfile,
        catalogueMatches: structuredProfile.catalogue_matches || [],
      });
      if (escalation.escalate) {
        console.log(`🚨 [Engine]: Escalating to rep — ${escalation.reason} (${escalation.context})`);
        await createAndNotifyEscalation(supabase, {
          tenantId: brandDna.tenant_id,
          leadId: dbResult.leadId,
          reason: escalation.reason,
          context: escalation.context,
          profile: structuredProfile,
          ownerEmail,
        }).catch((err) => console.warn('⚠️ [Engine]: escalation failed (non-fatal):', err.message));
      }
    }

    console.log(`🎉 [Engine]: Autonomous transaction complete.\n`);
    return {
      success: true,
      leadId: dbResult?.leadId ?? null,
      profile: structuredProfile,
      autoReply: decision,
      escalation,
      deliveryStatus,
    };

  } catch (error) {
    console.error(`🚨 [Engine Panic]:`, error.message);
    return { success: false, error: error.message };
  }
}
