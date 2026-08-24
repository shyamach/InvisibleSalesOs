/**
 * lib/whatsappSessions.js — Per-tenant whatsapp-web.js session registry.
 *
 * Replaces lib/whatsappStatus.js's bare module-level `let`s, which assumed
 * one shared session for the whole backend — a second tenant's QR scan could
 * silently disconnect or misattribute a different tenant's session (fixed
 * 2026-08-23, see security-lead review). Each tenant now gets its own
 * `Client`, isolated via LocalAuth's `clientId` (a separate
 * `session-${clientId}` directory on disk under the same dataPath).
 *
 * getOrCreateSession/buildSession are deliberately synchronous end-to-end —
 * no `await` sits between the registry's has()/set() — so Node's
 * single-threaded run-to-completion semantics guarantee two "simultaneous"
 * calls for the same brand-new tenant (e.g. two rapid /api/status polls)
 * can't race into constructing two Clients against the same on-disk session
 * directory: the second call always observes the first call's map entry
 * already set. `client.initialize()` itself is fire-and-forget — callers
 * get the entry back immediately at status:'disconnected' and watch it
 * progress via the qr/authenticated/ready events.
 *
 * QR codes stay in-memory only, never persisted — they're a live bearer
 * credential (scanning one links a new device) and `whatsapp_sessions` has
 * no column for one anyway. `status`/`phone_number` ARE persisted, so a
 * previously-connected tenant survives a backend restart without a rescan
 * (see rehydrateSessions, called once at boot from server.js).
 */
import pkg from 'whatsapp-web.js';
const { Client, LocalAuth } = pkg;
import { createSystemClient } from './supabase.js';
import { logSystemEvent } from './systemLog.js';

// whatsapp-web.js hardcodes a Chrome/101 (2022) UA by default (its own
// src/util/Constants.js), years behind the actual Chrome build it drives via
// executablePath below — WhatsApp's backend can reject/flag device-linking
// over that stale/inconsistent fingerprint. Override to match Chrome 151.x.
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.7922.138 Safari/537.36';

const PUPPETEER_CONFIG = {
  headless: true,
  executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  args: [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-gpu',
  ],
};

// Chrome process count now scales with tenant count instead of being fixed
// at one, and there's no resource-limit config anywhere in this repo yet —
// warn loudly once the registry grows past a small number rather than
// silently exhausting host memory.
const SESSION_WARNING_THRESHOLD = 10;

/** @type {Map<string, { client: import('whatsapp-web.js').Client, status: 'disconnected'|'awaiting_scan'|'connected', qr: string|null }>} */
const sessions = new Map();

// Set once at boot from server.js — avoids a circular import with the large,
// server.js-local handleIncomingMessage function while still letting every
// per-tenant Client route its own inbound messages to it with the right
// tenant already resolved (no more DEFAULT_TENANT_ID hardcode downstream).
let onMessage = null;
export function initWhatsAppSessions(handler) {
  onMessage = handler;
}

async function persistStatus(tenantId, patch) {
  try {
    const { error } = await createSystemClient(tenantId)
      .from('whatsapp_sessions')
      .upsert({ tenant_id: tenantId, ...patch }, { onConflict: 'tenant_id' });
    if (error) throw error;
  } catch (err) {
    console.error(`💥 [WhatsAppSessions]: Failed to persist status for tenant ${tenantId} —`, err.message);
  }
}

function buildSession(tenantId) {
  const entry = { client: null, status: 'disconnected', qr: null };

  const client = new Client({
    authStrategy: new LocalAuth({ clientId: tenantId, dataPath: './.wwebjs_auth' }),
    userAgent: USER_AGENT,
    puppeteer: PUPPETEER_CONFIG,
  });
  entry.client = client;

  client.on('qr', (qr) => {
    entry.status = 'awaiting_scan';
    entry.qr = qr;
    console.log(`⚠️ [WhatsApp:${tenantId}]: QR code ready — scan to authenticate.`);
    persistStatus(tenantId, { status: 'awaiting_scan' });
  });

  client.on('authenticated', () => {
    entry.status = 'connected';
    entry.qr = null;
    console.log(`✅ [WhatsApp:${tenantId}]: Authenticated. Syncing chats...`);
  });

  client.on('ready', () => {
    entry.status = 'connected';
    console.log(`🟢 [WhatsApp:${tenantId}]: Session fully operational — dispatch ready.`);
    let phoneNumber = null;
    try { phoneNumber = client.info?.wid?.user ?? null; } catch { /* non-fatal */ }
    persistStatus(tenantId, { status: 'connected', phone_number: phoneNumber });
  });

  client.on('disconnected', (reason) => {
    entry.status = 'disconnected';
    entry.qr = null;
    console.log(`🔴 [WhatsApp:${tenantId}]: Session disconnected.`);
    logSystemEvent({ category: 'whatsapp', severity: 'error', message: `WhatsApp session disconnected: ${reason || 'unknown reason'}`, source: 'lib/whatsappSessions.js#disconnected' });
    persistStatus(tenantId, { status: 'disconnected' });
  });

  client.on('message_create', (msg) => {
    if (!onMessage) return;
    onMessage(msg, tenantId).catch((err) => {
      console.error(`🚨 [WhatsApp Handler:${tenantId}]: uncaught error processing message —`, err);
    });
  });

  client.initialize();
  return entry;
}

/** Returns this tenant's session, creating (and starting) one if none exists yet. */
export function getOrCreateSession(tenantId) {
  if (!sessions.has(tenantId)) {
    sessions.set(tenantId, buildSession(tenantId));
    if (sessions.size > SESSION_WARNING_THRESHOLD) {
      console.warn(`⚠️ [WhatsAppSessions]: ${sessions.size} concurrent WhatsApp-Web sessions running — no resource limits are configured for this yet.`);
    }
  }
  return sessions.get(tenantId);
}

/** Read-only lookup — does NOT create a session. Returns undefined if this tenant never connected. */
export function getSession(tenantId) {
  return sessions.get(tenantId);
}

/** Ops-wide aggregate for the internal /api/health/detailed diagnostic endpoint. */
export function getSessionsSummary() {
  let connected = 0;
  for (const entry of sessions.values()) {
    if (entry.status === 'connected') connected++;
  }
  return { connected, total: sessions.size };
}

/**
 * Reconnect every tenant that was previously connected, from their
 * disk-persisted LocalAuth session — called once at boot. A fresh install
 * with no prior connections spawns zero Chrome processes until the first
 * real trigger (a tenant's own /api/status poll).
 *
 * Reads across ALL tenants, so it can't go through the normal per-tenant
 * `createSystemClient(tenantId)` path (that mints a JWT scoped to exactly
 * one tenant, and whatsapp_sessions' RLS policy would then only match that
 * one row). Goes through the get_active_whatsapp_sessions() SECURITY DEFINER
 * RPC instead (supabase/migrations/phase_i_1_whatsapp_sessions_write_policies.sql)
 * — same pattern already used elsewhere in this codebase for backend reads/
 * writes that have no single legitimate tenant caller. `bootstrapTenantId`
 * is only used to mint a valid role:authenticated JWT to call the RPC with;
 * the RPC's own body ignores that claim and returns every tenant's active
 * sessions by design.
 */
export async function rehydrateSessions(bootstrapTenantId) {
  try {
    const { data, error } = await createSystemClient(bootstrapTenantId).rpc('get_active_whatsapp_sessions');
    if (error) throw error;

    for (const row of data || []) {
      console.log(`🔄 [WhatsAppSessions]: Rehydrating session for tenant ${row.tenant_id}...`);
      getOrCreateSession(row.tenant_id);
    }
  } catch (err) {
    console.error('💥 [WhatsAppSessions]: Rehydration failed —', err.message);
  }
}
