// LeadNormalizer.js
import { performAITriage } from './AI_Triage.js';
import { supabase } from './supabaseClient.js';

export async function processInboundLead(rawInput, source) {
    // 1. Send to the Brain for Extraction
    const triage = await performAITriage([rawInput.body]);

    // 2. Filter out Noise
    if (!triage || triage.type === 'NOISE') {
        console.log(`🔒 [Privacy]: Noise filtered. Reason: ${triage?.reason || 'Unknown'}`);
        return { success: false, reason: 'noise' };
    }

    // 3. Insert Extracted Data into Smart Pipeline
    const { data, error } = await supabase
        .from('smart_leads')
        .insert([{
            lead_source: source,
            lead_channel_id: rawInput.from,
            intent_category: triage.intent_category || 'General Inquiry',
            ptc_score: triage.ptc_score || 50,
            customer_name: triage.customer_name,
            company_name: triage.company_name,
            product_interest: triage.product_interest,
            communication_preference: source
        }]);

    if (error) {
        console.error("❌ Database Insert Error:", error);
        return { success: false, reason: 'db_error' };
    }

    console.log(`🎯 [LEAD SAVED]: Extracted ${triage.product_interest || 'inquiry'} from ${triage.company_name || 'unknown'}`);
    return { success: true, lead: data };
}