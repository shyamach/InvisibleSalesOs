/**
 * controllers/systemHealth.js — Operator logs/health dashboard backend.
 *
 * Routes (behind requireAuth):
 *   GET /api/system/health — main-page summary: live subsystem state (the
 *     Phase E get*Status() getters) + a categorized rollup of what's landed
 *     in system_logs over a time window + a derived "blockers" list.
 *   GET /api/system/logs   — sub-page: paginated raw log rows, filterable.
 *
 * Tenant identity comes from req.tenantId (set by requireAuth from the
 * caller's verified JWT) — never from a header/body/query value. Queries run
 * on req.supabase, the per-request client seeded with that JWT.
 */
import { getSession } from '../lib/whatsappSessions.js';
import { getCircuitBreakerStatus } from '../lib/anthropicClient.js';
import { getEmailListenerStatus } from '../lib/emailListener.js';
import { getSweeperStatus } from '../lib/autoReplySweeper.js';
import { getFollowUpEngineStatus } from '../lib/followUpEngine.js';
import { getDigestSchedulerStatus } from '../lib/digestScheduler.js';
import { LOG_CATEGORIES } from '../lib/systemLog.js';

function requireTenant(req, res) {
  if (req.tenantId) return true;
  res.status(403).json({ success: false, error: 'No tenant associated with this account' });
  return false;
}

/**
 * Derive a simple traffic-light + blockers list from the live subsystem
 * getters — "is anything actively broken right now", independent of the
 * historical log rollup below (which answers "how often has X failed
 * recently", a different question).
 */
function deriveBlockers({ whatsapp, claude, imap, autoReplySweeper, followUpEngine, digestScheduler }) {
  const blockers = [];

  if (whatsapp.status !== 'connected') {
    blockers.push({ category: 'whatsapp', message: `WhatsApp session is ${whatsapp.status}`, severity: whatsapp.status === 'disconnected' ? 'error' : 'warning' });
  }
  if (claude.state === 'open') {
    blockers.push({ category: 'claude', message: `Claude circuit breaker is open — API calls are being short-circuited (${claude.consecutiveFailures} consecutive failures)`, severity: 'error' });
  }
  if (imap.lastErrorClass) {
    blockers.push({ category: 'imap', message: `IMAP listener's last poll failed (${imap.lastErrorClass}): ${imap.lastError}`, severity: imap.lastErrorClass === 'auth' ? 'error' : 'warning' });
  }
  if (autoReplySweeper.summary?.error) {
    blockers.push({ category: 'auto_reply', message: `AutoReplySweeper's last run failed: ${autoReplySweeper.summary.error}`, severity: 'error' });
  }
  if (followUpEngine.summary?.error) {
    blockers.push({ category: 'follow_up', message: `FollowUpEngine's last run failed: ${followUpEngine.summary.error}`, severity: 'error' });
  }
  if (digestScheduler.summary?.error) {
    blockers.push({ category: 'digest', message: `DigestScheduler's last run failed: ${digestScheduler.summary.error}`, severity: 'error' });
  }

  return blockers;
}

// ── Summary (main page) ─────────────────────────────────────────────────────

export async function getSystemHealthSummary(req, res) {
  if (!requireTenant(req, res)) return;

  const windowHours = Math.min(Number(req.query.window_hours) || 24, 24 * 30);
  const since = new Date(Date.now() - windowHours * 60 * 60 * 1000).toISOString();

  const live = {
    whatsapp: { status: getSession(req.tenantId)?.status ?? 'disconnected' },
    claude: getCircuitBreakerStatus(),
    imap: getEmailListenerStatus(),
    autoReplySweeper: getSweeperStatus(),
    followUpEngine: getFollowUpEngineStatus(),
    digestScheduler: getDigestSchedulerStatus(),
  };

  const { data: rows, error } = await req.supabase
    .from('system_logs')
    .select('category, severity')
    .eq('tenant_id', req.tenantId)
    .gte('created_at', since);

  if (error) return res.status(500).json({ success: false, error: error.message });

  const byCategory = {};
  for (const cat of LOG_CATEGORIES) byCategory[cat] = { error: 0, warning: 0, info: 0 };
  let totalErrors = 0;
  let totalWarnings = 0;

  for (const row of rows || []) {
    if (!byCategory[row.category]) byCategory[row.category] = { error: 0, warning: 0, info: 0 };
    byCategory[row.category][row.severity] = (byCategory[row.category][row.severity] || 0) + 1;
    if (row.severity === 'error') totalErrors++;
    if (row.severity === 'warning') totalWarnings++;
  }

  const blockers = deriveBlockers(live);
  const overallStatus = blockers.some((b) => b.severity === 'error')
    ? 'blocked'
    : blockers.length > 0
      ? 'degraded'
      : 'healthy';

  res.json({
    success: true,
    timestamp: new Date().toISOString(),
    window_hours: windowHours,
    overall_status: overallStatus,
    totals: { errors: totalErrors, warnings: totalWarnings, events: (rows || []).length },
    by_category: byCategory,
    blockers,
    live,
  });
}

// ── Full logs (sub-page) ────────────────────────────────────────────────────

export async function listSystemLogs(req, res) {
  if (!requireTenant(req, res)) return;

  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const offset = Math.max(Number(req.query.offset) || 0, 0);
  const category = req.query.category;
  const severity = req.query.severity;

  let query = req.supabase
    .from('system_logs')
    .select('*', { count: 'exact' })
    .eq('tenant_id', req.tenantId)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (category) query = query.eq('category', category);
  if (severity) query = query.eq('severity', severity);

  const { data, error, count } = await query;
  if (error) return res.status(500).json({ success: false, error: error.message });

  res.json({ success: true, logs: data, total: count, limit, offset });
}
