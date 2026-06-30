/**
 * controllers/team.js — Per-client employee accounts (team membership).
 *
 *   GET    /api/team            — list members (with emails)
 *   POST   /api/team            — add an EXISTING auth user (by email) to the tenant
 *   PATCH  /api/team/:userId    — change a member's role
 *   DELETE /api/team/:userId    — remove a member
 *
 * NOTE: inviting a BRAND-NEW user (creating the auth account) needs the Supabase
 * service-role key (admin API) which isn't configured yet — until then, the
 * person must self-sign-up first, then the owner can add them here.
 */
import { supabase } from '../lib/supabase.js';
import { validateRole, canChangeRole, canRemoveMember, isMember } from '../lib/team.js';

const DEFAULT_TENANT_ID = process.env.DEFAULT_TENANT_ID || '00000000-0000-0000-0000-000000000001';
const tenantOf = (req) => req.headers['x-tenant-id'] || DEFAULT_TENANT_ID;

async function fetchMembers(tenantId) {
  const { data, error } = await supabase.rpc('get_tenant_members', { p_tenant_id: tenantId });
  if (error) throw error;
  return data || [];
}

// ─── List ─────────────────────────────────────────────────────────────────────
export async function listMembers(req, res) {
  try {
    const members = await fetchMembers(tenantOf(req));
    return res.json({ success: true, members });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}

// ─── Add existing user by email ───────────────────────────────────────────────
export async function addMember(req, res) {
  const tenantId = tenantOf(req);
  const { email, role = 'member' } = req.body || {};

  if (!email) return res.status(400).json({ success: false, error: 'email is required' });
  if (!validateRole(role)) return res.status(400).json({ success: false, error: `invalid role "${role}"` });

  try {
    const { data: userId, error: lookupErr } = await supabase.rpc('get_user_id_by_email', { p_email: email });
    if (lookupErr) throw lookupErr;

    if (!userId) {
      return res.status(404).json({
        success: false,
        code: 'NOT_REGISTERED',
        error: 'No account exists for that email yet. Ask them to sign up first, then add them.',
      });
    }

    const members = await fetchMembers(tenantId);
    if (isMember(members, userId)) {
      return res.status(409).json({ success: false, error: 'That person is already on the team.' });
    }

    const { error: insErr } = await supabase
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
  const tenantId = tenantOf(req);
  const { role } = req.body || {};
  const { userId } = req.params;

  try {
    const members = await fetchMembers(tenantId);
    const check = canChangeRole(members, userId, role);
    if (!check.ok) return res.status(400).json({ success: false, error: check.error });

    const { error } = await supabase
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
  const tenantId = tenantOf(req);
  const { userId } = req.params;

  try {
    const members = await fetchMembers(tenantId);
    const check = canRemoveMember(members, userId);
    if (!check.ok) return res.status(400).json({ success: false, error: check.error });

    const { error } = await supabase
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
