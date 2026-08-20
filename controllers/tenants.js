/**
 * controllers/tenants.js — Tenant setup status.
 *
 * GET /api/tenants/:id/status — Return setup completion steps
 *
 * The old POST /api/tenants/register (registerTenant) was removed here
 * 2026-08-18 (Phase B item B3, master plan from the same day's systems
 * audit) — it was dead code: zero live callers (only an orphaned frontend
 * proxy that itself had zero callers), it referenced a `tenants.slug` column
 * that no longer exists (dropped in Block 1.12a), it would have failed
 * regardless since `tenants` has no INSERT RLS policy for any role, and it
 * structurally reintroduced a design (raw insert, no user_tenants linkage,
 * client-supplied owner_email) explicitly rejected when bootstrap_tenant()
 * was designed (see supabase/migrations/phase_1_12c_bootstrap_tenant_rpc.sql).
 * Tenant creation now goes exclusively through POST /api/auth/register →
 * bootstrap_tenant().
 */

import { supabase } from '../lib/supabase.js';

// ─── GET /api/tenants/:id/status ─────────────────────────────────────────────

/**
 * Return setup completion steps for a tenant.
 *
 * Steps:
 *   registered       — always true (they exist)
 *   brand_dna_complete — checks brand_dna table for a row with this tenant_id
 *   whatsapp_connected — checks whatsapp_sessions table for a 'ready' session
 *
 * completion_pct: 0–100 (each step = 33.33 points; rounds to nearest integer)
 */
export async function getTenantStatus(req, res) {
  const { id } = req.params;

  if (!id) {
    return res.status(400).json({ success: false, error: 'Missing tenant id.' });
  }

  // ── Fetch tenant ──────────────────────────────────────────────────────────
  const { data: tenant, error: tenantError } = await supabase
    .from('tenants')
    .select('id, name, subscription_tier')
    .eq('id', id)
    .maybeSingle();

  if (tenantError) {
    console.error('[Tenants]: Status lookup error:', tenantError.message);
    return res.status(500).json({ success: false, error: 'Database error.' });
  }

  if (!tenant) {
    return res.status(404).json({ success: false, error: 'Tenant not found.' });
  }

  // ── Check brand_dna ───────────────────────────────────────────────────────
  const { data: brandDna } = await supabase
    .from('brand_dna')
    .select('id')
    .eq('tenant_id', id)
    .maybeSingle();

  const brandDnaComplete = !!brandDna;

  // ── Check whatsapp_sessions ───────────────────────────────────────────────
  // Table may not exist in all environments — treat absence gracefully.
  let whatsappConnected = false;
  try {
    const { data: waSession } = await supabase
      .from('whatsapp_sessions')
      .select('status')
      .eq('tenant_id', id)
      .eq('status', 'ready')
      .maybeSingle();

    whatsappConnected = !!waSession;
  } catch {
    // Table doesn't exist yet in this environment — not a fatal error
    whatsappConnected = false;
  }

  // ── Completion percentage ─────────────────────────────────────────────────
  const completedSteps = [true, brandDnaComplete, whatsappConnected].filter(Boolean).length;
  const completion_pct = Math.round((completedSteps / 3) * 100);

  return res.json({
    success: true,
    tenant: {
      id: tenant.id,
      name: tenant.name,
      subscription_tier: tenant.subscription_tier,
    },
    steps: {
      registered: true,
      brand_dna_complete: brandDnaComplete,
      whatsapp_connected: whatsappConnected,
    },
    completion_pct,
  });
}
