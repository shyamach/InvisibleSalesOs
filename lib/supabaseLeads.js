/**
 * lib/supabaseLeads.js — Lead persistence layer.
 * Writes to the canonical smart_leads table.
 */
import { supabase } from './supabase.js';

/**
 * Insert a structured lead profile into smart_leads.
 * @param {Object} profile — output from parser.js
 * @returns {Object|null} inserted row or null on error
 */
export async function insertLead(profile) {
  const { data, error } = await supabase
    .from('smart_leads')
    .insert({
      customer_name: profile.name || profile.customer_name || null,
      company_name: profile.company || profile.company_name || null,
      product_interest: profile.query || profile.product_interest || null,
      ptc_score: profile.ptc_score || 0,
      intent_category: profile.priority || 'NORMAL',
      triage_status: 'pending',
      lead_channel_id: profile.phone || null,
      source_channel: profile.source_channel || 'manual',
      brand_id: profile.brand_id || 1,
    })
    .select('id')
    .single();

  if (error) {
    console.error('❌ [insertLead] DB error:', error.message);
    return null;
  }

  return data;
}
