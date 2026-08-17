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
const BACKEND_HEALTH_URL = process.env.BACKEND_URL
  ? `${process.env.BACKEND_URL}/api/health`
  : `http://localhost:${BACKEND_PORT}/api/health`;

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

async function main() {
  const [supabaseResult, backendResult] = await Promise.all([checkSupabase(), checkBackend()]);
  const timestamp = new Date().toISOString();
  const allUp = supabaseResult.up && backendResult.up;
  const overall = allUp ? 'ALL SYSTEMS UP' : 'DEGRADED';

  const entry = [
    `## ${timestamp}`,
    '',
    `- ${fmt('Supabase', supabaseResult)}`,
    `- ${fmt(`Backend (${BACKEND_HEALTH_URL})`, backendResult)}`,
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
