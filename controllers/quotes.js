/**
 * controllers/quotes.js — Quote CRUD.
 *
 * Routes (all behind requireAuth):
 *   GET   /api/quotes       → list (optional ?status= filter)
 *   GET   /api/quotes/:id   → single quote
 *   POST  /api/quotes       → create quote
 *   PATCH /api/quotes/:id   → update quote (allow-listed fields)
 *
 * Tenant identity comes from req.tenantId (set by requireAuth from the
 * caller's verified JWT) — never from a header/body/query value. Queries run
 * on req.supabase, the per-request client seeded with that JWT.
 *
 * createQuote/updateQuote additionally require req.userRole of 'owner' or
 * 'admin' — listQuotes and getQuote stay open to any tenant member (read),
 * matching controllers/invoices.js.
 *
 * The smart_leads embed in listQuotes is a read-only join scoped by the
 * outer quotes query's tenant filter — it does not itself establish or fix
 * smart_leads RLS isolation, which is tracked separately.
 */

function requireTenant(req, res) {
  if (req.tenantId) return true;
  res.status(403).json({ success: false, error: 'No tenant associated with this account' });
  return false;
}

function requireOwnerOrAdmin(req, res) {
  if (req.userRole === 'owner' || req.userRole === 'admin') return true;
  res.status(403).json({ success: false, error: 'Only owners and admins can manage quotes' });
  return false;
}

// ── Generate next quote number ──────────────────────────────────────────────

async function nextQuoteNumber(supabaseClient, tenantId) {
  const { count } = await supabaseClient
    .from('quotes')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenantId);

  const seq = (count || 0) + 1;
  return `QT-${String(seq).padStart(4, '0')}`;
}

// ── List ────────────────────────────────────────────────────────────────────

export async function listQuotes(req, res) {
  if (!requireTenant(req, res)) return;

  const status = req.query.status;

  let query = req.supabase
    .from('quotes')
    .select(`
      id, quote_number, status, total, subtotal, currency,
      created_at, valid_until, lead_id,
      smart_leads (
        customer_name, company_name
      )
    `)
    .eq('tenant_id', req.tenantId)
    .order('created_at', { ascending: false })
    .limit(200);

  if (status) query = query.eq('status', status);

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });

  res.json({ quotes: data });
}

// ── Get single ──────────────────────────────────────────────────────────────

export async function getQuote(req, res) {
  if (!requireTenant(req, res)) return;

  const { id } = req.params;

  const { data, error } = await req.supabase
    .from('quotes')
    .select('*')
    .eq('id', id)
    .eq('tenant_id', req.tenantId)
    .single();

  if (error || !data) return res.status(404).json({ error: 'Quote not found' });
  res.json({ quote: data });
}

// ── Create ──────────────────────────────────────────────────────────────────

export async function createQuote(req, res) {
  if (!requireTenant(req, res)) return;
  if (!requireOwnerOrAdmin(req, res)) return;

  const tenantId = req.tenantId;

  const quoteNumber = await nextQuoteNumber(req.supabase, tenantId);

  // tax_amount/total are DB-generated (GENERATED ALWAYS AS, from subtotal *
  // tax_rate) — Postgres rejects any explicit value for them on INSERT, so
  // they must never appear in this payload even if the client sends them.
  const payload = {
    tenant_id:    tenantId,
    quote_number: quoteNumber,
    lead_id:      req.body.lead_id      || null,
    line_items:   req.body.line_items   || [],
    subtotal:     Number(req.body.subtotal   || 0),
    tax_rate:     Number(req.body.tax_rate   || 0),
    currency:     req.body.currency     || 'GBP',
    status:       req.body.status       || 'draft',
    notes:        req.body.notes        || null,
    valid_until:  req.body.valid_until  || null,
  };

  const { data, error } = await req.supabase
    .from('quotes')
    .insert(payload)
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });

  res.status(201).json({ quote: data, quote_number: quoteNumber });
}

// ── Update ──────────────────────────────────────────────────────────────────

export async function updateQuote(req, res) {
  if (!requireTenant(req, res)) return;
  if (!requireOwnerOrAdmin(req, res)) return;

  const { id } = req.params;

  // tax_amount/total excluded — same DB-generated-column reason as createQuote
  // above; setting subtotal/tax_rate lets Postgres recompute them correctly.
  const allowed = [
    'status', 'notes', 'valid_until', 'line_items', 'subtotal',
    'tax_rate', 'currency', 'sent_at',
    'accepted_at', 'lead_id',
  ];

  const updates = {};
  for (const key of allowed) {
    if (req.body[key] !== undefined) updates[key] = req.body[key];
  }

  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ error: 'No valid fields to update' });
  }

  const { data, error } = await req.supabase
    .from('quotes')
    .update(updates)
    .eq('id', id)
    .eq('tenant_id', req.tenantId)
    .select()
    .single();

  if (error || !data) return res.status(404).json({ error: 'Quote not found' });
  res.json({ quote: data });
}
