/**
 * lib/autoReply.js — Auto-reply decision engine.
 *
 * Pure, side-effect-free. Given a lead's priority and a tenant's auto-reply
 * configuration, returns a STRUCTURED JSON decision (Rule #2) describing
 * whether the generated draft should be dispatched now, scheduled for an
 * approval window, or held for manual approval.
 *
 * Board decision (2026-06-28):
 *   - Per-tenant master toggle (`enabled`)
 *   - Per-priority routing:
 *       auto    → dispatch immediately
 *       window  → auto-send after `window_minutes` UNLESS a human rejects it
 *       manual  → always requires human approval
 *   - HIGH priority is ALWAYS manual, regardless of tenant config (safety rule).
 *   - When auto-reply is disabled, everything is manual.
 */
import { z } from 'zod';

// Default config — mirrors the DB default on tenants.auto_reply so the engine
// behaves sanely even if a tenant row predates the column or has a null value.
export const DEFAULT_AUTO_REPLY = Object.freeze({
  enabled: false,
  priority_rules: { HIGH: 'manual', MEDIUM: 'window', LOW: 'auto' },
  window_minutes: 30,
});

const VALID_MODES = new Set(['auto', 'window', 'manual']);

// ─── Config schema (for the settings UI / API) ────────────────────────────────

const modeEnum = z.enum(['auto', 'window', 'manual']);

export const autoReplyConfigSchema = z.object({
  enabled: z.boolean(),
  priority_rules: z.object({ HIGH: modeEnum, MEDIUM: modeEnum, LOW: modeEnum }),
  window_minutes: z.coerce.number().int().min(1).max(1440),
});

/**
 * Validate an incoming (possibly partial) auto-reply config by merging it onto
 * the defaults first, so the UI can PATCH just the fields that changed.
 * @param {unknown} payload
 * @returns {{ ok: true, data: object } | { ok: false, issues: Array }}
 */
export function validateAutoReplyConfig(payload) {
  const p = payload && typeof payload === 'object' ? payload : {};
  const merged = {
    ...DEFAULT_AUTO_REPLY,
    ...p,
    priority_rules: { ...DEFAULT_AUTO_REPLY.priority_rules, ...(p.priority_rules || {}) },
  };
  const r = autoReplyConfigSchema.safeParse(merged);
  if (r.success) return { ok: true, data: r.data };
  return { ok: false, issues: r.error.issues.map((i) => ({ field: i.path.join('.') || '(root)', message: i.message })) };
}

/**
 * Normalise an arbitrary priority value into HIGH | MEDIUM | LOW.
 *
 * The parser emits HIGH | NORMAL; the triage layer emits HIGH | MEDIUM | LOW.
 * NORMAL and anything unrecognised collapses to MEDIUM. When a numeric score
 * is supplied (and priority is absent/unknown) we fall back to the triage
 * score bands: >=70 HIGH, >=40 MEDIUM, else LOW.
 *
 * @param {string|null|undefined} priority
 * @param {number|null|undefined} score
 * @returns {'HIGH'|'MEDIUM'|'LOW'}
 */
export function normalisePriority(priority, score = null) {
  const p = typeof priority === 'string' ? priority.trim().toUpperCase() : '';
  if (p === 'HIGH' || p === 'MEDIUM' || p === 'LOW') return p;
  if (p === 'NORMAL') return 'MEDIUM';

  if (typeof score === 'number' && Number.isFinite(score)) {
    if (score >= 70) return 'HIGH';
    if (score >= 40) return 'MEDIUM';
    return 'LOW';
  }
  // Unknown priority with no usable score — treat as MEDIUM (never auto-blast).
  return 'MEDIUM';
}

/**
 * Decide how a draft should be handled.
 *
 * @param {Object}  args
 * @param {string}  [args.priority]        — HIGH | MEDIUM | LOW | NORMAL (raw)
 * @param {number}  [args.score]           — optional numeric score for fallback
 * @param {Object}  [args.tenantAutoReply] — tenant.auto_reply config object
 * @param {Date}    [args.now]             — injectable clock (testability)
 * @returns {{
 *   action: 'auto_dispatch'|'scheduled'|'manual',
 *   status: 'dispatched'|'scheduled'|'manual_review',
 *   priority: 'HIGH'|'MEDIUM'|'LOW',
 *   scheduled_dispatch_at: string|null,
 *   window_minutes: number|null,
 *   auto_reply_enabled: boolean,
 *   reason: string
 * }}
 */
export function decideAutoReply({
  priority,
  score = null,
  tenantAutoReply = null,
  now = new Date(),
} = {}) {
  const cfg = sanitiseConfig(tenantAutoReply);
  const normPriority = normalisePriority(priority, score);

  // --- Hard safety rule: HIGH is always manual -----------------------------
  if (normPriority === 'HIGH') {
    return build('manual', normPriority, cfg, now, 'HIGH priority always requires manual approval');
  }

  // --- Master toggle off → everything manual -------------------------------
  if (!cfg.enabled) {
    return build('manual', normPriority, cfg, now, 'auto-reply disabled for tenant');
  }

  // --- Per-priority routing ------------------------------------------------
  const mode = cfg.priority_rules[normPriority] || 'manual';

  if (mode === 'auto') {
    return build('auto_dispatch', normPriority, cfg, now, `${normPriority} routed to immediate auto-dispatch`);
  }
  if (mode === 'window') {
    return build('scheduled', normPriority, cfg, now, `${normPriority} scheduled for ${cfg.window_minutes}-min approval window`);
  }
  // mode === 'manual' (or anything unexpected — fail safe to manual)
  return build('manual', normPriority, cfg, now, `${normPriority} routed to manual approval`);
}

// ─── internals ───────────────────────────────────────────────────────────────

/**
 * Coerce a possibly-partial / malformed config into a complete, valid one,
 * falling back to defaults field by field. Never throws.
 */
function sanitiseConfig(raw) {
  const base = { ...DEFAULT_AUTO_REPLY, priority_rules: { ...DEFAULT_AUTO_REPLY.priority_rules } };
  if (!raw || typeof raw !== 'object') return base;

  if (typeof raw.enabled === 'boolean') base.enabled = raw.enabled;

  if (raw.priority_rules && typeof raw.priority_rules === 'object') {
    for (const key of ['HIGH', 'MEDIUM', 'LOW']) {
      const v = raw.priority_rules[key];
      if (typeof v === 'string' && VALID_MODES.has(v)) base.priority_rules[key] = v;
    }
  }

  const wm = Number(raw.window_minutes);
  if (Number.isFinite(wm) && wm > 0) base.window_minutes = wm;

  return base;
}

function build(action, priority, cfg, now, reason) {
  const isScheduled = action === 'scheduled';
  const status =
    action === 'auto_dispatch' ? 'dispatched' : action === 'scheduled' ? 'scheduled' : 'manual_review';

  return {
    action,
    status,
    priority,
    scheduled_dispatch_at: isScheduled
      ? new Date(now.getTime() + cfg.window_minutes * 60_000).toISOString()
      : null,
    window_minutes: isScheduled ? cfg.window_minutes : null,
    auto_reply_enabled: cfg.enabled,
    reason,
  };
}
