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

let ImapFlow;
try {
  // Dynamic import so the server doesn't crash if imapflow isn't installed yet
  const mod = await import('imapflow');
  ImapFlow = mod.ImapFlow;
} catch {
  ImapFlow = null;
}

const POLL_INTERVAL_MS = 60_000; // 60 seconds

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
      // Fetch all unseen messages
      const messages = await client.fetch('1:*', {
        source: true,
        envelope: true,
        flags: true,
      });

      for await (const msg of messages) {
        // Skip already-read messages
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
 * Start the email polling loop.
 *
 * @param {Function} onEmail — async (email: ParsedEmail) => void
 *   Called once per unread email. Should feed into the lead pipeline.
 */
export function startEmailListener(onEmail) {
  if (process.env.EMAIL_IMAP_ENABLED !== 'true') {
    console.log('📧 [Email]: IMAP listener disabled (EMAIL_IMAP_ENABLED != true).');
    return;
  }

  if (!ImapFlow) {
    console.error('📧 [Email]: imapflow not installed. Run: npm install imapflow');
    return;
  }

  console.log(`📧 [Email]: IMAP listener starting — polling ${process.env.EMAIL_IMAP_HOST} every ${POLL_INTERVAL_MS / 1000}s`);

  const poll = async () => {
    try {
      const emails = await fetchUnreadEmails();

      if (emails.length > 0) {
        console.log(`📨 [Email]: ${emails.length} new email(s) — routing to pipeline...`);
        for (const email of emails) {
          await onEmail(email).catch((err) =>
            console.error('📧 [Email]: Pipeline error for email:', err.message)
          );
        }
      }
    } catch (err) {
      // Non-fatal — log and wait for next poll
      console.error('📧 [Email]: Poll error —', err.message);
    }
  };

  // Run once immediately, then on interval
  poll();
  setInterval(poll, POLL_INTERVAL_MS);
}
