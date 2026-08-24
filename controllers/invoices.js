/**
 * controllers/invoices.js — Invoice CRUD + PDF generation + upload handling.
 *
 * Routes (all behind requireAuth):
 *   GET    /api/invoices              → list (direction, status filters)
 *   GET    /api/invoices/:id          → single invoice
 *   POST   /api/invoices              → create invoice manually
 *   POST   /api/invoices/from-quote/:quoteId → convert quote → invoice
 *   PATCH  /api/invoices/:id          → update (status, notes, paid_date, etc.)
 *   DELETE /api/invoices/:id          → soft-cancel (status='cancelled')
 *   GET    /api/invoices/:id/pdf      → stream generated PDF
 *   POST   /api/invoices/upload       → manual PDF upload + AI parse
 *
 * Tenant identity comes from req.tenantId (set by requireAuth from the
 * caller's verified JWT) — never from a header/body/query value. Queries run
 * on req.supabase, the per-request client seeded with that JWT, so auth.uid()
 * resolves for RLS; the .eq('tenant_id', req.tenantId) filters below stay as
 * defence-in-depth, not the primary authority.
 *
 * createInvoice/convertQuoteToInvoice/updateInvoice/cancelInvoice/uploadInvoice
 * additionally require req.userRole of 'owner' or 'admin' — listInvoices,
 * getInvoice, and downloadInvoicePdf stay open to any tenant member (read).
 *
 * saveInboundInvoice (used by the Lane B email/WhatsApp attachment pipeline
 * in server.js) is untouched — it already takes its own Supabase client as a
 * parameter and is not reachable from any route this file wires up.
 */

import { generateInvoicePdf } from '../lib/invoicePdf.js';
import { parseInvoicePdf, extractFromText } from '../lib/invoiceParser.js';
import { createAndNotifyEscalation } from '../lib/escalationService.js';

function requireTenant(req, res) {
  if (req.tenantId) return true;
  res.status(403).json({ success: false, error: 'No tenant associated with this account' });
  return false;
}

function requireOwnerOrAdmin(req, res) {
  if (req.userRole === 'owner' || req.userRole === 'admin') return true;
  res.status(403).json({ success: false, error: 'Only owners and admins can manage invoices' });
  return false;
}

// ── Generate next invoice number ────────────────────────────────────────────

async function nextInvoiceNumber(supabaseClient, tenantId) {
  // Count existing invoices for this tenant to generate sequential number
  const { count } = await supabaseClient
    .from('invoices')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenantId);

  const seq = (count || 0) + 1;
  return `INV-${String(seq).padStart(4, '0')}`;
}

// ── Stock deduction on invoice dispatch ─────────────────────────────────────
// Product decision 2026-08-20 (quote/invoice-stock semantics): quotes never
// touch stock; an outbound invoice is the real commitment point. Only line
// items carrying a product_id participate — freeform/custom lines (job-work,
// alterations, one-off items with no catalogue SKU) are left untouched,
// exactly as they behave today; product_id itself is optional on a line item
// (no schema change — line_items is already JSONB). Deduction runs through
// the existing atomic adjust_product_stock() RPC (proven safe under 20-way
// concurrency) with allow_negative:true — a Surat wholesaler routinely
// invoices against goods in transit or held at a second location the system
// doesn't track, and hard-blocking on stock risks pushing the first real
// client to route around the tool entirely. Any line item that pushes a
// product to/below zero triggers a single out_of_stock escalation through
// the same handoff system the AI draft pipeline already uses (only when the
// invoice has a lead_id — createAndNotifyEscalation requires one, matching
// how engine.js already gates its own escalation call).
async function applyInvoiceStockDeductions(supabase, { tenantId, invoiceNumber, lineItems, leadId, createdBy }) {
  const warnings = [];
  let wentToBackorder = false;
  const backorderNames = [];

  for (const item of lineItems) {
    if (!item.product_id) continue;

    const qty = Number(item.qty ?? item.quantity ?? 0);
    if (!qty || qty <= 0) continue;

    const { data, error } = await supabase.rpc('adjust_product_stock', {
      p_tenant_id: tenantId,
      p_product_id: item.product_id,
      p_delta: -qty,
      // Must be one of stock_movements_reason_check's allowed values
      // (manual_adjustment/sale/restock/correction/import/return) — Postgres
      // rejects anything else and adjust_product_stock() does not validate
      // this itself, so a typo here fails silently into stock_warnings
      // rather than a loud error. Previously 'invoice_dispatch', which was
      // never a valid value and made every real deduction fail — caught
      // 2026-08-22 via the first real product_id ever sent from the UI.
      p_reason: 'sale',
      p_note: `Invoice ${invoiceNumber}`,
      p_allow_negative: true,
      p_created_by: createdBy || null,
    });

    if (error) {
      console.warn(`⚠️ [Invoice Stock]: deduction failed for product ${item.product_id} on invoice ${invoiceNumber} —`, error.message);
      warnings.push({ product_id: item.product_id, error: error.message });
      continue;
    }

    const balanceAfter = data?.movement?.balance_after;
    if (typeof balanceAfter === 'number' && balanceAfter <= 0) {
      wentToBackorder = true;
      backorderNames.push(data?.product?.name || item.description || item.product_id);
    }
  }

  if (wentToBackorder && leadId) {
    const { data: tenantRow } = await supabase.from('tenants').select('owner_email').eq('id', tenantId).maybeSingle();
    await createAndNotifyEscalation(supabase, {
      tenantId,
      leadId,
      reason: 'out_of_stock',
      context: `Invoice ${invoiceNumber} took stock below zero: ${backorderNames.join(', ')}`,
      ownerEmail: tenantRow?.owner_email ?? null,
    }).catch((err) => console.warn('⚠️ [Invoice Stock]: escalation failed (non-fatal):', err.message));
  }

  return { warnings, wentToBackorder };
}

// ── List ────────────────────────────────────────────────────────────────────

export async function listInvoices(req, res) {
  if (!requireTenant(req, res)) return;

  const direction = req.query.direction; // 'inbound' | 'outbound'
  const status    = req.query.status;

  let query = req.supabase
    .from('invoices')
    .select('*')
    .eq('tenant_id', req.tenantId)
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
  if (!requireTenant(req, res)) return;

  const { id } = req.params;

  const { data, error } = await req.supabase
    .from('invoices')
    .select('*')
    .eq('id', id)
    .eq('tenant_id', req.tenantId)
    .single();

  if (error) return res.status(404).json({ error: 'Invoice not found' });
  res.json({ invoice: data });
}

// ── Create manually ─────────────────────────────────────────────────────────

export async function createInvoice(req, res) {
  if (!requireTenant(req, res)) return;
  if (!requireOwnerOrAdmin(req, res)) return;

  const tenantId = req.tenantId;

  const invoiceNumber = await nextInvoiceNumber(req.supabase, tenantId);

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

  const { data, error } = await req.supabase
    .from('invoices')
    .insert(payload)
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });

  let stockResult = { warnings: [], wentToBackorder: false };
  if (data.direction === 'outbound') {
    stockResult = await applyInvoiceStockDeductions(req.supabase, {
      tenantId,
      invoiceNumber,
      lineItems,
      leadId: data.lead_id,
      createdBy: req.userId,
    });
  }

  res.status(201).json({
    invoice: data,
    invoice_number: invoiceNumber,
    stock_warnings: stockResult.warnings,
    stock_backorder: stockResult.wentToBackorder,
  });
}

// ── Convert quote → invoice ─────────────────────────────────────────────────

export async function convertQuoteToInvoice(req, res) {
  if (!requireTenant(req, res)) return;
  if (!requireOwnerOrAdmin(req, res)) return;

  const { quoteId } = req.params;
  const tenantId    = req.tenantId;

  // Fetch the quote
  const { data: quote, error: qErr } = await req.supabase
    .from('quotes')
    .select('*')
    .eq('id', quoteId)
    .eq('tenant_id', tenantId)
    .single();

  if (qErr || !quote) return res.status(404).json({ error: 'Quote not found' });

  // Check not already converted
  const { data: existing } = await req.supabase
    .from('invoices')
    .select('id, invoice_number')
    .eq('quote_id', quoteId)
    .eq('tenant_id', tenantId)
    .single();

  if (existing) {
    return res.status(409).json({
      error: `Already converted to invoice ${existing.invoice_number}`,
      invoice_id: existing.id,
    });
  }

  const invoiceNumber = await nextInvoiceNumber(req.supabase, tenantId);

  // Map quote line items to invoice line items. product_id carries through
  // when present (optional — most line items today have none) so the
  // resulting invoice can still trigger stock deduction below.
  //
  // Found live during a pre-launch dry-run (2026-08-23): this previously read
  // item.quantity/item.total, but quotes/new's actual LineItem shape uses
  // item.qty/item.amount (Section 39 already documented "quotes/new uses
  // amount, invoices/new uses total" as two different shapes on the two
  // *frontend* pages — this backend mapper had never been updated to read
  // the quote side's real field names, so every conversion silently produced
  // £0 line totals, a £0 subtotal, and a £0 invoice).
  const lineItems = (quote.line_items || []).map(item => {
    const qty = Number(item.qty ?? item.quantity ?? 1);
    const unitPrice = Number(item.unit_price ?? item.price ?? 0);
    return {
      description: item.name || item.description || 'Item',
      qty,
      unit_price:  unitPrice,
      total:       Number(item.amount ?? item.total ?? (qty * unitPrice) ?? 0),
      product_id:  item.product_id || null,
    };
  });

  const subtotal = lineItems.reduce((s, i) => s + i.total, 0);

  // quotes.tax_rate is stored as a fraction (0.2 = 20%, matching its own
  // GENERATED tax_amount column: round(subtotal * tax_rate, 2) — see
  // frontend/src/app/app/quotes/new/page.tsx, which divides by 100 before
  // sending). invoices.tax_rate is stored as a whole percentage (20 = 20%,
  // per createInvoice's own (subtotal * taxRate) / 100 above). Also found
  // live during the same dry-run: this line used quote.tax_rate directly as
  // if the two tables shared a convention, then divided by 100 again below
  // — a second silent zeroing-out on top of the line-item bug. Convert units
  // explicitly at the boundary instead.
  const taxRate   = quote.tax_rate != null
    ? Number(quote.tax_rate) * 100
    : Number(req.body.tax_rate || 0);
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

  const { data: invoice, error } = await req.supabase
    .from('invoices')
    .insert(payload)
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });

  // Log on the lead if there is one
  if (invoice.lead_id) {
    await req.supabase.from('lead_activities').insert({
      tenant_id: tenantId,
      lead_id:   invoice.lead_id,
      type:      'invoice_created',
      channel:   'system',
      direction: 'outbound',
      content:   `Invoice ${invoiceNumber} created from quote`,
      metadata:  { invoice_id: invoice.id, invoice_number: invoiceNumber },
    });
  }

  const stockResult = await applyInvoiceStockDeductions(req.supabase, {
    tenantId,
    invoiceNumber,
    lineItems,
    leadId: invoice.lead_id,
    createdBy: req.userId,
  });

  res.status(201).json({
    invoice,
    invoice_number: invoiceNumber,
    stock_warnings: stockResult.warnings,
    stock_backorder: stockResult.wentToBackorder,
  });
}

// ── Update ──────────────────────────────────────────────────────────────────

export async function updateInvoice(req, res) {
  if (!requireTenant(req, res)) return;
  if (!requireOwnerOrAdmin(req, res)) return;

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

  const { data, error } = await req.supabase
    .from('invoices')
    .update(updates)
    .eq('id', id)
    .eq('tenant_id', req.tenantId)
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.json({ invoice: data });
}

// ── Cancel ──────────────────────────────────────────────────────────────────

export async function cancelInvoice(req, res) {
  if (!requireTenant(req, res)) return;
  if (!requireOwnerOrAdmin(req, res)) return;

  const { id } = req.params;

  const { data, error } = await req.supabase
    .from('invoices')
    .update({ status: 'cancelled' })
    .eq('id', id)
    .eq('tenant_id', req.tenantId)
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.json({ invoice: data });
}

// ── Generate + stream PDF ───────────────────────────────────────────────────

export async function downloadInvoicePdf(req, res) {
  if (!requireTenant(req, res)) return;

  const { id } = req.params;

  const { data: invoice, error } = await req.supabase
    .from('invoices')
    .select('*')
    .eq('id', id)
    .eq('tenant_id', req.tenantId)
    .single();

  if (error || !invoice) return res.status(404).json({ error: 'Invoice not found' });

  // Fetch brand DNA for company name
  const { data: brandDna } = await req.supabase
    .from('brand_dna')
    .select('brand_name, tagline')
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
  if (!requireTenant(req, res)) return;
  if (!requireOwnerOrAdmin(req, res)) return;

  const tenantId = req.tenantId;

  if (!req.file) {
    return res.status(400).json({ error: 'No file provided. Use multipart/form-data with field name "invoice".' });
  }

  const fileBuffer = req.file.buffer;
  const fileName   = req.file.originalname || 'invoice.pdf';
  const mimeType   = req.file.mimetype || 'application/pdf';

  console.log(`📤 [Invoice Upload]: ${fileName} (${(fileBuffer.length / 1024).toFixed(0)} KB)`);

  // Upload to Supabase storage
  const storagePath = `${tenantId}/${Date.now()}-${fileName}`;
  const { data: storageData, error: storageErr } = await req.supabase.storage
    .from('invoices')
    .upload(storagePath, fileBuffer, { contentType: mimeType, upsert: false });

  if (storageErr) {
    console.error('Storage upload error:', storageErr.message);
  }

  const fileUrl = storageData
    ? req.supabase.storage.from('invoices').getPublicUrl(storagePath).data.publicUrl
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

  const invoiceNumber = await nextInvoiceNumber(req.supabase, tenantId);

  const lineItems = aiExtracted?.line_items || [];
  const subtotal  = aiExtracted?.subtotal || lineItems.reduce((s, i) => s + Number(i.total || 0), 0);
  const taxRate   = Number(aiExtracted?.tax_rate || 0);
  const taxAmount = Number(aiExtracted?.tax_amount || (subtotal * taxRate / 100));
  const total     = Number(aiExtracted?.total_amount || subtotal + taxAmount);

  const { data: invoice, error } = await req.supabase
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
  const invoiceNumber = await nextInvoiceNumber(supabaseClient, tenantId);

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
