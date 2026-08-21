/**
 * lib/systemLog.js — Persistent categorized system event log.
 *
 * Phase F. Every background worker's error path already console.error()s —
 * that's fine for a live tail, useless for "what happened in the last 24h"
 * or "how often has this category failed" (the operator dashboard's job).
 * This is the write side: a best-effort, never-throwing helper that persists
 * one row to `system_logs` per call, on top of whatever console logging the
 * caller already does (never a replacement for it).
 *
 * Categories are a fixed, small vocabulary — kept in one place so the
 * dashboard's category breakdown doesn't have to reverse-engineer free text.
 */
import { createSystemClient } from './supabase.js';

const DEFAULT_TENANT_ID = process.env.DEFAULT_TENANT_ID || '00000000-0000-0000-0000-000000000001';

export const LOG_CATEGORIES = Object.freeze([
  'system',    // crash containment (uncaughtException/unhandledRejection), process-level
  'whatsapp',  // wwebjs connection state
  'imap',      // email listener
  'claude',    // Anthropic API / circuit breaker
  'auto_reply', // autoReplySweeper
  'follow_up', // followUpEngine
  'digest',    // digestScheduler
  'webhook',   // inbound webhook handling (Stripe, leads, etc.)
]);

const VALID_SEVERITIES = new Set(['error', 'warning', 'info']);

/**
 * Persist one system event. Never throws — a logging failure must not break
 * the caller's actual error-handling path. Fire-and-forget from a hot path
 * is fine; callers in an existing catch block can await it for ordering.
 *
 * @param {Object} args
 * @param {string} [args.tenantId] — defaults to DEFAULT_TENANT_ID (matches every other Phase D/E worker's single-tenant scoping)
 * @param {string} args.category   — one of LOG_CATEGORIES (not enforced at the DB layer, kept advisory so a new category doesn't need a migration)
 * @param {'error'|'warning'|'info'} [args.severity] — defaults to 'error'
 * @param {string} args.message
 * @param {Object|null} [args.detail]  — structured extra context, stored as JSONB
 * @param {string|null} [args.source]  — e.g. 'lib/emailListener.js#fetchUnreadEmails'
 */
export async function logSystemEvent({ tenantId = DEFAULT_TENANT_ID, category, severity = 'error', message, detail = null, source = null }) {
  try {
    if (!category || !message) return; // malformed call — nothing useful to persist
    const sev = VALID_SEVERITIES.has(severity) ? severity : 'error';
    const db = createSystemClient(tenantId);
    await db.from('system_logs').insert({
      tenant_id: tenantId,
      category,
      severity: sev,
      message: String(message).slice(0, 2000),
      detail,
      source,
    });
  } catch (err) {
    // Diagnostic side channel — must never crash or reject the caller's own
    // error-handling path just because the DB write itself failed.
    console.error('⚠️ [SystemLog]: failed to persist event —', err.message);
  }
}
