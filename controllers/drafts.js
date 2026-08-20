/**
 * controllers/drafts.js — Pending AI-draft queue (the human-in-the-loop
 * approval screen at /app/drafts and the sidebar's live draft count).
 *
 * Routes (behind requireAuth):
 *   GET   /api/drafts            — list pending drafts (direction='outbound_draft')
 *   GET   /api/drafts/count      — count only, for the sidebar badge
 *   PATCH /api/drafts/:id        — edit message_content before sending
 *   PATCH /api/drafts/:id/dismiss  — mark dismissed
 *   PATCH /api/drafts/:id/escalate — mark escalated + flag the lead
 *
 * Added 2026-08-18 (Phase B item B2) replacing direct raw-anon-Supabase
 * reads/writes on drafts/page.tsx and the sidebar's DraftCount/DraftCountDot
 * ("Lane C"). Approve/save-and-send already went through the (now-hardened)
 * POST /api/dispatch → /api/responder/dispatch path before this change —
 * only the list/count reads and dismiss/escalate/edit actions were still
 * unauthenticated. Deliberately does not touch the separate, currently
 * uncalled POST /api/draft-action (ai_learning bookkeeping) — different
 * concern, out of scope here.
 */

function requireTenant(req, res) {
  if (req.tenantId) return true;
  res.status(403).json({ success: false, error: 'No tenant associated with this account' });
  return false;
}

function flattenDraft(row) {
  return {
    id: row.id,
    message_content: row.message_content,
    created_at: row.created_at,
    lead_id: row.lead_id,
    customer_name: row.smart_leads?.customer_name ?? null,
    company_name: row.smart_leads?.company_name ?? null,
    product_interest: row.smart_leads?.product_interest ?? null,
    ptc_score: row.smart_leads?.ptc_score ?? null,
    intent_category: row.smart_leads?.intent_category ?? null,
    source_channel: row.smart_leads?.source_channel ?? null,
  };
}

// ─── List ─────────────────────────────────────────────────────────────────────
export async function listDrafts(req, res) {
  if (!requireTenant(req, res)) return;

  const { data, error } = await req.supabase
    .from('smart_interactions')
    .select(`
      id, message_content, created_at, lead_id,
      smart_leads (
        customer_name, company_name, product_interest,
        ptc_score, intent_category, source_channel
      )
    `)
    .eq('tenant_id', req.tenantId)
    .eq('direction', 'outbound_draft')
    .order('created_at', { ascending: false });

  if (error) return res.status(500).json({ success: false, error: error.message });
  return res.json({ success: true, drafts: (data || []).map(flattenDraft) });
}

// ─── Count (sidebar badge) ────────────────────────────────────────────────────
export async function countDrafts(req, res) {
  if (!requireTenant(req, res)) return;

  const { count, error } = await req.supabase
    .from('smart_interactions')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', req.tenantId)
    .eq('direction', 'outbound_draft');

  if (error) return res.status(500).json({ success: false, error: error.message });
  return res.json({ success: true, count: count ?? 0 });
}

// ─── Edit content (before Save & Send) ───────────────────────────────────────
export async function updateDraftContent(req, res) {
  if (!requireTenant(req, res)) return;

  const { message_content } = req.body || {};
  if (!message_content || !String(message_content).trim()) {
    return res.status(400).json({ success: false, error: 'message_content is required' });
  }

  const { data, error } = await req.supabase
    .from('smart_interactions')
    .update({ message_content: String(message_content).trim() })
    .eq('id', req.params.id)
    .eq('tenant_id', req.tenantId)
    .eq('direction', 'outbound_draft')
    .select('id, message_content')
    .maybeSingle();

  if (error) return res.status(500).json({ success: false, error: error.message });
  if (!data) return res.status(404).json({ success: false, error: 'Draft not found' });
  return res.json({ success: true, draft: data });
}

// ─── Dismiss ──────────────────────────────────────────────────────────────────
export async function dismissDraft(req, res) {
  if (!requireTenant(req, res)) return;

  const { data, error } = await req.supabase
    .from('smart_interactions')
    .update({ direction: 'dismissed' })
    .eq('id', req.params.id)
    .eq('tenant_id', req.tenantId)
    .select('id')
    .maybeSingle();

  if (error) return res.status(500).json({ success: false, error: error.message });
  if (!data) return res.status(404).json({ success: false, error: 'Draft not found' });
  return res.json({ success: true });
}

// ─── Escalate ─────────────────────────────────────────────────────────────────
export async function escalateDraft(req, res) {
  if (!requireTenant(req, res)) return;

  const tenantId = req.tenantId;

  const { data: interaction, error: intErr } = await req.supabase
    .from('smart_interactions')
    .select('id, lead_id')
    .eq('id', req.params.id)
    .eq('tenant_id', tenantId)
    .maybeSingle();

  if (intErr) return res.status(500).json({ success: false, error: intErr.message });
  if (!interaction) return res.status(404).json({ success: false, error: 'Draft not found' });

  const { error: updateErr } = await req.supabase
    .from('smart_interactions')
    .update({ direction: 'escalated' })
    .eq('id', req.params.id)
    .eq('tenant_id', tenantId);

  if (updateErr) return res.status(500).json({ success: false, error: updateErr.message });

  if (interaction.lead_id) {
    await req.supabase
      .from('smart_leads')
      .update({ triage_status: 'escalated' })
      .eq('id', interaction.lead_id)
      .eq('tenant_id', tenantId);
  }

  return res.json({ success: true });
}
