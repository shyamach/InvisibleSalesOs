/**
 * lib/emailListener.js — IMAP email ingestion service.
 *
 * Polls an IMAP mailbox every 60 seconds, fetches unread messages,
 * and feeds them into the same AI pipeline as WhatsApp leads.
 *
 * Supported providers (OAuth2 + password):
 *   Gmail  → imap.gmail.com:993 (requires App Password or OAuth2)
 *   Outlook → outlook.office365.com:993
 *   Any IMAP provider with host/port/auth credentials
 *
 * Required .env.local vars:
 *   EMAIL_IMAP_HOST     — e.g. "imap.gmail.com"
 *   EMAIL_IMAP_PORT     — e.g. "993"
 *   EMAIL_IMAP_USER     — your email address
 *   EMAIL_IMAP_PASS     — Gmail App Password (not your real password!)
 *   EMAIL_IMAP_ENABLED  — set to "true" to activate (defaults to off)
 *   EMAIL_IMAP_MAX_PER_POLL — optional, default 20. Caps how many unseen
 *     messages get fetched per tick — a real inbox with a large unread
 *     backlog (confirmed live, 2026-08-21: 486 unseen) times out trying to
 *     download full source for all of them in one unpaginated IMAP FETCH.
 *     A large backlog drains naturally over successive 60s polls instead.
 *
 * Gmail App Password setup:
 *   1. myaccount.google.com → Security → 2-Step Verification → ON
 *   2. Security → App passwords → Create → "Mail" → Copy 16-char code
 *   3. Paste as EMAIL_IMAP_PASS in .env.local
 *
 * Usage: import { startEmailListener } from './lib/emailListener.js'
 *        startEmailListener(processLeadCallback)
 *
 * Note: imapflow must be installed: npm install imapflow
 */

import { logSystemEvent } from './systemLog.js';

let ImapFlow;
try {
  // Dynamic import so the server doesn't crash if imapflow isn't installed yet
  const mod = await import('imapflow');
  ImapFlow = mod.ImapFlow;
} catch {
  ImapFlow = null;
}

const POLL_INTERVAL_MS = 60_000; // normal cadence
const MAX_MESSAGES_PER_POLL = parseInt(process.env.EMAIL_IMAP_MAX_PER_POLL || '20', 10);
// Auth failures don't self-heal on retry (a bad/expired password stays bad),
// and hammering Gmail every 60s with failing credentials is exactly the
// pattern that triggers Gmail's own abuse/lockout detection — back off hard
// instead of retrying at the normal cadence (Phase E, item E1).
const AUTH_FAILURE_BACKOFF_MS = 30 * 60_000;
// Transient network errors get exponential backoff, capped here so a long
// outage doesn't silently stretch the poll interval out to hours.
const MAX_NETWORK_BACKOFF_MS = 10 * 60_000;

// Module-level state, read by getEmailListenerStatus() — the status surface
// Phase E's E3 health endpoint will report on. Not reset between polls;
// each tick updates it in place.
const status = {
  enabled: false,
  lastAttemptAt: null,
  lastSuccessAt: null,
  lastError: null,
  lastErrorClass: null, // 'auth' | 'network' | 'other' | null
  consecutiveFailures: 0,
  nextPollAt: null,
};

/** Read-only snapshot of the listener's current health — for status/health endpoints. */
export function getEmailListenerStatus() {
  return { ...status };
}

/**
 * Classify a thrown error so the caller can decide how hard to back off.
 * imapflow sets `authenticationFailed: true` on IMAP AUTHENTICATIONFAILED
 * responses (confirmed live against Gmail — see DB_AUDIT_REPORT.md Phase E
 * notes); Node's own socket layer sets `.code` for connection-level failures.
 */
export function classifyImapError(err) {
  if (err?.authenticationFailed) return 'auth';
  if (['ENOTFOUND', 'ECONNREFUSED', 'ETIMEDOUT', 'ECONNRESET', 'EHOSTUNREACH'].includes(err?.code)) return 'network';
  return 'other';
}

/**
 * @typedef {Object} ParsedEmail
 * @property {string} from
 * @property {string} subject
 * @property {string} body
 * @property {Date}   date
 */

/**
 * Fetch unread emails from the configured IMAP account.
 * Marks them as read after processing.
 *
 * @returns {Promise<ParsedEmail[]>}
 */
async function fetchUnreadEmails() {
  const host = process.env.EMAIL_IMAP_HOST;
  const port = parseInt(process.env.EMAIL_IMAP_PORT || '993', 10);
  const user = process.env.EMAIL_IMAP_USER;
  const pass = process.env.EMAIL_IMAP_PASS;

  if (!host || !user || !pass) {
    throw new Error('Missing EMAIL_IMAP_HOST, EMAIL_IMAP_USER, or EMAIL_IMAP_PASS in .env.local');
  }

  const client = new ImapFlow({
    host,
    port,
    secure: true,
    auth: { user, pass },
    logger: false, // suppress verbose IMAP protocol logs
  });

  const emails = [];

  try {
    await client.connect();

    // Lock INBOX for reading
    const lock = await client.getMailboxLock('INBOX');

    try {
      // Ask the server for just the unseen UIDs first (cheap — no message
      // bodies transferred) instead of fetching '1:*' (every message,
      // seen and unseen, in the whole mailbox) and filtering client-side —
      // that unpaginated shape is what timed out against a real backlog.
      const uids = await client.search({ seen: false }, { uid: true });

      // Cap how many full message sources get downloaded this tick. A
      // large backlog (confirmed live, 2026-08-21: 486 unseen — a single
      // fetch of that size hit a socket timeout twice in a row) drains
      // naturally over successive polls instead of one huge transfer.
      const batchUids = (uids || []).slice(0, MAX_MESSAGES_PER_POLL);

      if (batchUids.length > 0) {
        const messages = await client.fetch(batchUids, {
          source: true,
          envelope: true,
          flags: true,
        }, { uid: true });

        for await (const msg of messages) {
          // Defensive — search() already guarantees these are unseen; this
          // only matters if another client marked one seen in the gap
          // between the search above and this fetch.
          if (msg.flags?.has('\\Seen')) continue;

          const raw = msg.source.toString('utf-8');

          // Quick plain-text extraction (no full MIME parser needed for MVP)
          let body = '';
          const textMatch = raw.match(/Content-Type: text\/plain[\s\S]*?\r\n\r\n([\s\S]*?)(?:\r\n--|\r\n\r\n--|$)/i);
          if (textMatch) {
            body = textMatch[1].trim();
          } else {
            // Fallback: strip HTML tags if only HTML part available
            const htmlMatch = raw.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
            if (htmlMatch) body = htmlMatch[1].replace(/<[^>]+>/g, ' ').trim();
          }

          const from = msg.envelope?.from?.[0];
          const fromStr = from
            ? `${from.name || ''} <${from.mailbox}@${from.host}>`.trim()
            : 'Unknown';

          emails.push({
            from: fromStr,
            subject: msg.envelope?.subject || '(no subject)',
            body: body.slice(0, 4000), // cap at 4k chars — same as WhatsApp 1500 char limit philosophy
            date: msg.envelope?.date ?? new Date(),
            uid: msg.uid,
          });

          // Mark as read so we don't re-process on next poll
          await client.messageFlagsAdd({ uid: msg.uid }, ['\\Seen']);
        }
      }
    } finally {
      lock.release();
    }

    await client.logout();
  } catch (err) {
    // Try to close cleanly without throwing
    try { await client.logout(); } catch { /* ignore */ }
    throw err;
  }

  return emails;
}

/**
 * Start the email polling loop (Phase E, item E1 — IMAP supervisor).
 *
 * Unlike a fixed setInterval, this reschedules itself after every tick with
 * a delay that depends on what just happened: normal cadence on success or a
 * transient error, a long fixed backoff on an auth failure specifically
 * (auth failures don't self-heal on retry, and retrying them at the normal
 * cadence risks Gmail's own abuse detection — see AUTH_FAILURE_BACKOFF_MS
 * above), and capped exponential backoff for anything else.
 *
 * @param {Function} onEmail — async (email: ParsedEmail) => void
 *   Called once per unread email. Should feed into the lead pipeline.
 * @param {Object}   [opts]
 * @param {Function} [opts.fetchEmails]     — injectable, defaults to fetchUnreadEmails (for tests)
 * @param {Function} [opts.scheduleTimeout] — injectable, defaults to setTimeout (for tests)
 * @returns {{ stop: Function }|undefined} — stop() clears the pending timer; undefined if the listener never started (disabled or imapflow missing)
 */
export function startEmailListener(onEmail, { fetchEmails = fetchUnreadEmails, scheduleTimeout = setTimeout } = {}) {
  if (process.env.EMAIL_IMAP_ENABLED !== 'true') {
    console.log('📧 [Email]: IMAP listener disabled (EMAIL_IMAP_ENABLED != true).');
    return;
  }

  if (!ImapFlow) {
    console.error('📧 [Email]: imapflow not installed. Run: npm install imapflow');
    return;
  }

  // Fresh session — reset in place (not a new object) so any earlier
  // getEmailListenerStatus() reference still sees live updates. Guards
  // against stale failure counts from an earlier startEmailListener()
  // lifecycle leaking into this one's backoff calculation.
  Object.assign(status, {
    enabled: true,
    lastAttemptAt: null,
    lastSuccessAt: null,
    lastError: null,
    lastErrorClass: null,
    consecutiveFailures: 0,
    nextPollAt: null,
  });
  console.log(`📧 [Email]: IMAP listener starting — polling ${process.env.EMAIL_IMAP_HOST} every ${POLL_INTERVAL_MS / 1000}s`);

  let timer = null;
  const scheduleNext = (delayMs) => {
    status.nextPollAt = new Date(Date.now() + delayMs).toISOString();
    timer = scheduleTimeout(tick, delayMs);
  };

  const tick = async () => {
    status.lastAttemptAt = new Date().toISOString();

    try {
      const emails = await fetchEmails();

      status.lastSuccessAt = new Date().toISOString();
      status.consecutiveFailures = 0;
      status.lastError = null;
      status.lastErrorClass = null;

      if (emails.length > 0) {
        console.log(`📨 [Email]: ${emails.length} new email(s) — routing to pipeline...`);
        for (const email of emails) {
          await onEmail(email).catch((err) =>
            console.error('📧 [Email]: Pipeline error for email:', err.message)
          );
        }
      }

      scheduleNext(POLL_INTERVAL_MS);
    } catch (err) {
      status.consecutiveFailures += 1;
      status.lastError = err.message;
      status.lastErrorClass = classifyImapError(err);

      logSystemEvent({
        category: 'imap',
        severity: status.lastErrorClass === 'auth' ? 'error' : 'warning',
        message: err.message,
        detail: { errorClass: status.lastErrorClass, consecutiveFailures: status.consecutiveFailures, code: err.code },
        source: 'lib/emailListener.js#tick',
      });

      if (status.lastErrorClass === 'auth') {
        console.error(
          `📧 [Email]: IMAP auth failure (${status.consecutiveFailures} consecutive) — ` +
          `credentials likely need to be regenerated. Backing off ${AUTH_FAILURE_BACKOFF_MS / 60_000}min ` +
          `instead of retrying at the normal cadence.`
        );
        scheduleNext(AUTH_FAILURE_BACKOFF_MS);
      } else {
        const backoff = Math.min(
          POLL_INTERVAL_MS * 2 ** Math.min(status.consecutiveFailures, 5),
          MAX_NETWORK_BACKOFF_MS
        );
        console.error(`📧 [Email]: Poll error (${status.lastErrorClass}) —`, err.message, `— retrying in ${Math.round(backoff / 1000)}s`);
        scheduleNext(backoff);
      }
    }
  };

  tick(); // run once immediately, then self-reschedule per the logic above

  return {
    stop: () => { if (timer) clearTimeout(timer); },
  };
}
