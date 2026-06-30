/**
 * lib/emailSend.js — Send email replies via Resend REST API.
 *
 * Uses native fetch (no SDK dependency).
 * Requires in .env.local:
 *   RESEND_API_KEY      — API key from Resend dashboard
 *   RESEND_FROM_EMAIL   — Verified sender address (e.g. sales@yourdomain.com)
 */

const RESEND_API_URL = 'https://api.resend.com/emails';

/**
 * Send an email reply via Resend.
 *
 * @param {Object} opts
 * @param {string} opts.to              — recipient email address
 * @param {string} opts.subject         — email subject line
 * @param {string} [opts.text]          — plain text body (optional if html is provided)
 * @param {string} [opts.html]          — HTML body (optional; takes precedence over text for rich emails)
 * @returns {Promise<{ success: boolean, id?: string, error?: string }>}
 */
export async function sendEmailReply({ to, subject, text, html }) {
  const apiKey = process.env.RESEND_API_KEY;
  const fromEmail = process.env.RESEND_FROM_EMAIL;

  if (!apiKey) {
    const errMsg = 'Missing RESEND_API_KEY in environment';
    console.error(`❌ [Email]: ${errMsg}`);
    return { success: false, error: errMsg };
  }

  if (!fromEmail) {
    const errMsg = 'Missing RESEND_FROM_EMAIL in environment';
    console.error(`❌ [Email]: ${errMsg}`);
    return { success: false, error: errMsg };
  }

  if (!to) {
    const errMsg = 'Missing recipient email address';
    console.error(`❌ [Email]: ${errMsg}`);
    return { success: false, error: errMsg };
  }

  try {
    const response = await fetch(RESEND_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: fromEmail,
        to,
        subject,
        ...(html ? { html, text: text || '' } : { text }),
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      const errMsg = data?.message || data?.error || `HTTP ${response.status}`;
      console.error(`❌ [Email]: Failed — ${errMsg}`);
      return { success: false, error: errMsg };
    }

    const id = data?.id;
    console.log(`✅ [Email]: Sent to ${to}`);
    return { success: true, id };

  } catch (err) {
    console.error(`❌ [Email]: Failed — ${err.message}`);
    return { success: false, error: err.message };
  }
}
