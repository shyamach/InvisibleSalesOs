/**
 * controllers/tenants.js — Tenant registration + setup status.
 *
 * POST /api/tenants/register  — Create a new tenant account
 * GET  /api/tenants/:id/status — Return setup completion steps
 */

import { supabase } from '../lib/supabase.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Generate a URL-safe slug from a business name.
 * "Ahmed Fabrics Ltd!" → "ahmed-fabrics-ltd"
 */
function slugify(name) {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')   // strip non-alphanumeric (except spaces/hyphens)
    .replace(/\s+/g, '-')            // spaces → hyphens
    .replace(/-+/g, '-')             // collapse multiple hyphens
    .replace(/^-+|-+$/g, '');        // trim leading/trailing hyphens
}

// ─── POST /api/tenants/register ───────────────────────────────────────────────

/**
 * Register a new tenant.
 *
 * Body: { name, owner_email, whatsapp_number, country?, business_type?, owner_name? }
 * Returns: { tenant_id, slug, setup_token } (201)
 * Errors: 400 (validation), 409 (duplicate email), 500 (db error)
 */
export async function registerTenant(req, res) {
  const { name, owner_email, whatsapp_number, country, business_type, owner_name } = req.body;

  // ── Validation ────────────────────────────────────────────────────────────
  const missing = [];
  if (!name || !String(name).trim()) missing.push('name');
  if (!owner_email || !String(owner_email).trim()) missing.push('owner_email');
  if (!whatsapp_number || !String(whatsapp_number).trim()) missing.push('whatsapp_number');

  if (missing.length > 0) {
    return res.status(400).json({
      success: false,
      error: `Missing required fields: ${missing.join(', ')}`,
    });
  }

  const cleanEmail = String(owner_email).trim().toLowerCase();
  const cleanName = String(name).trim();

  // Basic email format check
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
    return res.status(400).json({
      success: false,
      error: 'Invalid email address format.',
    });
  }

  // ── Duplicate check ───────────────────────────────────────────────────────
  const { data: existing, error: lookupError } = await supabase
    .from('tenants')
    .select('id')
    .eq('owner_email', cleanEmail)
    .maybeSingle();

  if (lookupError) {
    console.error('[Tenants]: Duplicate check error:', lookupError.message);
    return res.status(500).json({ success: false, error: 'Database error during registration.' });
  }

  if (existing) {
    return res.status(409).json({
      success: false,
      error: 'An account with this email already exists.',
    });
  }

  // ── Generate slug (ensure uniqueness by appending random suffix if needed) ─
  const baseSlug = slugify(cleanName) || 'business';

  // Check if slug is already taken and append a short random suffix if so
  const { data: slugCheck } = await supabase
    .from('tenants')
    .select('id')
    .eq('slug', baseSlug)
    .maybeSingle();

  const slug = slugCheck
    ? `${baseSlug}-${Math.random().toString(36).slice(2, 6)}`
    : baseSlug;

  // ── Insert ────────────────────────────────────────────────────────────────
  const { data: tenant, error: insertError } = await supabase
    .from('tenants')
    .insert({
      name: cleanName,
      slug,
      owner_email: cleanEmail,
      subscription_tier: 'trial',
      trial_started_at: new Date().toISOString(),
      settings: {
        whatsapp_number: String(whatsapp_number).trim(),
        country: country || null,
        business_type: business_type || null,
        owner_name: owner_name ? String(owner_name).trim() : null,
      },
    })
    .select('id, slug')
    .single();

  if (insertError) {
    console.error('[Tenants]: Insert error:', insertError.message);
    return res.status(500).json({ success: false, error: 'Failed to create account. Please try again.' });
  }

  console.log(`[Tenants]: New tenant registered — ${cleanName} (${cleanEmail}) → ${tenant.id}`);

  return res.status(201).json({
    success: true,
    tenant_id: tenant.id,
    slug: tenant.slug,
    setup_token: tenant.id,   // Simple token = tenant_id for now (no auth flow yet)
  });
}

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
