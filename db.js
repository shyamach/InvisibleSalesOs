/**
 * db.js — Database helpers for lead logging and inventory lookups.
 * Uses the canonical Supabase client from lib/supabase.js.
 */
import { supabase } from './lib/supabase.js';

/**
 * Upserts a lead and logs its outreach draft into smart_leads + smart_interactions.
 * Called by engine.js as the primary DB sync step.
 *
 * @param {Object} profile    — structured lead profile from parser.js
 * @param {string} draftText  — generated outreach draft from writer.js
 * @param {string} channel    — source channel string
 * @param {string} tenantId   — trusted tenant_id, already resolved by the caller
 *   (e.g. engine.js's brand_dna lookup). Required — never derive tenant identity
 *   here; this function only threads an already-trusted value into the writes.
 * @returns {{ leadId: string }|null}
 */
export async function saveLeadAndLogToDatabase(profile, draftText, channel = 'unknown', tenantId) {
  if (!tenantId) {
    // Fail fast, before any Supabase call — inserting with a NULL tenant_id
    // would just get silently rejected by RLS further down, masking the bug.
    throw new Error('saveLeadAndLogToDatabase: tenantId is required — refusing to insert a lead with no tenant_id.');
  }

  try {
    console.log('📡 [Database]: Syncing lead + outreach draft...');

    const phone = profile.phone || null;
    let leadId = null;

    // 1. Upsert by phone — avoid duplicate lead rows
    if (phone) {
      const { data: existing } = await supabase
        .from('smart_leads')
        .select('id')
        .eq('lead_channel_id', phone)
        .eq('tenant_id', tenantId)
        .maybeSingle();

      if (existing) leadId = existing.id;
    }

    if (!leadId) {
      const { data: newLead, error: leadError } = await supabase
        .from('smart_leads')
        .insert({
          tenant_id: tenantId,
          customer_name: profile.name || profile.customer_name || null,
          company_name: profile.company || profile.company_name || null,
          product_interest: profile.query || profile.product_interest || null,
          ptc_score: profile.ptc_score || 0,
          intent_category: profile.priority || 'NORMAL',
          triage_status: 'pending',
          lead_channel_id: phone,
          source_channel: channel,
          brand_id: profile.brand_id || 1,
        })
        .select('id')
        .single();

      if (leadError) throw leadError;
      leadId = newLead.id;
    }

    // 2. Log the outreach draft
    const { error: interactionError } = await supabase
      .from('smart_interactions')
      .insert({
        tenant_id: tenantId,
        lead_id: leadId,
        message_content: draftText || '',
        direction: 'outbound_draft',
      });

    if (interactionError) throw interactionError;

    console.log(`✅ [Database]: Lead synced. ID: ${leadId}`);
    return { leadId };

  } catch (err) {
    console.error('❌ [Database] saveLeadAndLogToDatabase failed:', err.message);
    return null;
  }
}

/**
 * Fuzzy catalogue lookup by product name.
 * Repointed from the retired `inventory` table to the canonical `products` table.
 * Returns the legacy shape ({ product_name, price, stock_count, status }) so any
 * existing caller keeps working.
 */
export async function checkLiveInventory(productName) {
  const { data, error } = await supabase
    .from('products')
    .select('name, price, stock_quantity, status')
    .is('deleted_at', null)
    .ilike('name', `%${productName}%`)
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;
  return {
    product_name: data.name,
    price: data.price,
    stock_count: data.stock_quantity,
    status: data.status,
  };
}

/**
 * @deprecated Use saveLeadAndLogToDatabase. Kept for any legacy callers.
 */
export async function logInteractionToPipeline({ phone, query, channel, triage }) {
  return saveLeadAndLogToDatabase(
    { phone, query, priority: triage?.priority },
    triage?.generated_reply || '',
    channel
  );
}
