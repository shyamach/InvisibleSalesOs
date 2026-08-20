/**
 * controllers/leads.js — Smart leads (pipeline) + per-lead activity timeline.
 *
 * Routes (behind requireAuth):
 *   GET   /api/leads                — list (optional ?search=, ?limit=)
 *   GET   /api/leads/:id            — single lead
 *   PATCH /api/leads/:id            — update pipeline_stage and/or deal_value
 *   GET   /api/leads/:id/activities — activity timeline for a lead
 *
 * Call logging is NOT here — the existing (richer) controllers/calls.js
 * already covers call_logs + lead_activities + optional AI follow-up draft
 * generation; that file was fixed alongside this one rather than duplicated.
 *
 * Added 2026-08-18 (Phase B item B2, master plan from the same day's systems
 * audit) — these replace direct raw-anon-Supabase reads/writes that
 * previously ran from the browser on dashboard/leads/leads/[id] ("Lane C").
 * Tenant identity comes from req.tenantId (requireAuth, verified JWT) —
 * never from a header/body/query value. Queries run on req.supabase so RLS
 * enforces this as a real backstop, not just app-level trust.
 */

const PIPELINE_STAGES = ['new', 'contacted', 'quoted', 'negotiating', 'won', 'lost', 'dormant'];

function requireTenant(req, res) {
  if (req.tenantId) return true;
  res.status(403).json({ success: false, error: 'No tenant associated with this account' });
  return false;
}

// ─── List ─────────────────────────────────────────────────────────────────────
export async function listLeads(req, res) {
  if (!requireTenant(req, res)) return;

  const limit = Math.min(parseInt(req.query.limit, 10) || 200, 500);

  let q = req.supabase
    .from('smart_leads')
    .select(
      'id, customer_name, company_name, product_interest, ptc_score, intent_category, ' +
      'triage_status, pipeline_stage, source_channel, detected_language, deal_value, created_at'
    )
    .eq('tenant_id', req.tenantId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(limit);

  const search = (req.query.search || '').trim();
  if (search) {
    const term = search.replace(/[%,]/g, ' ').trim();
    q = q.or(
      `customer_name.ilike.%${term}%,company_name.ilike.%${term}%,product_interest.ilike.%${term}%`
    );
  }

  const { data, error } = await q;
  if (error) return res.status(500).json({ success: false, error: error.message });
  return res.json({ success: true, leads: data });
}

// ─── Get one ────────────────────────────────────────────────────────────────────
export async function getLead(req, res) {
  if (!requireTenant(req, res)) return;

  const { data, error } = await req.supabase
    .from('smart_leads')
    .select(
      'id, customer_name, company_name, pipeline_stage, ptc_score, source_channel, ' +
      'deal_value, detected_language, created_at, tenant_id'
    )
    .eq('id', req.params.id)
    .eq('tenant_id', req.tenantId)
    .maybeSingle();

  if (error) return res.status(500).json({ success: false, error: error.message });
  if (!data) return res.status(404).json({ success: false, error: 'Lead not found' });
  return res.json({ success: true, lead: data });
}

// ─── Update (pipeline stage / deal value) ────────────────────────────────────────
export async function updateLead(req, res) {
  if (!requireTenant(req, res)) return;

  const tenantId = req.tenantId;
  const { pipeline_stage, deal_value } = req.body || {};

  if (pipeline_stage === undefined && deal_value === undefined) {
    return res.status(400).json({ success: false, error: 'No fields to update' });
  }
  if (pipeline_stage !== undefined && !PIPELINE_STAGES.includes(pipeline_stage)) {
    return res.status(400).json({ success: false, error: `invalid pipeline_stage "${pipeline_stage}"` });
  }

  const { data: current, error: fetchErr } = await req.supabase
    .from('smart_leads')
    .select('id, pipeline_stage')
    .eq('id', req.params.id)
    .eq('tenant_id', tenantId)
    .maybeSingle();

  if (fetchErr) return res.status(500).json({ success: false, error: fetchErr.message });
  if (!current) return res.status(404).json({ success: false, error: 'Lead not found' });

  const patch = {};
  if (pipeline_stage !== undefined) patch.pipeline_stage = pipeline_stage;
  if (deal_value !== undefined) patch.deal_value = deal_value === null ? null : Number(deal_value);

  const { data, error } = await req.supabase
    .from('smart_leads')
    .update(patch)
    .eq('id', req.params.id)
    .eq('tenant_id', tenantId)
    .select('*')
    .single();

  if (error) return res.status(500).json({ success: false, error: error.message });

  if (pipeline_stage !== undefined && pipeline_stage !== current.pipeline_stage) {
    await req.supabase.from('lead_activities').insert({
      tenant_id: tenantId,
      lead_id: req.params.id,
      type: 'stage_change',
      channel: 'system',
      content: `Stage changed from ${current.pipeline_stage} → ${pipeline_stage}`,
      metadata: { from: current.pipeline_stage, to: pipeline_stage },
    });
  }

  return res.json({ success: true, lead: data });
}

// ─── Activity timeline ────────────────────────────────────────────────────────
export async function listActivities(req, res) {
  if (!requireTenant(req, res)) return;

  const { data, error } = await req.supabase
    .from('lead_activities')
    .select('id, type, channel, direction, content, outcome, created_at')
    .eq('lead_id', req.params.id)
    .eq('tenant_id', req.tenantId)
    .order('created_at', { ascending: false });

  if (error) return res.status(500).json({ success: false, error: error.message });
  return res.json({ success: true, activities: data });
}
