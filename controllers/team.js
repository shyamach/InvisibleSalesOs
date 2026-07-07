/**
 * controllers/team.js — Per-client employee accounts (team membership).
 *
 *   GET    /api/team            — list members (with emails)
 *   POST   /api/team            — add an EXISTING auth user (by email) to the tenant
 *   PATCH  /api/team/:userId    — change a member's role
 *   DELETE /api/team/:userId    — remove a member
 *
 * Tenant identity comes from req.tenantId (set by requireAuth from the
 * caller's verified JWT) — never from a header/body/query value. Queries run
 * on req.supabase, the per-request client seeded with that JWT, so auth.uid()
 * resolves for RLS; the .eq('tenant_id', req.tenantId) filters below stay as
 * defence-in-depth, not the primary authority.
 *
 * addMember/updateMemberRole/removeMember additionally require req.userRole
 * of 'owner' or 'admin' — listMembers stays open to any tenant member.
 *
 * NOTE: inviting a BRAND-NEW user (creating the auth account) needs the Supabase
 * service-role key (admin API) which isn't configured yet — until then, the
 * person must self-sign-up first, then the owner can add them here.
 *
 * NOTE: get_tenant_members()/get_user_id_by_email() are SECURITY DEFINER RPCs
 * with no internal tenant/caller check of their own — this slice closes the
 * HTTP-layer spoofing path (tenant identity is now JWT-verified, not
 * caller-supplied), but the RPC-layer leak (calling these functions directly
 * against the Supabase REST endpoint with an arbitrary argument) remains and
 * is deferred to Block 1.7, not fixed here.
 */
import { validateRole, canChangeRole, canRemoveMember, isMember } from '../lib/team.js';

function requireTenant(req, res) {
  if (req.tenantId) return true;
  res.status(403).json({ success: false, error: 'No tenant associated with this account' });
  return false;
}

function requireOwnerOrAdmin(req, res) {
  if (req.userRole === 'owner' || req.userRole === 'admin') return true;
  res.status(403).json({ success: false, error: 'Only owners and admins can manage team members' });
  return false;
}

async function fetchMembers(supabaseClient, tenantId) {
  const { data, error } = await supabaseClient.rpc('get_tenant_members', { p_tenant_id: tenantId });
  if (error) throw error;
  return data || [];
}

// ─── List ─────────────────────────────────────────────────────────────────────
export async function listMembers(req, res) {
  if (!requireTenant(req, res)) return;

  try {
    const members = await fetchMembers(req.supabase, req.tenantId);
    return res.json({ success: true, members });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}

// ─── Add existing user by email ───────────────────────────────────────────────
export async function addMember(req, res) {
  if (!requireTenant(req, res)) return;
  if (!requireOwnerOrAdmin(req, res)) return;

  const tenantId = req.tenantId;
  const { email, role = 'member' } = req.body || {};

  if (!email) return res.status(400).json({ success: false, error: 'email is required' });
  if (!validateRole(role)) return res.status(400).json({ success: false, error: `invalid role "${role}"` });

  try {
    const { data: userId, error: lookupErr } = await req.supabase.rpc('get_user_id_by_email', { p_email: email });
    if (lookupErr) throw lookupErr;

    if (!userId) {
      return res.status(404).json({
        success: false,
        code: 'NOT_REGISTERED',
        error: 'No account exists for that email yet. Ask them to sign up first, then add them.',
      });
    }

    const members = await fetchMembers(req.supabase, tenantId);
    if (isMember(members, userId)) {
      return res.status(409).json({ success: false, error: 'That person is already on the team.' });
    }

    const { error: insErr } = await req.supabase
      .from('user_tenants')
      .insert({ user_id: userId, tenant_id: tenantId, role });
    if (insErr) throw insErr;

    return res.status(201).json({ success: true, member: { user_id: userId, email, role } });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}

// ─── Change role ──────────────────────────────────────────────────────────────
export async function updateMemberRole(req, res) {
  if (!requireTenant(req, res)) return;
  if (!requireOwnerOrAdmin(req, res)) return;

  const tenantId = req.tenantId;
  const { role } = req.body || {};
  const { userId } = req.params;

  try {
    const members = await fetchMembers(req.supabase, tenantId);
    const check = canChangeRole(members, userId, role);
    if (!check.ok) return res.status(400).json({ success: false, error: check.error });

    const { error } = await req.supabase
      .from('user_tenants')
      .update({ role })
      .eq('tenant_id', tenantId)
      .eq('user_id', userId);
    if (error) throw error;

    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}

// ─── Remove member ────────────────────────────────────────────────────────────
export async function removeMember(req, res) {
  if (!requireTenant(req, res)) return;
  if (!requireOwnerOrAdmin(req, res)) return;

  const tenantId = req.tenantId;
  const { userId } = req.params;

  try {
    const members = await fetchMembers(req.supabase, tenantId);
    const check = canRemoveMember(members, userId);
    if (!check.ok) return res.status(400).json({ success: false, error: check.error });

    const { error } = await req.supabase
      .from('user_tenants')
      .delete()
      .eq('tenant_id', tenantId)
      .eq('user_id', userId);
    if (error) throw error;

    return res.json({ success: true, removed: userId });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}
