/**
 * lib/supabaseOutreach.js — Outreach draft persistence layer.
 * Writes to smart_interactions as outbound_draft rows.
 */
import { supabase } from './supabase.js';

/**
 * Insert a generated outreach draft linked to a lead.
 * @param {string} leadId — UUID from smart_leads
 * @param {string} draftText — generated message/email body
 * @returns {Object|null} inserted row or null on error
 */
export async function insertOutreach(leadId, draftText) {
  const { data, error } = await supabase
    .from('smart_interactions')
    .insert({
      lead_id: leadId,
      message_content: draftText,
      direction: 'outbound_draft',
    })
    .select('id')
    .single();

  if (error) {
    console.error('❌ [insertOutreach] DB error:', error.message);
    return null;
  }

  return data;
}
