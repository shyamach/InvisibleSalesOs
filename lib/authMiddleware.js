/**
 * authMiddleware.js — Supabase JWT validation for user-facing Express routes.
 *
 * Usage:
 *   import { requireAuth } from './lib/authMiddleware.js';
 *   app.get('/api/leads', requireAuth, listLeads);
 *
 * Sets on req:
 *   req.supabase  — Supabase client seeded with the caller's JWT, so auth.uid()
 *                   resolves inside Postgres/RLS for this request's queries
 *   req.user      — Supabase user object { id, email, ... }
 *   req.userId    — req.user.id, for convenience
 *   req.tenantId  — UUID of the tenant the user belongs to (from user_tenants table),
 *                   or null if the user exists but has no tenant yet (e.g. mid-onboarding)
 *   req.userRole  — Role string from user_tenants, or null
 *
 * Falls back gracefully:
 *   If no JWT but DEV_BYPASS_AUTH=true in env, sets default dev tenant.
 *   This allows the server to work during development before auth is wired end-to-end.
 */

import { supabase, createRequestClient } from './supabase.js';

const DEFAULT_TENANT_ID = process.env.DEFAULT_TENANT_ID || '00000000-0000-0000-0000-000000000001';

export async function requireAuth(req, res, next) {
  // Dev bypass — allows existing pipeline to keep working during auth migration.
  // req.supabase here is the shared anon client (no user JWT to seed a
  // per-request client with), so auth.uid()/RLS do not enforce anything for
  // this branch — it relies entirely on the app-layer tenant filter.
  if (process.env.DEV_BYPASS_AUTH === 'true') {
    req.tenantId = DEFAULT_TENANT_ID;
    req.user = { id: 'dev-user', email: 'dev@localhost' };
    req.userId = req.user.id;
    req.userRole = 'owner';
    req.supabase = supabase;
    return next();
  }

  const authHeader = req.headers['authorization'];
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, error: 'Missing or invalid Authorization header' });
  }

  const token = authHeader.slice(7);

  try {
    // Validate JWT with Supabase
    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user) {
      return res.status(401).json({ success: false, error: 'Invalid or expired token' });
    }

    // Per-request client carrying the caller's real JWT, so auth.uid()
    // resolves inside Postgres/RLS for every query made with it.
    req.supabase = createRequestClient(token);

    // Look up tenant_id for this user — may not exist yet (new user mid-onboarding)
    const { data: userTenant, error: tenantError } = await req.supabase
      .from('user_tenants')
      .select('tenant_id, role')
      .eq('user_id', user.id)
      .single();

    req.user = user;
    req.userId = user.id;

    if (tenantError || !userTenant) {
      // User is authenticated but has no tenant yet — let the controller decide what to do
      req.tenantId = null;
      req.userRole = null;
    } else {
      req.tenantId = userTenant.tenant_id;
      req.userRole = userTenant.role;
    }

    next();
  } catch (err) {
    console.error('[Auth] JWT validation error:', err.message);
    return res.status(500).json({ success: false, error: 'Auth service error' });
  }
}

/**
 * requireAdmin — chain after requireAuth to restrict a route to the platform
 * operator only. There is no platform-admin concept in the schema yet
 * (req.userRole from requireAuth is a tenant-level role — owner/admin/member
 * within one's own tenant, not a platform-wide one), so this is a deliberate
 * stopgap: a single hardcoded operator email, not a role/table. Security
 * Lead's call — replace with a real `platform_admins` table/role once there
 * is a second operator to support; fine to defer until then.
 */
export function requireAdmin(req, res, next) {
  if (!process.env.PLATFORM_ADMIN_EMAIL || req.user?.email !== process.env.PLATFORM_ADMIN_EMAIL) {
    return res.status(403).json({ success: false, error: 'Forbidden' });
  }
  next();
}
