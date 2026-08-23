/**
 * controllers/auth.js — Auth-related API endpoints.
 *
 * GET  /api/auth/me       — returns the current authenticated user + tenant info
 * POST /api/auth/register — creates tenant + user_tenants row after signup
 */

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
        isPlatformAdmin: Boolean(process.env.PLATFORM_ADMIN_EMAIL) && user.email === process.env.PLATFORM_ADMIN_EMAIL,
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
      isPlatformAdmin: Boolean(process.env.PLATFORM_ADMIN_EMAIL) && user.email === process.env.PLATFORM_ADMIN_EMAIL,
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
   * Creates the tenant + user_tenants row via the bootstrap_tenant() RPC.
   *
   * Body: { business_name, owner_name, whatsapp_number, country, business_type }
   * Header: Authorization: Bearer <jwt>   (from the newly created auth user)
   *
   * Idempotent: if user already has a tenant, returns it without error.
   *
   * Bootstrap path (Block 1.12c): `tenants` has no INSERT policy at all — a
   * brand-new user has no user_tenants row yet, so there is no RLS predicate
   * either insert could ever satisfy on its own, regardless of which client
   * makes the call. bootstrap_tenant() is a SECURITY DEFINER RPC
   * (supabase/migrations/phase_1_12c_bootstrap_tenant_rpc.sql) that performs
   * both inserts atomically, deriving user_id/owner_email server-side from
   * auth.uid()/auth.users rather than trusting client input, and
   * self-serializing concurrent calls for the same user via an advisory
   * lock. Both branches below run on req.supabase (the caller's JWT-scoped
   * client) — auth.uid() inside the RPC resolves from the request's JWT
   * claims, not from which client object made the call, so the shared anon
   * client (which carries no JWT) would always see auth.uid() = NULL here.
   */
  try {
    const { user, tenantId: existingTenantId } = req;

    // If user already has a tenant, return it (idempotent)
    if (existingTenantId) {
      const { data: tenant } = await req.supabase
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

    const { data, error: rpcError } = await req.supabase.rpc('bootstrap_tenant', {
      p_name: business_name,
      p_settings: {
        country: country || 'UK',
        business_type: business_type || 'Wholesale',
        owner_name,
      },
    });

    if (rpcError) throw rpcError;

    if (data.already_registered) {
      return res.json({ success: true, tenant: data.tenant, already_registered: true });
    }

    return res.status(201).json({ success: true, tenant: data.tenant });
  } catch (err) {
    console.error('[Auth] registerWithAuth error:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
}
