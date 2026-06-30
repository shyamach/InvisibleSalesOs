/**
 * lib/invoiceParser.js — AI-powered inbound invoice parser.
 *
 * Takes raw PDF bytes (or plain text) and uses Claude Haiku to extract:
 *   - vendor name / email
 *   - invoice number
 *   - issue date / due date
 *   - line items [{description, qty, unit_price, total}]
 *   - subtotal, tax, total amount
 *   - currency
 *
 * Used by:
 *   - Email IMAP listener (PDF attachments)
 *   - WhatsApp PDF detection (document messages)
 *   - Manual upload endpoint (POST /api/invoices/upload)
 */

import Anthropic from '@anthropic-ai/sdk';

let pdfParse;
try {
  const mod = await import('pdf-parse/lib/pdf-parse.js');
  pdfParse = mod.default;
} catch {
  try {
    const mod2 = await import('pdf-parse');
    pdfParse = mod2.default;
  } catch {
    pdfParse = null;
  }
}

const ai = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const EXTRACTION_PROMPT = `You are an invoice data extractor. Extract structured data from the following invoice text.

Return ONLY valid JSON with this exact shape (use null for missing fields):
{
  "vendor_name": "string or null",
  "vendor_email": "string or null",
  "vendor_company": "string or null",
  "invoice_number": "string or null",
  "issue_date": "YYYY-MM-DD or null",
  "due_date": "YYYY-MM-DD or null",
  "currency": "GBP|USD|EUR|AED|PKR|INR or null",
  "line_items": [
    {"description": "string", "qty": number, "unit_price": number, "total": number}
  ],
  "subtotal": number or null,
  "tax_rate": number or null,
  "tax_amount": number or null,
  "total_amount": number or null,
  "payment_terms": "string or null",
  "notes": "string or null",
  "confidence": "HIGH|MEDIUM|LOW"
}

Invoice text:
`;

/**
 * Extract structured data from a PDF buffer.
 *
 * @param {Buffer} pdfBuffer
 * @returns {Promise<{success: boolean, data?: Object, error?: string}>}
 */
export async function parseInvoicePdf(pdfBuffer) {
  if (!pdfParse) {
    console.warn('⚠️ [InvoiceParser]: pdf-parse not available — falling back to empty extraction.');
    return { success: false, error: 'pdf-parse not installed' };
  }

  try {
    const parsed = await pdfParse(pdfBuffer);
    const text   = parsed.text?.slice(0, 6000) || ''; // cap at 6k chars for Haiku

    if (!text.trim()) {
      return { success: false, error: 'PDF has no extractable text (may be image-only scan)' };
    }

    return await extractFromText(text);
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * Extract structured data from plain text (e.g. email body with invoice details).
 *
 * @param {string} text
 * @returns {Promise<{success: boolean, data?: Object, error?: string}>}
 */
export async function extractFromText(text) {
  try {
    const response = await ai.messages.create({
      model:      'claude-haiku-4-5',
      max_tokens: 800,
      messages: [{
        role:    'user',
        content: EXTRACTION_PROMPT + text.slice(0, 5000),
      }],
    });

    const raw = response.content[0]?.text?.trim() || '';

    // Strip markdown code fences if present
    const jsonStr = raw.replace(/^```json?\n?/i, '').replace(/```$/m, '').trim();
    const data    = JSON.parse(jsonStr);

    return { success: true, data };
  } catch (err) {
    return { success: false, error: `AI extraction failed: ${err.message}` };
  }
}

/**
 * Determine if an email likely contains an invoice (used by email listener).
 *
 * @param {Object} email — {subject, body, from}
 * @returns {boolean}
 */
export function isLikelyInvoice(email) {
  const invoiceKeywords = [
    'invoice', 'bill', 'receipt', 'statement', 'payment due',
    'amount due', 'purchase order', 'pro forma', 'proforma',
    'فاتورة', 'بل', 'رسيد',  // Arabic
    'चालान', 'बिल',           // Hindi
    'انوائس', 'بل',           // Urdu
  ];

  const haystack = `${email.subject} ${email.body?.slice(0, 500) || ''}`.toLowerCase();
  return invoiceKeywords.some(kw => haystack.includes(kw.toLowerCase()));
}

/**
 * Check if a WhatsApp message is an invoice document.
 *
 * @param {Object} msg — whatsapp-web.js message object
 * @returns {boolean}
 */
export function isWhatsAppInvoice(msg) {
  if (!msg.hasMedia) return false;
  if (!['document', 'image'].includes(msg.type)) return false;

  const filename = (msg.filename || '').toLowerCase();
  const caption  = (msg.caption || msg.body || '').toLowerCase();

  // PDF or image with invoice-like name/caption
  const isInvoiceFile = filename.endsWith('.pdf') ||
    filename.includes('invoice') ||
    filename.includes('bill') ||
    filename.includes('receipt');

  const hasInvoiceCaption = ['invoice', 'bill', 'receipt', 'فاتورة', 'چالان', 'बिल', 'انوائس']
    .some(kw => caption.includes(kw));

  return isInvoiceFile || hasInvoiceCaption;
}
