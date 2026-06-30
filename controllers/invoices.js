/**
 * controllers/invoices.js — Invoice CRUD + PDF generation + upload handling.
 *
 * Routes (all behind requireInternalKey):
 *   GET    /api/invoices              → list (direction, status filters)
 *   GET    /api/invoices/:id          → single invoice
 *   POST   /api/invoices              → create invoice manually
 *   POST   /api/invoices/from-quote/:quoteId → convert quote → invoice
 *   PATCH  /api/invoices/:id          → update (status, notes, paid_date, etc.)
 *   DELETE /api/invoices/:id          → soft-cancel (status='cancelled')
 *   GET    /api/invoices/:id/pdf      → stream generated PDF
 *   POST   /api/invoices/upload       → manual PDF upload + AI parse
 */

import { generateInvoicePdf } from '../lib/invoicePdf.js';
import { parseInvoicePdf, extractFromText } from '../lib/invoiceParser.js';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

const TENANT_ID = process.env.DEFAULT_TENANT_ID || '00000000-0000-0000-0000-000000000001';

// ── Generate next invoice number ────────────────────────────────────────────

async function nextInvoiceNumber(tenantId) {
  // Count existing invoices for this tenant to generate sequential number
  const { count } = await supabase
    .from('invoices')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenantId);

  const seq = (count || 0) + 1;
  return `INV-${String(seq).padStart(4, '0')}`;
}

// ── List ────────────────────────────────────────────────────────────────────

export async function listInvoices(req, res) {
  const tenantId  = req.query.tenant_id || TENANT_ID;
  const direction = req.query.direction; // 'inbound' | 'outbound'
  const status    = req.query.status;

  let query = supabase
    .from('invoices')
    .select('*')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false })
    .limit(100);

  if (direction) query = query.eq('direction', direction);
  if (status)    query = query.eq('status', status);

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });

  res.json({ invoices: data });
}

// ── Get single ──────────────────────────────────────────────────────────────

export async function getInvoice(req, res) {
  const { id } = req.params;

  const { data, error } = await supabase
    .from('invoices')
    .select('*')
    .eq('id', id)
    .single();

  if (error) return res.status(404).json({ error: 'Invoice not found' });
  res.json({ invoice: data });
}

// ── Create manually ─────────────────────────────────────────────────────────

export async function createInvoice(req, res) {
  const tenantId = req.body.tenant_id || TENANT_ID;

  const invoiceNumber = await nextInvoiceNumber(tenantId);

  const lineItems = req.body.line_items || [];
  const taxRate   = Number(req.body.tax_rate || 0);
  const subtotal  = lineItems.reduce((sum, item) => sum + Number(item.total || 0), 0);
  const taxAmount = (subtotal * taxRate) / 100;
  const total     = subtotal + taxAmount;

  const payload = {
    tenant_id:        tenantId,
    quote_id:         req.body.quote_id         || null,
    lead_id:          req.body.lead_id           || null,
    invoice_number:   invoiceNumber,
    direction:        req.body.direction         || 'outbound',
    status:           req.body.status            || 'draft',
    customer_name:    req.body.customer_name     || null,
    customer_email:   req.body.customer_email    || null,
    customer_company: req.body.customer_company  || null,
    customer_phone:   req.body.customer_phone    || null,
    line_items:       lineItems,
    subtotal,
    tax_rate:         taxRate,
    tax_amount:       taxAmount,
    total_amount:     total,
    currency:         req.body.currency          || 'GBP',
    issue_date:       req.body.issue_date        || new Date().toISOString().split('T')[0],
    due_date:         req.body.due_date          || null,
    payment_terms:    req.body.payment_terms     || 'Net 30',
    notes:            req.body.notes             || null,
    source_channel:   req.body.source_channel    || 'manual',
  };

  const { data, error } = await supabase
    .from('invoices')
    .insert(payload)
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });

  res.status(201).json({ invoice: data, invoice_number: invoiceNumber });
}

// ── Convert quote → invoice ─────────────────────────────────────────────────

export async function convertQuoteToInvoice(req, res) {
  const { quoteId } = req.params;
  const tenantId    = req.body.tenant_id || TENANT_ID;

  // Fetch the quote
  const { data: quote, error: qErr } = await supabase
    .from('quotes')
    .select('*')
    .eq('id', quoteId)
    .single();

  if (qErr || !quote) return res.status(404).json({ error: 'Quote not found' });

  // Check not already converted
  const { data: existing } = await supabase
    .from('invoices')
    .select('id, invoice_number')
    .eq('quote_id', quoteId)
    .single();

  if (existing) {
    return res.status(409).json({
      error: `Already converted to invoice ${existing.invoice_number}`,
      invoice_id: existing.id,
    });
  }

  const invoiceNumber = await nextInvoiceNumber(tenantId);

  // Map quote line items to invoice line items
  const lineItems = (quote.line_items || []).map(item => ({
    description: item.name || item.description || 'Item',
    qty:         Number(item.quantity || item.qty || 1),
    unit_price:  Number(item.unit_price || item.price || 0),
    total:       Number(item.total || (item.quantity * item.unit_price) || 0),
  }));

  const subtotal  = lineItems.reduce((s, i) => s + i.total, 0);
  const taxRate   = Number(quote.tax_rate || req.body.tax_rate || 0);
  const taxAmount = (subtotal * taxRate) / 100;

  const payload = {
    tenant_id:        tenantId,
    quote_id:         quoteId,
    lead_id:          quote.lead_id || null,
    invoice_number:   invoiceNumber,
    direction:        'outbound',
    status:           'draft',
    customer_name:    quote.customer_name || req.body.customer_name || null,
    customer_email:   quote.customer_email || req.body.customer_email || null,
    customer_company: quote.customer_company || req.body.customer_company || null,
    line_items:       lineItems,
    subtotal,
    tax_rate:         taxRate,
    tax_amount:       taxAmount,
    total_amount:     subtotal + taxAmount,
    currency:         quote.currency || 'GBP',
    issue_date:       new Date().toISOString().split('T')[0],
    due_date:         req.body.due_date || null,
    payment_terms:    req.body.payment_terms || 'Net 30',
    notes:            req.body.notes || quote.notes || null,
    source_channel:   'quote',
  };

  const { data: invoice, error } = await supabase
    .from('invoices')
    .insert(payload)
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });

  // Log on the lead if there is one
  if (invoice.lead_id) {
    await supabase.from('lead_activities').insert({
      tenant_id: tenantId,
      lead_id:   invoice.lead_id,
      type:      'invoice_created',
      channel:   'system',
      direction: 'outbound',
      content:   `Invoice ${invoiceNumber} created from quote`,
      metadata:  { invoice_id: invoice.id, invoice_number: invoiceNumber },
    });
  }

  res.status(201).json({ invoice, invoice_number: invoiceNumber });
}

// ── Update ──────────────────────────────────────────────────────────────────

export async function updateInvoice(req, res) {
  const { id } = req.params;

  const allowed = [
    'status', 'paid_date', 'due_date', 'payment_terms',
    'notes', 'customer_name', 'customer_email', 'customer_phone',
    'customer_company', 'amount_paid',
  ];

  const updates = {};
  for (const key of allowed) {
    if (req.body[key] !== undefined) updates[key] = req.body[key];
  }

  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ error: 'No valid fields to update' });
  }

  // Auto-set paid_date when status flips to paid
  if (updates.status === 'paid' && !updates.paid_date) {
    updates.paid_date = new Date().toISOString().split('T')[0];
  }

  const { data, error } = await supabase
    .from('invoices')
    .update(updates)
    .eq('id', id)
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.json({ invoice: data });
}

// ── Cancel ──────────────────────────────────────────────────────────────────

export async function cancelInvoice(req, res) {
  const { id } = req.params;

  const { data, error } = await supabase
    .from('invoices')
    .update({ status: 'cancelled' })
    .eq('id', id)
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.json({ invoice: data });
}

// ── Generate + stream PDF ───────────────────────────────────────────────────

export async function downloadInvoicePdf(req, res) {
  const { id } = req.params;

  const { data: invoice, error } = await supabase
    .from('invoices')
    .select('*')
    .eq('id', id)
    .single();

  if (error || !invoice) return res.status(404).json({ error: 'Invoice not found' });

  // Fetch brand DNA for company name
  const { data: brandDna } = await supabase
    .from('brand_dna')
    .select('company_name, tagline')
    .eq('tenant_id', invoice.tenant_id)
    .single();

  try {
    const pdfBytes = await generateInvoicePdf(invoice, brandDna);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${invoice.invoice_number}.pdf"`);
    res.setHeader('Content-Length', pdfBytes.length);
    res.end(pdfBytes);
  } catch (err) {
    res.status(500).json({ error: `PDF generation failed: ${err.message}` });
  }
}

// ── Manual upload + AI parse ────────────────────────────────────────────────

export async function uploadInvoice(req, res) {
  const tenantId = req.body.tenant_id || TENANT_ID;

  if (!req.file) {
    return res.status(400).json({ error: 'No file provided. Use multipart/form-data with field name "invoice".' });
  }

  const fileBuffer = req.file.buffer;
  const fileName   = req.file.originalname || 'invoice.pdf';
  const mimeType   = req.file.mimetype || 'application/pdf';

  console.log(`📤 [Invoice Upload]: ${fileName} (${(fileBuffer.length / 1024).toFixed(0)} KB)`);

  // Upload to Supabase storage
  const storagePath = `${tenantId}/${Date.now()}-${fileName}`;
  const { data: storageData, error: storageErr } = await supabase.storage
    .from('invoices')
    .upload(storagePath, fileBuffer, { contentType: mimeType, upsert: false });

  if (storageErr) {
    console.error('Storage upload error:', storageErr.message);
  }

  const fileUrl = storageData
    ? supabase.storage.from('invoices').getPublicUrl(storagePath).data.publicUrl
    : null;

  // AI parse
  let aiExtracted = null;
  let parseResult = null;

  if (mimeType === 'application/pdf') {
    parseResult = await parseInvoicePdf(fileBuffer);
  } else {
    // Image — skip text extraction for now (TODO: OCR)
    parseResult = { success: false, error: 'Image OCR not yet supported — AI parsing skipped' };
  }

  if (parseResult.success) {
    aiExtracted = parseResult.data;
    console.log(`🤖 [Invoice Parse]: Extracted ${aiExtracted.vendor_name || 'unknown vendor'} | Total: ${aiExtracted.total_amount}`);
  }

  const invoiceNumber = await nextInvoiceNumber(tenantId);

  const lineItems = aiExtracted?.line_items || [];
  const subtotal  = aiExtracted?.subtotal || lineItems.reduce((s, i) => s + Number(i.total || 0), 0);
  const taxRate   = Number(aiExtracted?.tax_rate || 0);
  const taxAmount = Number(aiExtracted?.tax_amount || (subtotal * taxRate / 100));
  const total     = Number(aiExtracted?.total_amount || subtotal + taxAmount);

  const { data: invoice, error } = await supabase
    .from('invoices')
    .insert({
      tenant_id:      tenantId,
      invoice_number: aiExtracted?.invoice_number || invoiceNumber,
      direction:      'inbound',
      status:         'draft',
      vendor_name:    aiExtracted?.vendor_name    || null,
      vendor_email:   aiExtracted?.vendor_email   || null,
      vendor_company: aiExtracted?.vendor_company || null,
      line_items:     lineItems,
      subtotal,
      tax_rate:       taxRate,
      tax_amount:     taxAmount,
      total_amount:   total,
      currency:       aiExtracted?.currency       || 'GBP',
      issue_date:     aiExtracted?.issue_date     || new Date().toISOString().split('T')[0],
      due_date:       aiExtracted?.due_date       || null,
      payment_terms:  aiExtracted?.payment_terms  || null,
      notes:          aiExtracted?.notes          || null,
      source_channel: 'manual',
      file_path:      storagePath || null,
      file_url:       fileUrl     || null,
      ai_extracted:   aiExtracted || null,
    })
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });

  res.status(201).json({
    invoice,
    ai_extracted:  aiExtracted,
    parse_success: parseResult.success,
    file_url:      fileUrl,
  });
}

// ── Save inbound invoice from pipeline (email / WhatsApp) ──────────────────

export async function saveInboundInvoice(supabaseClient, {
  tenantId,
  sourceChannel,
  fromEmail,
  fromName,
  fileBuffer,
  fileName,
  mimeType,
  leadId = null,
}) {
  const invoiceNumber = await nextInvoiceNumber(tenantId);

  // Upload file
  let fileUrl = null;
  let storagePath = null;
  if (fileBuffer) {
    storagePath = `${tenantId}/${Date.now()}-${fileName || 'invoice.pdf'}`;
    const { data: sd } = await supabaseClient.storage
      .from('invoices')
      .upload(storagePath, fileBuffer, { contentType: mimeType || 'application/pdf', upsert: false });

    if (sd) {
      fileUrl = supabaseClient.storage.from('invoices').getPublicUrl(storagePath).data.publicUrl;
    }
  }

  // AI parse
  let aiExtracted = null;
  if (fileBuffer && mimeType === 'application/pdf') {
    const result = await parseInvoicePdf(fileBuffer);
    if (result.success) aiExtracted = result.data;
  }

  const subtotal  = Number(aiExtracted?.subtotal || 0);
  const taxAmount = Number(aiExtracted?.tax_amount || 0);
  const total     = Number(aiExtracted?.total_amount || subtotal + taxAmount);

  const { data: invoice, error } = await supabaseClient
    .from('invoices')
    .insert({
      tenant_id:      tenantId,
      lead_id:        leadId,
      invoice_number: aiExtracted?.invoice_number || invoiceNumber,
      direction:      'inbound',
      status:         'draft',
      vendor_name:    aiExtracted?.vendor_name || fromName || null,
      vendor_email:   aiExtracted?.vendor_email || fromEmail || null,
      vendor_company: aiExtracted?.vendor_company || null,
      line_items:     aiExtracted?.line_items || [],
      subtotal,
      tax_rate:       Number(aiExtracted?.tax_rate || 0),
      tax_amount:     taxAmount,
      total_amount:   total,
      currency:       aiExtracted?.currency || 'GBP',
      issue_date:     aiExtracted?.issue_date || new Date().toISOString().split('T')[0],
      due_date:       aiExtracted?.due_date || null,
      source_channel: sourceChannel,
      file_path:      storagePath,
      file_url:       fileUrl,
      ai_extracted:   aiExtracted,
    })
    .select()
    .single();

  if (error) {
    console.error(`💥 [Invoice Save]: ${error.message}`);
    return null;
  }

  console.log(`🧾 [Invoice SAVED]: ${invoice.invoice_number} | ${sourceChannel} | Total: ${total}`);
  return invoice;
}
