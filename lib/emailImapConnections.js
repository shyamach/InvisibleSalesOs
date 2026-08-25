/**
 * lib/emailImapConnections.js — Per-tenant IMAP polling registry.
 *
 * Replaces lib/emailListener.js's old single-tenant module-level poller
 * (one shared mailbox, global env-var credentials) — the same misattribution
 * bug class the WhatsApp session-isolation fix closed earlier this session
 * (see decision_whatsapp_multitenant_isolation memory): every fetched email
 * used to get hardcoded to DEFAULT_TENANT_ID regardless of whose mailbox it
 * actually came from.
 *
 * Design note: unlike WhatsApp's per-tenant Client registry, IMAP polling
 * has no persistent-process equivalent — imapflow does a fresh
 * connect→fetch→logout every tick, so there's no "session" to keep alive
 * per tenant. This registry is just per-tenant SCHEDULING STATE (backoff,
 * last error, next-due time) driven by one coarse shared timer, not N
 * independent timers or N long-lived connections.
 *
 * Backoff semantics preserved from the old single-tenant poller (auth
 * failures back off hard — 30min — since a bad password doesn't self-heal
 * and hammering Gmail with failing credentials risks its own abuse
 * detection; network errors get capped exponential backoff) — kept PER
 * TENANT now instead of module-global, so one tenant's bad credentials
 * can't starve or throttle every other tenant's polling.
 */
import { fetchUnreadEmails, classifyImapError, isImapAvailable } from './emailListener.js';
import { createSystemClient } from './supabase.js';
import { logSystemEvent } from './systemLog.js';

const TICK_MS = 20_000; // how often the shared loop checks who's due
const NORMAL_POLL_MS = 60_000; // per-tenant cadence on success, matches old POLL_INTERVAL_MS
const AUTH_FAILURE_BACKOFF_MS = 30 * 60_000;
const MAX_NETWORK_BACKOFF_MS = 10 * 60_000;
const MAX_PER_POLL = parseInt(process.env.EMAIL_IMAP_MAX_PER_POLL || '20', 10);
const MAX_CONCURRENT_POLLS = 4;

/** @type {Map<string, { host: string, port: number, username: string, lastAttemptAt: string|null, lastSuccessAt: string|null, lastError: string|null, lastErrorClass: string|null, consecutiveFailures: number, nextPollAt: string|null, polling: boolean }>} */
const connections = new Map();

// Set once at boot from server.js — same reasoning as
// lib/whatsappSessions.js#initWhatsAppSessions: avoids a circular import
// with server.js's large message-handling callback.
let onEmail = null;
export function initEmailImapConnections(handler) {
  onEmail = handler;
}

function freshState(host, port, username) {
  return {
    host, port, username,
    lastAttemptAt: null, lastSuccessAt: null, lastError: null, lastErrorClass: null,
    consecutiveFailures: 0, nextPollAt: new Date().toISOString(), // due immediately
    polling: false,
  };
}

/** Called by the settings endpoint after a tenant saves/enables their IMAP config — adds or updates the in-memory entry so polling starts without a server restart. */
export function registerTenantConnection(tenantId, { host, port, username }) {
  const existing = connections.get(tenantId);
  if (existing) {
    Object.assign(existing, { host, port, username });
  } else {
    connections.set(tenantId, freshState(host, port, username));
  }
}

/** Called by the settings endpoint on disconnect/disable. */
export function unregisterTenantConnection(tenantId) {
  connections.delete(tenantId);
}

/** Read-only snapshot for one tenant — for the tenant-scoped health endpoint. */
export function getEmailListenerStatus(tenantId) {
  const s = connections.get(tenantId);
  if (!s) {
    return { enabled: false, lastAttemptAt: null, lastSuccessAt: null, lastError: null, lastErrorClass: null, consecutiveFailures: 0, nextPollAt: null };
  }
  const { host: _h, port: _p, username: _u, polling: _pl, ...status } = s;
  return { enabled: true, ...status };
}

/** Ops-wide aggregate for the internal /api/health/detailed diagnostic endpoint. */
export function getEmailListenerSummary() {
  let healthy = 0;
  let errored = 0;
  for (const s of connections.values()) {
    if (s.consecutiveFailures === 0) healthy++;
    else errored++;
  }
  return { healthy, errored, total: connections.size };
}

async function defaultGetPassword(tenantId) {
  const { data, error } = await createSystemClient(tenantId).rpc('get_email_imap_password', { p_tenant_id: tenantId });
  if (error) throw error;
  return data;
}

/**
 * @param {string} tenantId
 * @param {Object} [deps] — injectable for tests; default to the real IMAP fetch + vault-backed password lookup.
 * @param {Function} [deps.fetchEmails]
 * @param {Function} [deps.getPassword]
 */
export async function pollTenant(tenantId, { fetchEmails = fetchUnreadEmails, getPassword = defaultGetPassword } = {}) {
  const s = connections.get(tenantId);
  if (!s || s.polling) return;

  s.polling = true;
  s.lastAttemptAt = new Date().toISOString();

  try {
    const password = await getPassword(tenantId);
    if (!password) throw new Error('No IMAP password stored for this tenant');

    const emails = await fetchEmails({ host: s.host, port: s.port, user: s.username, pass: password }, MAX_PER_POLL);

    s.lastSuccessAt = new Date().toISOString();
    s.consecutiveFailures = 0;
    s.lastError = null;
    s.lastErrorClass = null;
    s.nextPollAt = new Date(Date.now() + NORMAL_POLL_MS).toISOString();

    if (emails.length > 0 && onEmail) {
      console.log(`📨 [Email:${tenantId}]: ${emails.length} new email(s) — routing to pipeline...`);
      for (const email of emails) {
        await onEmail(email, tenantId).catch((err) =>
          console.error(`📧 [Email:${tenantId}]: Pipeline error for email —`, err.message)
        );
      }
    }
  } catch (err) {
    s.consecutiveFailures += 1;
    s.lastError = err.message;
    s.lastErrorClass = classifyImapError(err);

    logSystemEvent({
      category: 'imap',
      severity: s.lastErrorClass === 'auth' ? 'error' : 'warning',
      message: err.message,
      detail: { tenantId, errorClass: s.lastErrorClass, consecutiveFailures: s.consecutiveFailures, code: err.code },
      source: 'lib/emailImapConnections.js#pollTenant',
    });

    if (s.lastErrorClass === 'auth') {
      console.error(`📧 [Email:${tenantId}]: IMAP auth failure (${s.consecutiveFailures} consecutive) — backing off ${AUTH_FAILURE_BACKOFF_MS / 60_000}min.`);
      s.nextPollAt = new Date(Date.now() + AUTH_FAILURE_BACKOFF_MS).toISOString();
    } else {
      const backoff = Math.min(NORMAL_POLL_MS * 2 ** Math.min(s.consecutiveFailures, 5), MAX_NETWORK_BACKOFF_MS);
      console.error(`📧 [Email:${tenantId}]: Poll error (${s.lastErrorClass}) —`, err.message, `— retrying in ${Math.round(backoff / 1000)}s`);
      s.nextPollAt = new Date(Date.now() + backoff).toISOString();
    }
  } finally {
    s.polling = false;
  }
}

async function tick() {
  const due = [];
  const now = Date.now();
  for (const [tenantId, s] of connections) {
    if (!s.polling && s.nextPollAt && new Date(s.nextPollAt).getTime() <= now) {
      due.push(tenantId);
    }
  }
  // Cap concurrency — imapflow has no built-in throttle, and many tenants'
  // due-times could cluster on one tick.
  for (let i = 0; i < due.length; i += MAX_CONCURRENT_POLLS) {
    // Array.prototype.map calls its callback as (element, index, array) — a
    // bare `.map(pollTenant)` would pass the array index into pollTenant's
    // second (options) parameter. Wrapped so only tenantId is ever passed.
    await Promise.all(due.slice(i, i + MAX_CONCURRENT_POLLS).map((tenantId) => pollTenant(tenantId)));
  }
}

/**
 * Discover every tenant with IMAP enabled and seed the registry — called
 * once at boot. A fresh install with no configured tenants starts zero
 * polling; tenants added later via registerTenantConnection() (the settings
 * save path) don't need a restart to start polling.
 */
export async function rehydrateEmailConnections(bootstrapTenantId) {
  if (!isImapAvailable()) {
    console.error('📧 [Email]: imapflow not installed — per-tenant IMAP polling disabled.');
    return;
  }

  try {
    const { data, error } = await createSystemClient(bootstrapTenantId).rpc('list_enabled_email_imap_connections');
    if (error) throw error;

    for (const row of data || []) {
      console.log(`🔄 [Email]: Registering IMAP polling for tenant ${row.tenant_id} (${row.host})...`);
      registerTenantConnection(row.tenant_id, { host: row.host, port: row.port, username: row.username });
    }
  } catch (err) {
    console.error('💥 [Email]: Rehydration failed —', err.message);
  }

  setInterval(tick, TICK_MS);
}
