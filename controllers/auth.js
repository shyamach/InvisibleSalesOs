/**
 * controllers/auth.js — Auth-related API endpoints.
 *
 * GET  /api/auth/me       — returns the current authenticated user + tenant info
 * POST /api/auth/register — creates tenant + user_tenants row after signup
 */

import { supabase } from '../lib/supabase.js';

export async function getMe(req, res) {
  try {
    // req.user, req.tenantId, req.supabase set by requireAuth middleware
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

    // Fetch tenant details via req.supabase (the caller's JWT-scoped client),
    // so auth.uid()/RLS resolve for this request instead of the shared anon
    // client. No `slug` column exists on `tenants` — do not select it.
    const { data: tenant, error } = await req.supabase
      .from('tenants')
      .select('id, name, subscription_tier, trial_started_at, owner_email, settings')
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
   *
   * Bootstrap path: at this point the caller is authenticated but (in the
   * create branch below) has no user_tenants row yet, so auth_tenant_id()
   * resolves to NULL and tenant-scoped RLS has nothing to match against
   * except the dev-fallback branch. Using req.supabase here would put the
   * bootstrap insert at the mercy of that dev-fallback policy branch rather
   * than a real per-user grant, so this still runs on the shared client for
   * now. A dedicated bootstrap-safe write path (e.g. a SECURITY DEFINER RPC,
   * or granting INSERT before RLS is fully proven) is Block 1.12b work.
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

    // Create tenant. No `slug` column exists on `tenants` — do not insert one.
    const { data: tenant, error: tenantError } = await supabase
      .from('tenants')
      .insert({
        name: business_name,
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
