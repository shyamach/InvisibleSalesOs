/**
 * controllers/auth.js — Auth-related API endpoints.
 *
 * GET  /api/auth/me       — returns the current authenticated user + tenant info
 * POST /api/auth/register — creates tenant + user_tenants row after signup
 */

import { supabase } from '../lib/supabase.js';

export async function getMe(req, res) {
  try {
    // req.user and req.tenantId set by requireAuth middleware
    const { user, tenantId } = req;

    if (!tenantId) {
      // Authenticated but no tenant yet — prompt them to complete onboarding
      return res.status(200).json({
        success: true,
        user: {
          id: user.id,
          email: user.email,
          name: user.user_metadata?.full_name || user.email,
        },
        tenant: null,
        onboarding_required: true,
      });
    }

    // Fetch tenant details
    const { data: tenant, error } = await supabase
      .from('tenants')
      .select('id, name, slug, subscription_tier, trial_started_at, owner_email, settings')
      .eq('id', tenantId)
      .single();

    if (error) throw error;

    return res.json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        name: user.user_metadata?.full_name || user.email,
      },
      tenant,
    });
  } catch (err) {
    console.error('[Auth] getMe error:', err.message);
    return res.status(500).json({ success: false, error: 'Failed to fetch user' });
  }
}

export async function registerWithAuth(req, res) {
  /**
   * POST /api/auth/register
   * Called by the signup page AFTER Supabase auth user is created client-side.
   * Creates the tenant + user_tenants row.
   *
   * Body: { business_name, owner_name, whatsapp_number, country, business_type }
   * Header: Authorization: Bearer <jwt>   (from the newly created auth user)
   *
   * Idempotent: if user already has a tenant, returns it without error.
   */
  try {
    const { user, tenantId: existingTenantId } = req;

    // If user already has a tenant, return it (idempotent)
    if (existingTenantId) {
      const { data: tenant } = await supabase
        .from('tenants')
        .select('*')
        .eq('id', existingTenantId)
        .single();
      return res.json({ success: true, tenant, already_registered: true });
    }

    const { business_name, owner_name, whatsapp_number, country, business_type } = req.body;
    if (!business_name || !owner_name) {
      return res.status(400).json({ success: false, error: 'business_name and owner_name are required' });
    }

    const slug =
      business_name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '') +
      '-' +
      Date.now().toString(36);

    // Create tenant
    const { data: tenant, error: tenantError } = await supabase
      .from('tenants')
      .insert({
        name: business_name,
        slug,
        owner_email: user.email,
        subscription_tier: 'trial',
        trial_started_at: new Date().toISOString(),
        settings: {
          country: country || 'UK',
          business_type: business_type || 'Wholesale',
          owner_name,
        },
      })
      .select()
      .single();

    if (tenantError) throw tenantError;

    // Link user to tenant
    const { error: linkError } = await supabase
      .from('user_tenants')
      .insert({ user_id: user.id, tenant_id: tenant.id, role: 'owner' });

    if (linkError) throw linkError;

    return res.status(201).json({ success: true, tenant });
  } catch (err) {
    console.error('[Auth] registerWithAuth error:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
}
