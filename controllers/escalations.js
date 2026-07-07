/**
 * controllers/escalations.js — Sales-rep handoff queue + outcome tracking.
 *
 * Routes (behind requireAuth):
 *   POST  /api/escalations               — create (manual or programmatic)
 *   GET   /api/escalations?status=        — list (optional status filter)
 *   PATCH /api/escalations/:id            — update outcome/assignment (transition-validated)
 *   GET   /api/escalations/attribution    — per-rep attribution summary
 *
 * Tenant identity comes from req.tenantId (set by requireAuth from the
 * caller's verified JWT) — never from a header/body/query value. Queries run
 * on req.supabase, the per-request client seeded with that JWT, so auth.uid()
 * resolves for RLS; the .eq('tenant_id', req.tenantId) filters below stay as
 * defence-in-depth, not the primary authority.
 *
 * Domain rules (triggers, transitions, attribution) live in lib/escalation.js.
 */
import {
  ESCALATION_REASONS,
  validateOutcomeTransition,
  isTerminal,
  summarizeAttribution,
} from '../lib/escalation.js';

function requireTenant(req, res) {
  if (req.tenantId) return true;
  res.status(403).json({ success: false, error: 'No tenant associated with this account' });
  return false;
}

// ─── Create ─────────────────────────────────────────────────────────────────────
export async function createEscalation(req, res) {
  if (!requireTenant(req, res)) return;

  const tenantId = req.tenantId;
  const { lead_id, reason = 'manual', note, assigned_to, assigned_to_name, trigger_context } = req.body || {};

  if (!lead_id) return res.status(400).json({ success: false, error: 'lead_id is required' });
  if (!ESCALATION_REASONS.includes(reason)) {
    return res.status(400).json({ success: false, error: `invalid reason "${reason}"` });
  }

  const { data, error } = await req.supabase
    .from('escalations')
    .insert({ tenant_id: tenantId, lead_id, reason, note: note || null, assigned_to: assigned_to || null, assigned_to_name: assigned_to_name || null, trigger_context: trigger_context || null })
    .select('*')
    .single();

  if (error) return res.status(500).json({ success: false, error: error.message });

  // Flag the lead (non-fatal).
  await req.supabase
    .from('smart_leads')
    .update({ escalation_status: 'pending', escalated_at: new Date().toISOString() })
    .eq('tenant_id', tenantId)
    .eq('id', lead_id);

  return res.status(201).json({ success: true, escalation: data });
}

// ─── List ─────────────────────────────────────────────────────────────────────
export async function listEscalations(req, res) {
  if (!requireTenant(req, res)) return;

  let q = req.supabase
    .from('escalations')
    .select('*, smart_leads(customer_name, company_name, product_interest)')
    .eq('tenant_id', req.tenantId)
    .order('created_at', { ascending: false })
    .limit(200);

  if (req.query.status) q = q.eq('status', req.query.status);

  const { data, error } = await q;
  if (error) return res.status(500).json({ success: false, error: error.message });
  return res.json({ success: true, escalations: data });
}

// ─── Update outcome / assignment ─────────────────────────────────────────────────
export async function updateEscalation(req, res) {
  if (!requireTenant(req, res)) return;

  const tenantId = req.tenantId;
  const { status, outcome_note, deal_value, assigned_to, assigned_to_name } = req.body || {};

  // Load current.
  const { data: current, error: fetchErr } = await req.supabase
    .from('escalations')
    .select('id, status, lead_id')
    .eq('tenant_id', tenantId)
    .eq('id', req.params.id)
    .maybeSingle();

  if (fetchErr) return res.status(500).json({ success: false, error: fetchErr.message });
  if (!current) return res.status(404).json({ success: false, error: 'Escalation not found' });

  const patch = {};
  if (outcome_note !== undefined) patch.outcome_note = outcome_note;
  if (deal_value !== undefined) patch.deal_value = deal_value;
  if (assigned_to !== undefined) patch.assigned_to = assigned_to;
  if (assigned_to_name !== undefined) patch.assigned_to_name = assigned_to_name;

  if (status !== undefined && status !== current.status) {
    const check = validateOutcomeTransition(current.status, status);
    if (!check.ok) return res.status(400).json({ success: false, error: check.error });
    patch.status = status;
    if (isTerminal(status) || status === 'stalled') patch.resolved_at = new Date().toISOString();
  }

  if (Object.keys(patch).length === 0) return res.status(400).json({ success: false, error: 'No fields to update' });

  const { data, error } = await req.supabase
    .from('escalations')
    .update(patch)
    .eq('tenant_id', tenantId)
    .eq('id', req.params.id)
    .select('*')
    .single();

  if (error) return res.status(500).json({ success: false, error: error.message });

  // Mirror terminal outcome onto the lead's escalation_status.
  if (patch.status && isTerminal(patch.status)) {
    await req.supabase.from('smart_leads').update({ escalation_status: 'resolved' }).eq('tenant_id', tenantId).eq('id', current.lead_id);
  }

  return res.json({ success: true, escalation: data });
}

// ─── Attribution ────────────────────────────────────────────────────────────────
export async function getAttribution(req, res) {
  if (!requireTenant(req, res)) return;

  const { data, error } = await req.supabase
    .from('escalations')
    .select('assigned_to_name, status, deal_value')
    .eq('tenant_id', req.tenantId);

  if (error) return res.status(500).json({ success: false, error: error.message });
  return res.json({ success: true, attribution: summarizeAttribution(data || []) });
}
