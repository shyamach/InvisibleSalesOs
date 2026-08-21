/**
 * lib/followUpEngine.js — Automated follow-up draft generator.
 * Finds stale leads and generates polite follow-up drafts to be approved by humans.
 * Runs on a cron-style interval set up in server.js.
 */
import { generateSalesDraft } from '../responder.js';
import { logSystemEvent } from './systemLog.js';

const DEFAULT_TENANT_ID = process.env.DEFAULT_TENANT_ID || '00000000-0000-0000-0000-000000000001';
const MAX_FOLLOW_UPS_PER_RUN = 10;

// Module-level last-run state (Phase E, item E3), same shape as
// lib/autoReplySweeper.js's getSweeperStatus() — previously this function
// only ever logged its outcome and returned nothing.
const lastRun = { at: null, summary: null };

/** Read-only snapshot of the engine's most recent run — for status/health endpoints. */
export function getFollowUpEngineStatus() {
  return { ...lastRun };
}

function recordRun(summary) {
  lastRun.at = new Date().toISOString();
  lastRun.summary = summary;
  return summary;
}

/**
 * Run the follow-up engine for all stale leads.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @returns {Promise<{staleLeadsFound:number, eligibleLeads:number, draftsGenerated:number, draftsFailed:number, error?:string}>}
 */
export async function runFollowUpEngine(supabase) {
  console.log('⏰ [FollowUpEngine]: Starting follow-up scan...');
  const summary = { staleLeadsFound: 0, eligibleLeads: 0, draftsGenerated: 0, draftsFailed: 0 };

  try {
    // 1. Find eligible stale leads
    // - pipeline_stage is 'new' or 'contacted'
    // - last_contacted_at is null OR older than 48 hours
    // - created within the last 30 days (not completely stale)
    const { data: staleLeads, error: leadsError } = await supabase
      .from('smart_leads')
      .select('id, customer_name, company_name, product_interest, reply_language, last_contacted_at, created_at')
      .eq('tenant_id', DEFAULT_TENANT_ID)
      .in('pipeline_stage', ['new', 'contacted'])
      .or('last_contacted_at.is.null,last_contacted_at.lt.' + new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString())
      .gte('created_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString())
      .limit(MAX_FOLLOW_UPS_PER_RUN);

    if (leadsError) {
      console.error('💥 [FollowUpEngine]: Error fetching stale leads:', leadsError.message);
      logSystemEvent({ category: 'follow_up', severity: 'error', message: leadsError.message, source: 'lib/followUpEngine.js#runFollowUpEngine' });
      return recordRun({ ...summary, error: leadsError.message });
    }

    if (!staleLeads || staleLeads.length === 0) {
      console.log('✅ [FollowUpEngine]: No stale leads found this run.');
      return recordRun(summary);
    }

    summary.staleLeadsFound = staleLeads.length;
    console.log(`🔍 [FollowUpEngine]: Found ${staleLeads.length} stale leads — checking for existing drafts...`);

    // 2. Filter out leads that already have an outbound_draft
    const leadIds = staleLeads.map((l) => l.id);

    const { data: existingDrafts } = await supabase
      .from('smart_interactions')
      .select('lead_id')
      .in('lead_id', leadIds)
      .eq('direction', 'outbound_draft');

    const leadIdsWithDraft = new Set((existingDrafts || []).map((d) => d.lead_id));
    const eligibleLeads = staleLeads.filter((l) => !leadIdsWithDraft.has(l.id));

    summary.eligibleLeads = eligibleLeads.length;
    if (eligibleLeads.length === 0) {
      console.log('✅ [FollowUpEngine]: All stale leads already have drafts.');
      return recordRun(summary);
    }

    // 3. Fetch brand_dna for examples and language preferences
    const { data: brandData } = await supabase
      .from('brand_dna')
      .select('successful_examples, reply_languages')
      .eq('tenant_id', DEFAULT_TENANT_ID)
      .single();

    const successfulExamples = brandData?.successful_examples || [];

    console.log(`✍️  [FollowUpEngine]: Generating follow-ups for ${eligibleLeads.length} leads...`);

    // 4. Generate follow-up draft for each eligible lead
    for (const lead of eligibleLeads.slice(0, MAX_FOLLOW_UPS_PER_RUN)) {
      try {
        const daysSinceCreated = Math.floor(
          (Date.now() - new Date(lead.created_at).getTime()) / (1000 * 60 * 60 * 24)
        );

        const followUpContext = `Customer enquired ${daysSinceCreated} day(s) ago about ${lead.product_interest || 'your products'}, no reply yet. Generate a polite, friendly follow-up message.`;

        const leadData = {
          customer_name: lead.customer_name,
          company_name: lead.company_name,
          product_interest: lead.product_interest,
          reason: 'Follow-up — no reply to initial enquiry',
        };

        const language = lead.reply_language || 'en';

        const draftResult = await generateSalesDraft(
          leadData,
          followUpContext,
          language,
          successfulExamples.slice(0, 2)
        );

        if (!draftResult.success) {
          console.warn(`⚠️ [FollowUpEngine]: Draft generation failed for lead ${lead.id}`);
          summary.draftsFailed++;
          continue;
        }

        // 5. Insert into smart_interactions
        const { data: insertedInteraction, error: interactionError } = await supabase
          .from('smart_interactions')
          .insert({
            tenant_id: DEFAULT_TENANT_ID,
            lead_id: lead.id,
            message_content: draftResult.draft,
            direction: 'outbound_draft',
            channel: 'whatsapp',
          })
          .select('id')
          .single();

        if (interactionError) {
          console.error(`💥 [FollowUpEngine]: Failed to save draft for lead ${lead.id}:`, interactionError.message);
          summary.draftsFailed++;
          continue;
        }

        // 6. Insert lead_activities record
        await supabase.from('lead_activities').insert({
          tenant_id: DEFAULT_TENANT_ID,
          lead_id: lead.id,
          type: 'draft_approved',
          channel: 'whatsapp',
          direction: 'outbound',
          content: 'Follow-up draft auto-generated',
          metadata: { auto_generated: true, days_since_created: daysSinceCreated },
        });

        summary.draftsGenerated++;
        console.log(`✅ [FollowUpEngine]: Draft queued for lead ${lead.id} (${lead.customer_name || 'Unknown'})`);
      } catch (leadErr) {
        console.error(`💥 [FollowUpEngine]: Error processing lead ${lead.id}:`, leadErr.message);
        summary.draftsFailed++;
      }
    }

    console.log('✅ [FollowUpEngine]: Follow-up run complete.');
    return recordRun(summary);
  } catch (err) {
    console.error('💥 [FollowUpEngine]: Fatal error:', err.message);
    logSystemEvent({ category: 'follow_up', severity: 'error', message: err.message, source: 'lib/followUpEngine.js#runFollowUpEngine' });
    return recordRun({ ...summary, error: err.message });
  }
}
