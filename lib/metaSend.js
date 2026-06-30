/**
 * lib/metaSend.js — Meta Cloud API WhatsApp message sender.
 *
 * Replaces whatsapp-web.js client.sendMessage() for production.
 * Used by the dispatch endpoint in server.js.
 *
 * Requires in .env.local:
 *   WHATSAPP_PHONE_ID     — the Phone Number ID from Meta dashboard
 *   WHATSAPP_ACCESS_TOKEN — System User permanent token (never temporary)
 *
 * Docs: https://developers.facebook.com/docs/whatsapp/cloud-api/guides/send-messages
 */

const GRAPH_API_VERSION = 'v20.0';
const GRAPH_API_URL = `https://graph.facebook.com/${GRAPH_API_VERSION}`;

/**
 * Normalize a phone number for Meta Cloud API.
 * Strips +, spaces, dashes, parens. Leaves digits and leading country code.
 * Examples: "+44 7767 902011" → "447767902011"
 *           "447767902011@c.us" → "447767902011"
 * Returns null for @lid addresses (device IDs — Meta can't use them).
 *
 * @param {string} rawPhone
 * @returns {string|null}
 */
export function normalizePhoneForMeta(rawPhone) {
  const str = String(rawPhone || '');

  // @lid = WhatsApp privacy-layer device ID — not a phone number
  if (str.includes('@lid')) return null;

  // Strip @c.us suffix (whatsapp-web.js format)
  const stripped = str.replace(/@[a-z.]+$/, '');

  // Strip all non-digit characters
  const digits = stripped.replace(/\D/g, '');

  // Sanity check: international phone numbers are 7–15 digits
  if (digits.length < 7 || digits.length > 15) return null;

  return digits;
}

/**
 * Send a plain text WhatsApp message via Meta Cloud API.
 *
 * @param {string} to   — recipient phone (any format — will be normalised)
 * @param {string} text — message body
 * @returns {Promise<{ success: boolean, messageId?: string, error?: string }>}
 */
export async function sendWhatsAppMessage(to, text) {
  const phoneNumberId = process.env.WHATSAPP_PHONE_ID;
  const accessToken   = process.env.WHATSAPP_ACCESS_TOKEN;

  if (!phoneNumberId || !accessToken) {
    return {
      success: false,
      error: 'Missing WHATSAPP_PHONE_ID or WHATSAPP_ACCESS_TOKEN in environment',
    };
  }

  const normalizedTo = normalizePhoneForMeta(to);
  if (!normalizedTo) {
    return {
      success: false,
      error: `Cannot resolve phone for Meta API: "${to}" is a device ID (@lid) — use whatsapp-web.js fallback.`,
    };
  }

  try {
    const response = await fetch(`${GRAPH_API_URL}/${phoneNumberId}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: normalizedTo,
        type: 'text',
        text: { body: text, preview_url: false },
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      const errMsg = data?.error?.message || `HTTP ${response.status}`;
      console.error(`❌ [Meta Send]: API error — ${errMsg}`);
      return { success: false, error: errMsg };
    }

    const messageId = data?.messages?.[0]?.id;
    console.log(`✅ [Meta Send]: Delivered. Message ID: ${messageId}`);
    return { success: true, messageId };

  } catch (err) {
    console.error(`💥 [Meta Send]: Network error — ${err.message}`);
    return { success: false, error: err.message };
  }
}
