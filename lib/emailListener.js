/**
 * lib/emailListener.js — IMAP fetch utility.
 *
 * Stateless: fetches unread messages from ONE IMAP mailbox given explicit
 * credentials. Per-tenant scheduling, backoff, and status now live in
 * lib/emailImapConnections.js — this module used to own a single global
 * poller (env-var credentials, one mailbox for the whole backend); that
 * state machine moved there so multiple tenants' mailboxes can each keep
 * independent backoff state (2026-08-24, same fix shape as the WhatsApp
 * per-tenant session isolation earlier this session).
 *
 * Note: imapflow must be installed: npm install imapflow
 */

let ImapFlow;
try {
  // Dynamic import so the server doesn't crash if imapflow isn't installed yet
  const mod = await import('imapflow');
  ImapFlow = mod.ImapFlow;
} catch {
  ImapFlow = null;
}

export function isImapAvailable() {
  return !!ImapFlow;
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
 * Fetch unread emails from an IMAP account, given explicit credentials.
 * Marks them as read after processing.
 *
 * @param {{ host: string, port?: number, user: string, pass: string }} credentials
 * @param {number} [maxPerPoll] — caps how many full message sources get
 *   downloaded this tick. A large backlog (confirmed live, 2026-08-21: 486
 *   unseen — a single fetch of that size hit a socket timeout twice in a
 *   row) drains naturally over successive polls instead of one huge transfer.
 * @returns {Promise<ParsedEmail[]>}
 */
export async function fetchUnreadEmails({ host, port = 993, user, pass }, maxPerPoll = 20) {
  if (!ImapFlow) {
    throw new Error('imapflow not installed. Run: npm install imapflow');
  }
  if (!host || !user || !pass) {
    throw new Error('Missing IMAP host, username, or password');
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

      const batchUids = (uids || []).slice(0, maxPerPoll);

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
