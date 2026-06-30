/**
 * lib/autoReplySweeper.js — Auto-reply approval-window sweeper.
 *
 * Completes the "auto-sends unless rejected" half of the approval window.
 * The auto-reply decision engine (lib/autoReply.js) marks MEDIUM-priority
 * drafts as `scheduled` with a `scheduled_dispatch_at` timestamp. This worker
 * periodically finds drafts whose window has elapsed and dispatches them —
 * UNLESS a human rejected them first (which flips auto_reply_status to
 * 'rejected', removing them from the sweep query).
 *
 * Design:
 *   - `isDue(lead, now)`            — pure predicate, fully testable.
 *   - `sweepScheduledReplies(...)`  — IO orchestrator with injectable deps.
 *   - `startAutoReplySweeper(...)`  — 60s interval runner (call once at boot).
 *
 * The status update is guarded with `.eq('auto_reply_status','scheduled')` so a
 * rejection landing mid-run can never be overwritten by a stale dispatch.
 */

import { dispatchOutreachMessage } from '../outbox.js';

const MAX_PER_RUN = 25;
const SWEEP_INTERVAL_MS = 60 * 1000; // every minute

/**
 * Is this phone address a wwebjs device-local @lid identifier?
 * Meta Cloud API cannot deliver to @lid addresses — only the wwebjs client can.
 * @param {string|null|undefined} phone
 * @returns {boolean}
 */
export function isLidAddress(phone) {
  return typeof phone === 'string' && phone.includes('@lid');
}

/**
 * Build a hybrid dispatch function.
 * Routes @lid WhatsApp addresses to `whatsappSender` (wwebjs client.sendMessage);
 * all other targets fall through to `standardDispatch` (outbox).
 *
 * @param {Function|null} whatsappSender   — async (to, text) => void
 * @param {Function}      standardDispatch — injectable for tests; defaults to dispatchOutreachMessage
 * @returns {Function}                     — async (profile, text) => { dispatched, ... }
 */
export function makeDispatch(whatsappSender = null, standardDispatch = dispatchOutreachMessage) {
  return async function hybridDispatch(profile, text) {
    if (whatsappSender && isLidAddress(profile.phone)) {
      try {
        await whatsappSender(profile.phone, text);
        return { dispatched: true, channel: 'whatsapp', via: 'wwebjs' };
      } catch (err) {
        return { dispatched: false, error: err.message };
      }
    }
    return standardDispatch(profile, text);
  };
}

/**
 * Is this lead's scheduled window up and still awaiting dispatch?
 * @param {Object} lead
 * @param {Date}   [now]
 * @returns {boolean}
 */
export function isDue(lead, now = new Date()) {
  if (!lead || lead.auto_reply_status !== 'scheduled') return false;
  if (!lead.scheduled_dispatch_at) return false;
  const due = new Date(lead.scheduled_dispatch_at).getTime();
  return Number.isFinite(due) && due <= now.getTime();
}

/**
 * Find due scheduled drafts and dispatch them.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {Object}   [opts]
 * @param {Date}     [opts.now]
 * @param {Function} [opts.dispatch] — (profile, text) => { dispatched, ... }
 * @param {number}   [opts.limit]
 * @returns {Promise<{scanned:number, dispatched:number, failed:number, skipped:number, error?:string}>}
 */
export async function sweepScheduledReplies(
  supabase,
  { now = new Date(), dispatch = dispatchOutreachMessage, limit = MAX_PER_RUN } = {}
) {
  const summary = { scanned: 0, dispatched: 0, failed: 0, skipped: 0 };

  // 1. Fetch leads whose window has elapsed and are still scheduled.
  const { data: leads, error } = await supabase
    .from('smart_leads')
    .select(
      'id, customer_name, company_name, product_interest, communication_preference, source_channel, phone_number, lead_channel_id, email, scheduled_dispatch_at, auto_reply_status'
    )
    .eq('auto_reply_status', 'scheduled')
    .lte('scheduled_dispatch_at', now.toISOString())
    .is('deleted_at', null)
    .limit(limit);

  if (error) {
    console.error('💥 [AutoReplySweeper]: Failed to fetch due leads —', error.message);
    return { ...summary, error: error.message };
  }

  if (!leads || leads.length === 0) return summary;

  console.log(`⏰ [AutoReplySweeper]: ${leads.length} scheduled reply(ies) due — dispatching...`);

  for (const lead of leads) {
    summary.scanned++;

    // Defensive re-check (clock/race safety).
    if (!isDue(lead, now)) {
      summary.skipped++;
      continue;
    }

    // 2. Fetch the most recent outbound draft for this lead.
    const { data: draft } = await supabase
      .from('smart_interactions')
      .select('id, message_content')
      .eq('lead_id', lead.id)
      .eq('direction', 'outbound_draft')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!draft || !draft.message_content) {
      console.warn(`⚠️ [AutoReplySweeper]: No draft for lead ${lead.id} — skipping.`);
      summary.skipped++;
      continue;
    }

    // 3. Dispatch on the lead's preferred channel.
    const profile = {
      preferred_channel: lead.preferred_channel || lead.communication_preference || lead.source_channel || 'whatsapp',
      phone: lead.phone_number || lead.lead_channel_id || null,
      email: lead.email || null,
    };

    let result;
    try {
      result = await dispatch(profile, draft.message_content);
    } catch (err) {
      console.error(`❌ [AutoReplySweeper]: Dispatch threw for lead ${lead.id} —`, err.message);
      result = { dispatched: false, error: err.message };
    }

    if (result && result.dispatched) {
      // 4. Mark sent — guarded so a concurrent rejection wins.
      const { error: updErr } = await supabase
        .from('smart_leads')
        .update({ auto_reply_status: 'sent', last_contacted_at: now.toISOString() })
        .eq('id', lead.id)
        .eq('auto_reply_status', 'scheduled');

      if (updErr) {
        console.error(`⚠️ [AutoReplySweeper]: Dispatched but failed to mark sent for ${lead.id} —`, updErr.message);
      }
      summary.dispatched++;
    } else {
      // Leave as 'scheduled' so the next run retries.
      summary.failed++;
    }
  }

  console.log(
    `⏰ [AutoReplySweeper]: Run complete — ${summary.dispatched} sent, ${summary.failed} failed, ${summary.skipped} skipped.`
  );
  return summary;
}

/**
 * Start the sweeper. Checks every minute. Call once at server startup.
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {Object}        [opts]
 * @param {Function|null} [opts.whatsappSender] — async (to, text) => void; wwebjs client.sendMessage
 */
export function startAutoReplySweeper(supabase, { whatsappSender } = {}) {
  console.log('[AutoReplySweeper]: Started — sweeping scheduled replies every 60s');
  const dispatch = makeDispatch(whatsappSender);

  setInterval(() => {
    sweepScheduledReplies(supabase, { dispatch }).catch((err) =>
      console.error('💥 [AutoReplySweeper]: Unexpected error —', err.message)
    );
  }, SWEEP_INTERVAL_MS);
}
