/**
 * controllers/dashboardMetrics.js — Aggregate stats for the dashboard page.
 *
 * Routes (behind requireAuth):
 *   GET /api/dashboard/metrics — { metrics, recent_leads, stage_counts }
 *
 * Added 2026-08-18 (Phase B item B2) replacing a direct raw-anon-Supabase
 * read of the tenant_metrics view + smart_leads from the dashboard page
 * ("Lane C"). Purpose-built single endpoint rather than three generic calls,
 * since this is exactly the shape the dashboard page needs and nothing else
 * uses it.
 *
 * Field-name note: the frontend's old direct query expected `total_won` and
 * `drafts_pending`, but the live tenant_metrics view actually returns
 * `leads_won` and `pending_drafts` — a pre-existing mismatch (those two
 * fields were always undefined). Fixed here by returning the view's real
 * field names and updating the frontend to match, since this endpoint
 * replaces that exact code path anyway.
 */

const PIPELINE_STAGES = ['new', 'contacted', 'quoted', 'negotiating', 'won', 'lost', 'dormant'];

function requireTenant(req, res) {
  if (req.tenantId) return true;
  res.status(403).json({ success: false, error: 'No tenant associated with this account' });
  return false;
}

export async function getDashboardMetrics(req, res) {
  if (!requireTenant(req, res)) return;

  const tenantId = req.tenantId;

  const [{ data: metrics, error: metricsErr }, { data: recentLeads, error: recentErr }, { data: allStages, error: stagesErr }] =
    await Promise.all([
      req.supabase.from('tenant_metrics').select('*').eq('tenant_id', tenantId).maybeSingle(),
      req.supabase
        .from('smart_leads')
        .select('id, customer_name, company_name, pipeline_stage, ptc_score, source_channel, created_at')
        .eq('tenant_id', tenantId)
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
        .limit(10),
      req.supabase
        .from('smart_leads')
        .select('pipeline_stage')
        .eq('tenant_id', tenantId)
        .is('deleted_at', null),
    ]);

  if (metricsErr) return res.status(500).json({ success: false, error: metricsErr.message });
  if (recentErr) return res.status(500).json({ success: false, error: recentErr.message });
  if (stagesErr) return res.status(500).json({ success: false, error: stagesErr.message });

  const counts = {};
  for (const row of allStages || []) {
    const s = row.pipeline_stage ?? 'new';
    counts[s] = (counts[s] ?? 0) + 1;
  }
  const stage_counts = PIPELINE_STAGES.map((stage) => ({ stage, count: counts[stage] ?? 0 }));

  return res.json({
    success: true,
    metrics: metrics || null,
    recent_leads: recentLeads || [],
    stage_counts,
  });
}
