import { parseIncomingLead } from './parser.js';
import { generateTailoredOutreach } from './writer.js';
import { appendLeadToSpreadsheet } from './sheets.js'; // optional backup

import { insertLead } from './lib/supabaseLeads.js';
import { insertOutreach } from './lib/supabaseOutreach.js';

async function runFullPipeline() {
  const messyOfflineNote =
    "Exhibition booth log May 30 - Rajesh from Gupta Supplements Delhi, phone 98110XXXXX, came by. Intrested in bulk order of protein powders 500 boxes for his distribution chain. Needs quote urgent.";

  console.log("📥 [Step 1] Ingesting Unstructured Data...");
  const cleanProfile = await parseIncomingLead(messyOfflineNote);

  if (!cleanProfile) {
    console.error("Pipeline stopped: Parsing failed.");
    return;
  }

  console.log("✅ Data Successfully Structured.");

  console.log("\n⚡ [Step 2] Passing Profile to Personalization Engine...");
  const customizedDraft = await generateTailoredOutreach(cleanProfile);

  if (!customizedDraft) {
    console.error("Pipeline stopped: Personalization failed.");
    return;
  }

  console.log("✅ High-Conversion Outreach Draft Generated.");

  console.log("\n🌐 [Step 3] Syncing to Supabase CRM...");

  // 1. Insert lead
  const lead = await insertLead(cleanProfile);

  if (!lead) {
    console.error("Pipeline stopped: Supabase insert failed.");
    return;
  }

  // 2. Insert outreach
  await insertOutreach(lead.id, customizedDraft);

  // 3. Optional backup to Google Sheets
  await appendLeadToSpreadsheet(cleanProfile, customizedDraft);

  console.log("✅ Supabase CRM sync complete.");
  console.log("\n🎉 Full Pipeline Loop Completed Successfully!");
}

runFullPipeline();