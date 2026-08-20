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
 * Claim-lock (Block 0.3 — see supabase/migrations/phase2_sweeper_claim_lock.sql):
 * the initial SELECT below is a best-effort candidate list — it can return
 * the same due lead to two overlapping sweeper runs (overlapping ticks, two
 * processes during a rolling deploy). Before dispatching, each lead is
 * claimed with a single atomic conditional UPDATE on `claimed_at`, guarded
 * by `auto_reply_status = 'scheduled'` and the claim being NULL or stale. A
 * concurrent run's claim on the same row loses that UPDATE (matches zero
 * rows) and skips the lead instead of dispatching — the same guarded-update
 * pattern this file already uses for the "mark sent" step, just applied
 * before the customer-facing send instead of only after it. A claim expires
 * after CLAIM_STALE_MS so a crashed sweeper's stuck claim self-heals; an
 * ordinary dispatch failure explicitly releases the claim so the very next
 * tick can retry immediately.
 */

import { dispatchOutreachMessage } from '../outbox.js';

const MAX_PER_RUN = 25;
const SWEEP_INTERVAL_MS = 60 * 1000; // every minute
const CLAIM_STALE_MS = 5 * 60 * 1000; // a claim older than this is assumed abandoned (crashed sweeper)

// Interim single-tenant default (Block 1.7a-2) — matches the same
// process.env.DEFAULT_TENANT_ID || literal pattern used across the app
// (e.g. lib/followUpEngine.js). Not final production auth: once real
// multi-tenant auth exists, the sweeper needs to loop per-tenant instead of
// filtering to one hardcoded id.
const DEFAULT_TENANT_ID = process.env.DEFAULT_TENANT_ID || '00000000-0000-0000-0000-000000000001';

// Module-level last-run state (Phase E, item E3) — sweepScheduledReplies
// already computed a rich summary every run and previously just logged and
// discarded it. Read via getSweeperStatus() for the E3 health endpoint.
const lastRun = { at: null, summary: null };

/** Read-only snapshot of the sweeper's most recent run — for status/health endpoints. */
export function getSweeperStatus() {
  return { ...lastRun };
}

function recordRun(summary) {
  lastRun.at = new Date().toISOString();
  lastRun.summary = summary;
  return summary;
}

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
 * @param {number}   [opts.claimStaleMs] — claim-lock staleness window (ms); injectable for tests.
 * @param {string}   [opts.tenantId] — interim single-tenant scoping (Block 1.7a-2); defaults to DEFAULT_TENANT_ID.
 * @returns {Promise<{scanned:number, dispatched:number, failed:number, skipped:number, claimLost:number, error?:string}>}
 */
export async function sweepScheduledReplies(
  supabase,
  {
    now = new Date(),
    dispatch = dispatchOutreachMessage,
    limit = MAX_PER_RUN,
    claimStaleMs = CLAIM_STALE_MS,
    tenantId = DEFAULT_TENANT_ID,
  } = {}
) {
  const summary = { scanned: 0, dispatched: 0, failed: 0, skipped: 0, claimLost: 0 };

  // 1. Fetch leads whose window has elapsed and are still scheduled.
  const { data: leads, error } = await supabase
    .from('smart_leads')
    .select(
      'id, customer_name, company_name, product_interest, communication_preference, source_channel, phone_number, lead_channel_id, email, scheduled_dispatch_at, auto_reply_status'
    )
    .eq('tenant_id', tenantId)
    .eq('auto_reply_status', 'scheduled')
    .lte('scheduled_dispatch_at', now.toISOString())
    .is('deleted_at', null)
    .limit(limit);

  if (error) {
    console.error('💥 [AutoReplySweeper]: Failed to fetch due leads —', error.message);
    return recordRun({ ...summary, error: error.message });
  }

  if (!leads || leads.length === 0) return recordRun(summary);

  console.log(`⏰ [AutoReplySweeper]: ${leads.length} scheduled reply(ies) due — dispatching...`);

  for (const lead of leads) {
    summary.scanned++;

    // Defensive re-check (clock/race safety).
    if (!isDue(lead, now)) {
      summary.skipped++;
      continue;
    }

    // 2. Claim the lead before doing anything customer-facing. A concurrent
    // sweeper run racing on the same lead loses this UPDATE (matches zero
    // rows, since either auto_reply_status has already moved on or
    // claimed_at is already fresh) and skips instead of double-dispatching.
    const staleBefore = new Date(now.getTime() - claimStaleMs).toISOString();
    const { data: claimed, error: claimErr } = await supabase
      .from('smart_leads')
      .update({ claimed_at: now.toISOString() })
      .eq('id', lead.id)
      .eq('tenant_id', tenantId)
      .eq('auto_reply_status', 'scheduled')
      .or(`claimed_at.is.null,claimed_at.lt.${staleBefore}`)
      .select('id')
      .maybeSingle();

    if (claimErr) {
      console.error(`⚠️ [AutoReplySweeper]: Claim attempt errored for lead ${lead.id} —`, claimErr.message);
      summary.skipped++;
      continue;
    }
    if (!claimed) {
      // Already claimed (and not yet stale) by another run, or no longer
      // 'scheduled' (e.g. a rejection landed first) — not ours to process.
      summary.claimLost++;
      continue;
    }

    // 3. Fetch the most recent outbound draft for this lead.
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

    // 4. Dispatch on the lead's preferred channel.
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
      // 5a. Mark sent — guarded so a concurrent rejection wins.
      const { error: updErr } = await supabase
        .from('smart_leads')
        .update({ auto_reply_status: 'sent', last_contacted_at: now.toISOString() })
        .eq('id', lead.id)
        .eq('tenant_id', tenantId)
        .eq('auto_reply_status', 'scheduled');

      if (updErr) {
        console.error(`⚠️ [AutoReplySweeper]: Dispatched but failed to mark sent for ${lead.id} —`, updErr.message);
      }
      summary.dispatched++;
    } else {
      // 5b. Dispatch failed (not a crash — we're still running). Release the
      // claim immediately so the very next tick can retry without waiting
      // out the staleness window. Guarded the same way: a concurrent
      // rejection still wins over this release.
      const { error: releaseErr } = await supabase
        .from('smart_leads')
        .update({ claimed_at: null })
        .eq('id', lead.id)
        .eq('tenant_id', tenantId)
        .eq('auto_reply_status', 'scheduled');

      if (releaseErr) {
        console.error(`⚠️ [AutoReplySweeper]: Failed to release claim for ${lead.id} —`, releaseErr.message);
      }
      summary.failed++;
    }
  }

  console.log(
    `⏰ [AutoReplySweeper]: Run complete — ${summary.dispatched} sent, ${summary.failed} failed, ${summary.skipped} skipped, ${summary.claimLost} claim-lost.`
  );
  return recordRun(summary);
}

/**
 * Start the sweeper. Checks every minute. Call once at server startup.
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {Object}        [opts]
 * @param {Function|null} [opts.whatsappSender] — async (to, text) => void; wwebjs client.sendMessage
 * @param {string}        [opts.tenantId] — interim single-tenant scoping (Block 1.7a-2); defaults to DEFAULT_TENANT_ID.
 */
export function startAutoReplySweeper(supabase, { whatsappSender, tenantId = DEFAULT_TENANT_ID } = {}) {
  console.log('[AutoReplySweeper]: Started — sweeping scheduled replies every 60s');
  const dispatch = makeDispatch(whatsappSender);

  setInterval(() => {
    sweepScheduledReplies(supabase, { dispatch, tenantId }).catch((err) =>
      console.error('💥 [AutoReplySweeper]: Unexpected error —', err.message)
    );
  }, SWEEP_INTERVAL_MS);
}
