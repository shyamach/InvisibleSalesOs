/**
 * lib/invoicePdf.js — Branded PDF invoice generator.
 *
 * Uses pdf-lib (pure JS, no binary deps) to create a professional
 * invoice PDF that can be emailed or downloaded.
 *
 * Called by:
 *   - controllers/invoices.js → generateInvoicePdf(invoice)
 *   - Quote → Invoice conversion endpoint
 */

import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';

// Colour palette — matches the Invisible Sales OS brand
const BRAND = {
  primary:  rgb(0.08, 0.08, 0.08),  // near-black text
  accent:   rgb(0.18, 0.18, 0.98),  // indigo for headings/lines
  muted:    rgb(0.45, 0.45, 0.45),  // grey labels
  light:    rgb(0.94, 0.94, 0.97),  // table header background
  white:    rgb(1, 1, 1),
};

const MM = 2.8346; // 1mm in PDF points (72pt/inch)
const PAGE_W = 210 * MM;  // A4 width
const PAGE_H = 297 * MM;  // A4 height
const MARGIN = 20 * MM;

/**
 * Generate a PDF invoice.
 *
 * @param {Object} invoice — DB row from invoices table
 * @param {Object} [brandDna] — optional brand_dna row for company name/logo
 * @returns {Promise<Buffer>} — raw PDF bytes
 */
export async function generateInvoicePdf(invoice, brandDna = null) {
  const pdfDoc = await PDFDocument.create();
  const page   = pdfDoc.addPage([PAGE_W, PAGE_H]);
  const { width, height } = page.getSize();

  const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold    = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  let y = height - MARGIN;

  // ── Helper drawers ─────────────────────────────────────────────────────────

  const text = (str, x, yPos, { font = fontRegular, size = 10, color = BRAND.primary } = {}) => {
    page.drawText(String(str ?? ''), { x, y: yPos, font, size, color });
  };

  const line = (x1, y1, x2, y2, { color = BRAND.accent, thickness = 0.5 } = {}) => {
    page.drawLine({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, color, thickness });
  };

  const rect = (x, yPos, w, h, { color = BRAND.light } = {}) => {
    page.drawRectangle({ x, y: yPos, width: w, height: h, color });
  };

  // ── Header ─────────────────────────────────────────────────────────────────

  // Company name (top-left)
  const companyName = brandDna?.brand_name || 'Invisible Sales OS';
  text(companyName, MARGIN, y, { font: fontBold, size: 18, color: BRAND.accent });

  // "INVOICE" label (top-right)
  const invLabel = 'INVOICE';
  const labelW   = fontBold.widthOfTextAtSize(invLabel, 22);
  text(invLabel, width - MARGIN - labelW, y, { font: fontBold, size: 22, color: BRAND.primary });

  y -= 7 * MM;

  // Invoice number + dates (right column)
  const rightColX = width - MARGIN - 70 * MM;
  const fieldPairs = [
    ['Invoice #',  invoice.invoice_number],
    ['Issue Date', formatDate(invoice.issue_date)],
    ['Due Date',   invoice.due_date ? formatDate(invoice.due_date) : 'On Receipt'],
    ['Status',     invoice.status?.toUpperCase() || 'DRAFT'],
  ];

  let metaY = y;
  for (const [label, value] of fieldPairs) {
    text(label + ':', rightColX, metaY, { color: BRAND.muted, size: 9 });
    text(value,       rightColX + 25 * MM, metaY, { font: fontBold, size: 9 });
    metaY -= 5 * MM;
  }

  // Company address / details (left column)
  if (brandDna?.tagline) {
    text(brandDna.tagline, MARGIN, y, { color: BRAND.muted, size: 9 });
  }

  y -= 20 * MM;
  line(MARGIN, y, width - MARGIN, y);

  // ── Bill To ────────────────────────────────────────────────────────────────

  y -= 8 * MM;
  text('BILL TO', MARGIN, y, { font: fontBold, size: 8, color: BRAND.muted });

  y -= 5 * MM;
  const billName = invoice.customer_name || invoice.customer_company || 'Customer';
  text(billName, MARGIN, y, { font: fontBold, size: 11 });

  if (invoice.customer_company && invoice.customer_name) {
    y -= 5 * MM;
    text(invoice.customer_company, MARGIN, y, { color: BRAND.muted, size: 9 });
  }

  if (invoice.customer_email) {
    y -= 5 * MM;
    text(invoice.customer_email, MARGIN, y, { color: BRAND.muted, size: 9 });
  }

  if (invoice.customer_phone) {
    y -= 5 * MM;
    text(invoice.customer_phone, MARGIN, y, { color: BRAND.muted, size: 9 });
  }

  y -= 12 * MM;
  line(MARGIN, y, width - MARGIN, y);

  // ── Line Items Table ───────────────────────────────────────────────────────

  y -= 8 * MM;

  const COL = {
    desc:  MARGIN,
    qty:   width - MARGIN - 85 * MM,
    price: width - MARGIN - 60 * MM,
    total: width - MARGIN - 30 * MM,
  };

  // Table header
  rect(MARGIN, y - 1 * MM, width - 2 * MARGIN, 7 * MM);
  text('Description', COL.desc + 2 * MM, y + 1.5 * MM, { font: fontBold, size: 9 });
  text('Qty',         COL.qty,            y + 1.5 * MM, { font: fontBold, size: 9 });
  text('Unit Price',  COL.price,          y + 1.5 * MM, { font: fontBold, size: 9 });
  text('Total',       COL.total,          y + 1.5 * MM, { font: fontBold, size: 9 });

  y -= 8 * MM;

  // Line items
  const lineItems = Array.isArray(invoice.line_items) ? invoice.line_items : [];

  for (const [i, item] of lineItems.entries()) {
    const rowY = y;
    const isEven = i % 2 === 0;

    if (isEven) {
      rect(MARGIN, rowY - 1.5 * MM, width - 2 * MARGIN, 6.5 * MM, { color: rgb(0.97, 0.97, 0.99) });
    }

    const desc      = item.description || item.name || '';
    const qty       = Number(item.qty ?? item.quantity ?? 1);
    const unitPrice = Number(item.unit_price ?? item.price ?? 0);
    const total     = Number(item.total ?? (qty * unitPrice));

    // Wrap long descriptions
    const maxDescW = (COL.qty - COL.desc - 4 * MM);
    const descLines = wrapText(desc, fontRegular, 9, maxDescW);

    text(descLines[0] || '', COL.desc + 2 * MM, rowY, { size: 9 });
    if (descLines[1]) {
      text(descLines[1], COL.desc + 2 * MM, rowY - 4.5 * MM, { size: 8, color: BRAND.muted });
    }

    text(String(qty),             COL.qty,   rowY, { size: 9 });
    text(formatMoney(unitPrice, invoice.currency), COL.price, rowY, { size: 9 });
    text(formatMoney(total,     invoice.currency), COL.total, rowY, { font: fontBold, size: 9 });

    y -= descLines.length > 1 ? 10 * MM : 6.5 * MM;
  }

  if (lineItems.length === 0) {
    text('No line items', COL.desc + 2 * MM, y, { color: BRAND.muted, size: 9 });
    y -= 6.5 * MM;
  }

  y -= 4 * MM;
  line(MARGIN, y, width - MARGIN, y, { thickness: 0.3 });

  // ── Totals ─────────────────────────────────────────────────────────────────

  y -= 8 * MM;
  const totalsX = width - MARGIN - 60 * MM;

  const drawTotal = (label, value, isBold = false) => {
    text(label, totalsX, y, { color: BRAND.muted, size: 9, font: isBold ? fontBold : fontRegular });
    const valStr = formatMoney(value, invoice.currency);
    const valW   = (isBold ? fontBold : fontRegular).widthOfTextAtSize(valStr, 9);
    text(valStr, width - MARGIN - valW, y, { font: isBold ? fontBold : fontRegular, size: 9 });
    y -= 5.5 * MM;
  };

  drawTotal('Subtotal',    invoice.subtotal   ?? 0);
  if (Number(invoice.tax_rate) > 0) {
    drawTotal(`Tax (${invoice.tax_rate}%)`, invoice.tax_amount ?? 0);
  }

  y -= 1 * MM;
  line(totalsX, y, width - MARGIN, y, { color: BRAND.accent });
  y -= 5 * MM;
  drawTotal('TOTAL DUE', invoice.total_amount ?? 0, true);

  // ── Payment Terms + Notes ──────────────────────────────────────────────────

  y -= 12 * MM;
  line(MARGIN, y, width - MARGIN, y, { thickness: 0.3, color: BRAND.muted });
  y -= 7 * MM;

  if (invoice.payment_terms) {
    text('Payment Terms:', MARGIN, y, { font: fontBold, size: 9 });
    text(invoice.payment_terms, MARGIN + 30 * MM, y, { size: 9, color: BRAND.muted });
    y -= 6 * MM;
  }

  if (invoice.notes) {
    text('Notes:', MARGIN, y, { font: fontBold, size: 9 });
    y -= 5 * MM;
    const noteLines = wrapText(invoice.notes, fontRegular, 9, width - 2 * MARGIN);
    for (const noteLine of noteLines.slice(0, 4)) {
      text(noteLine, MARGIN, y, { size: 9, color: BRAND.muted });
      y -= 5 * MM;
    }
  }

  // ── Footer ─────────────────────────────────────────────────────────────────

  const footerY = MARGIN + 5 * MM;
  line(MARGIN, footerY + 5 * MM, width - MARGIN, footerY + 5 * MM, { thickness: 0.3, color: BRAND.muted });
  const footerText = 'Generated by Invisible Sales OS  ·  Thank you for your business';
  const footerW    = fontRegular.widthOfTextAtSize(footerText, 8);
  text(footerText, (width - footerW) / 2, footerY, { size: 8, color: BRAND.muted });

  // ── Serialize ──────────────────────────────────────────────────────────────

  const pdfBytes = await pdfDoc.save();
  return Buffer.from(pdfBytes);
}

// ── Utilities ────────────────────────────────────────────────────────────────

function formatDate(d) {
  if (!d) return '';
  const dt = new Date(d);
  return dt.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function formatMoney(amount, currency = 'GBP') {
  const symbols = { GBP: '£', USD: '$', EUR: '€', AED: 'AED ', PKR: '₨', INR: '₹' };
  const sym = symbols[currency] || currency + ' ';
  return sym + Number(amount ?? 0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function wrapText(str, font, size, maxWidth) {
  const words = String(str ?? '').split(' ');
  const lines = [];
  let current = '';

  for (const word of words) {
    const test = current ? current + ' ' + word : word;
    if (font.widthOfTextAtSize(test, size) <= maxWidth) {
      current = test;
    } else {
      if (current) lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines.length > 0 ? lines : [''];
}
