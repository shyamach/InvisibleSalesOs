/**
 * scripts/checkSystemStatus.js — on-demand health check for Supabase + the
 * backend Express server. Run whenever you want to confirm both are
 * actually up (e.g. right after resuming a paused Supabase project),
 * rather than finding out mid-request. Appends one timestamped entry to
 * SYSTEM_STATUS_LOG.md per run — nothing here runs on a schedule.
 *
 * Usage: npm run check
 */
import { appendFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { supabase } from '../lib/supabase.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOG_PATH = path.resolve(__dirname, '../SYSTEM_STATUS_LOG.md');

const BACKEND_PORT = process.env.BACKEND_PORT || process.env.PORT || 3001;
const BACKEND_BASE_URL = process.env.BACKEND_URL || `http://localhost:${BACKEND_PORT}`;
const BACKEND_HEALTH_URL = `${BACKEND_BASE_URL}/api/health`;
const BACKEND_DETAILED_HEALTH_URL = `${BACKEND_BASE_URL}/api/health/detailed`;

async function checkSupabase() {
  const start = Date.now();
  try {
    // Lightest real round trip to the DB — same idiom used elsewhere in
    // this codebase (e.g. controllers/tenants.js) — not just a socket
    // check, so it also catches "reachable but RLS/schema is broken".
    const { error } = await supabase.from('tenants').select('id').limit(1);
    const ms = Date.now() - start;
    return error ? { up: false, ms, detail: error.message } : { up: true, ms, detail: null };
  } catch (err) {
    return { up: false, ms: Date.now() - start, detail: err.message };
  }
}

async function checkBackend() {
  const start = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3000);
  try {
    const res = await fetch(BACKEND_HEALTH_URL, { signal: controller.signal });
    const ms = Date.now() - start;
    return res.ok ? { up: true, ms, detail: null } : { up: false, ms, detail: `HTTP ${res.status}` };
  } catch (err) {
    const ms = Date.now() - start;
    const detail = err.name === 'AbortError' ? 'timed out after 3s' : err.message;
    return { up: false, ms, detail };
  } finally {
    clearTimeout(timeout);
  }
}

function fmt(name, result) {
  const icon = result.up ? '✅ UP' : '❌ DOWN';
  const detail = result.detail ? ` — ${result.detail}` : '';
  return `${name}: ${icon} (${result.ms}ms)${detail}`;
}

// Phase E, item E3 — surfaces breaker/IMAP/cron state that was previously
// invisible without tailing logs. Informational only: unlike checkSupabase/
// checkBackend, a failure here never flips `overall` to DEGRADED — the
// backend being reachable at all (checkBackend) is the load-bearing check;
// this just adds detail when it's available. Requires INTERNAL_API_KEY to
// be set locally (same key the backend itself expects).
async function checkDetailedHealth() {
  if (!process.env.INTERNAL_API_KEY) {
    return { available: false, reason: 'INTERNAL_API_KEY not set locally — skipped' };
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3000);
  try {
    const res = await fetch(BACKEND_DETAILED_HEALTH_URL, {
      headers: { 'x-internal-key': process.env.INTERNAL_API_KEY },
      signal: controller.signal,
    });
    if (!res.ok) return { available: false, reason: `HTTP ${res.status}` };
    return { available: true, data: await res.json() };
  } catch (err) {
    return { available: false, reason: err.name === 'AbortError' ? 'timed out after 3s' : err.message };
  } finally {
    clearTimeout(timeout);
  }
}

function fmtDetailedHealth(result) {
  if (!result.available) return `- Detailed health: not available (${result.reason})`;
  const { claude, imap, autoReplySweeper, followUpEngine, digestScheduler } = result.data;
  const lines = ['- Detailed health:'];
  lines.push(`  - Claude circuit breaker: ${claude.state}${claude.consecutiveFailures ? ` (${claude.consecutiveFailures} consecutive failures)` : ''}`);
  lines.push(`  - IMAP listener: ${imap.enabled ? (imap.lastErrorClass ? `degraded — ${imap.lastErrorClass} (${imap.consecutiveFailures} consecutive)` : 'ok') : 'disabled'}`);
  lines.push(`  - Auto-reply sweeper last run: ${autoReplySweeper.at || 'never'}`);
  lines.push(`  - Follow-up engine last run: ${followUpEngine.at || 'never'}`);
  lines.push(`  - Digest scheduler last run: ${digestScheduler.at || 'never'} (last sent week: ${digestScheduler.lastSentWeek || 'none'})`);
  return lines.join('\n');
}

async function main() {
  const [supabaseResult, backendResult, detailedHealthResult] = await Promise.all([
    checkSupabase(),
    checkBackend(),
    checkDetailedHealth(),
  ]);
  const timestamp = new Date().toISOString();
  const allUp = supabaseResult.up && backendResult.up;
  const overall = allUp ? 'ALL SYSTEMS UP' : 'DEGRADED';

  const entry = [
    `## ${timestamp}`,
    '',
    `- ${fmt('Supabase', supabaseResult)}`,
    `- ${fmt(`Backend (${BACKEND_HEALTH_URL})`, backendResult)}`,
    fmtDetailedHealth(detailedHealthResult),
    '',
    `**Overall: ${overall}**`,
    '',
    '---',
    '',
  ].join('\n');

  console.log(entry);
  await appendFile(LOG_PATH, entry + '\n');
  process.exitCode = allUp ? 0 : 1;
}

main().catch((err) => {
  console.error('[checkSystemStatus] Unexpected failure:', err.message);
  process.exitCode = 1;
});
