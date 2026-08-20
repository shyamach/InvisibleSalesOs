/**
 * controllers/segments.js — Retention segments + campaign runs.
 *
 * Routes (behind requireAuth):
 *   GET  /api/segments            — list
 *   POST /api/segments            — create
 *   POST /api/segments/preview    — count + sample leads matching filter criteria
 *   POST /api/segments/:id/run    — queue a campaign run (insert segment_runs, touch last_run_at)
 *
 * Added 2026-08-18 (Phase B item B2) replacing direct raw-anon-Supabase
 * reads/writes on segments/page.tsx and segments/new/page.tsx ("Lane C").
 * Filter semantics in previewSegment mirror the frontend's previous
 * client-side query exactly (see frontend/src/lib/segment-utils.ts's
 * SegmentFilters shape) — only the execution moved server-side.
 */

const SEGMENT_CHANNELS = ['whatsapp', 'email', 'both'];
const PIPELINE_STAGES = ['new', 'contacted', 'quoted', 'negotiating', 'won', 'lost', 'dormant'];

function requireTenant(req, res) {
  if (req.tenantId) return true;
  res.status(403).json({ success: false, error: 'No tenant associated with this account' });
  return false;
}

function applyFilters(query, filters = {}) {
  let q = query;
  if (Array.isArray(filters.pipeline_stage) && filters.pipeline_stage.length > 0) {
    const stages = filters.pipeline_stage.filter((s) => PIPELINE_STAGES.includes(s));
    if (stages.length > 0) q = q.in('pipeline_stage', stages);
  }
  if (filters.ptc_score_min !== undefined && filters.ptc_score_min !== null && filters.ptc_score_min !== '') {
    q = q.gte('ptc_score', Number(filters.ptc_score_min));
  }
  if (filters.source_channel && filters.source_channel !== 'any') {
    q = q.eq('source_channel', filters.source_channel);
  }
  if (filters.days_since_contact !== undefined && filters.days_since_contact !== null && filters.days_since_contact !== '') {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - Number(filters.days_since_contact));
    q = q.lt('updated_at', cutoff.toISOString());
  }
  if (filters.days_since_created !== undefined && filters.days_since_created !== null && filters.days_since_created !== '') {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - Number(filters.days_since_created));
    q = q.gte('created_at', cutoff.toISOString());
  }
  return q;
}

// ─── List ─────────────────────────────────────────────────────────────────────
export async function listSegments(req, res) {
  if (!requireTenant(req, res)) return;

  const { data, error } = await req.supabase
    .from('segments')
    .select('*')
    .eq('tenant_id', req.tenantId)
    .order('created_at', { ascending: false });

  if (error) return res.status(500).json({ success: false, error: error.message });
  return res.json({ success: true, segments: data });
}

// ─── Preview ──────────────────────────────────────────────────────────────────
export async function previewSegment(req, res) {
  if (!requireTenant(req, res)) return;

  const filters = req.body?.filters || {};

  let q = applyFilters(
    req.supabase.from('smart_leads').select('customer_name, company_name', { count: 'exact' }).eq('tenant_id', req.tenantId).is('deleted_at', null),
    filters
  ).limit(3);

  const { data, count, error } = await q;
  if (error) return res.status(500).json({ success: false, error: error.message });

  return res.json({
    success: true,
    count: count ?? 0,
    samples: (data || []).map((r) => ({ customer_name: r.customer_name, company_name: r.company_name })),
  });
}

// ─── Create ─────────────────────────────────────────────────────────────────────
export async function createSegment(req, res) {
  if (!requireTenant(req, res)) return;

  const tenantId = req.tenantId;
  const { name, description, filters, channel, lead_count } = req.body || {};

  if (!name || !String(name).trim()) {
    return res.status(400).json({ success: false, error: 'name is required' });
  }
  if (channel && !SEGMENT_CHANNELS.includes(channel)) {
    return res.status(400).json({ success: false, error: `invalid channel "${channel}"` });
  }

  const { data, error } = await req.supabase
    .from('segments')
    .insert({
      tenant_id: tenantId,
      name: String(name).trim(),
      description: description?.trim() || null,
      filters: filters || {},
      channel: channel || 'whatsapp',
      lead_count: Number.isFinite(lead_count) ? lead_count : 0,
    })
    .select('*')
    .single();

  if (error) return res.status(500).json({ success: false, error: error.message });
  return res.status(201).json({ success: true, segment: data });
}

// ─── Run campaign ─────────────────────────────────────────────────────────────
export async function runSegment(req, res) {
  if (!requireTenant(req, res)) return;

  const tenantId = req.tenantId;

  const { data: segment, error: segErr } = await req.supabase
    .from('segments')
    .select('id, lead_count, channel')
    .eq('id', req.params.id)
    .eq('tenant_id', tenantId)
    .maybeSingle();

  if (segErr) return res.status(500).json({ success: false, error: segErr.message });
  if (!segment) return res.status(404).json({ success: false, error: 'Segment not found' });

  const { data: run, error: runErr } = await req.supabase
    .from('segment_runs')
    .insert({
      tenant_id: tenantId,
      segment_id: segment.id,
      leads_matched: segment.lead_count ?? 0,
      drafts_created: segment.lead_count ?? 0,
      channel: segment.channel || 'whatsapp',
      status: 'completed',
      ran_at: new Date().toISOString(),
    })
    .select('*')
    .single();

  if (runErr) return res.status(500).json({ success: false, error: runErr.message });

  await req.supabase
    .from('segments')
    .update({ last_run_at: new Date().toISOString() })
    .eq('id', segment.id)
    .eq('tenant_id', tenantId);

  return res.status(201).json({ success: true, run });
}
