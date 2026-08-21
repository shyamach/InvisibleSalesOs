/**
 * lib/digestScheduler.js — Hourly scheduler that fires the weekly digest every Monday at 8am UTC.
 *
 * Call startDigestScheduler(supabase) once at server startup.
 * A sent-flag keyed on YYYY-WW prevents double-sending within the same ISO week.
 */

import { sendWeeklyDigest } from './weeklyDigest.js';
import { createSystemClient } from './supabase.js';
import { logSystemEvent } from './systemLog.js';

// Track the last ISO week we already sent for (e.g. "2025-W04")
let lastSentWeek = null;

// Module-level last-run state (Phase E, item E3), same shape as
// lib/autoReplySweeper.js's getSweeperStatus()/lib/followUpEngine.js's
// getFollowUpEngineStatus().
const lastRun = { at: null, summary: null };

/** Read-only snapshot of the scheduler's most recent run — for status/health endpoints. */
export function getDigestSchedulerStatus() {
  return { ...lastRun, lastSentWeek };
}

function recordRun(summary) {
  lastRun.at = new Date().toISOString();
  lastRun.summary = summary;
  return summary;
}

function getISOWeekKey(date) {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

function isMondayAt8amUTC() {
  const now = new Date();
  return now.getUTCDay() === 1 && now.getUTCHours() === 8;
}

async function runDigestForAllTenants(supabase) {
  const weekKey = getISOWeekKey(new Date());

  if (lastSentWeek === weekKey) {
    // Already sent this week — skip
    return;
  }

  console.log(`📧 [Digest Scheduler]: Monday 8am UTC — running digest for all tenants (week ${weekKey})`);

  // Fetch all tenants with an owner_email — inherently cross-tenant, so this
  // one query stays on the shared anon `supabase` client passed in by the
  // caller. There's no single tenant to mint a system token for here; a
  // per-tenant createSystemClient() is used below, once we're iterating a
  // specific tenant. (cto-ai/security-lead consult, Phase D — see
  // DB_AUDIT_REPORT.md §24-25.)
  const { data: tenants, error } = await supabase
    .from('tenants')
    .select('id, name, owner_email')
    .not('owner_email', 'is', null);

  if (error) {
    console.error(`❌ [Digest Scheduler]: Failed to fetch tenants — ${error.message}`);
    logSystemEvent({ category: 'digest', severity: 'error', message: error.message, source: 'lib/digestScheduler.js#runDigestForAllTenants' });
    recordRun({ weekKey, tenantsFound: 0, sent: 0, failed: 0, error: error.message });
    return;
  }

  if (!tenants || tenants.length === 0) {
    console.log('[Digest Scheduler]: No tenants with owner_email — nothing to send');
    lastSentWeek = weekKey; // Mark as done so we don't spam logs
    recordRun({ weekKey, tenantsFound: 0, sent: 0, failed: 0 });
    return;
  }

  let successCount = 0;
  let failCount = 0;

  for (const tenant of tenants) {
    // Scoped to this one tenant now that we know its id — real per-tenant RLS
    // enforcement instead of the shared anon client for the actual digest data.
    const result = await sendWeeklyDigest(createSystemClient(tenant.id), tenant.id, tenant.owner_email);
    if (result.success) {
      console.log(`📧 [Digest]: Sent to ${tenant.owner_email} for tenant ${tenant.name}`);
      successCount++;
    } else {
      console.error(`❌ [Digest]: Failed for tenant ${tenant.name} (${tenant.id}) — ${result.error}`);
      failCount++;
    }
  }

  console.log(`📧 [Digest Scheduler]: Week ${weekKey} complete — ${successCount} sent, ${failCount} failed`);
  lastSentWeek = weekKey;
  recordRun({ weekKey, tenantsFound: tenants.length, sent: successCount, failed: failCount });
}

/**
 * Start the digest scheduler. Checks every hour if it's Monday 8am UTC.
 * @param {Object} supabase — Supabase client from lib/supabase.js
 */
export function startDigestScheduler(supabase) {
  const CHECK_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

  console.log('[Digest Scheduler]: Started — checking every hour for Monday 8am UTC');

  // Run immediately on startup (in case server restarted during the trigger window)
  if (isMondayAt8amUTC()) {
    runDigestForAllTenants(supabase).catch(err => {
      console.error(`❌ [Digest Scheduler]: Unexpected error — ${err.message}`);
      logSystemEvent({ category: 'digest', severity: 'error', message: err.message, source: 'lib/digestScheduler.js#startDigestScheduler' });
    });
  }

  setInterval(() => {
    if (isMondayAt8amUTC()) {
      runDigestForAllTenants(supabase).catch(err => {
        console.error(`❌ [Digest Scheduler]: Unexpected error — ${err.message}`);
      });
    }
  }, CHECK_INTERVAL_MS);
}
