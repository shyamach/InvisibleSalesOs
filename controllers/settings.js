/**
 * controllers/settings.js — Tenant settings (auto-reply config).
 *
 *   GET   /api/settings/auto-reply  — current auto_reply config (defaults if unset)
 *   PATCH /api/settings/auto-reply  — update (validated + merged onto defaults)
 *
 * Tenant identity comes from req.tenantId (set by requireAuth from the
 * caller's verified JWT) — never from a header/body/query value. Queries run
 * on req.supabase, the per-request client seeded with that JWT, so auth.uid()
 * resolves for RLS; the .eq('id', req.tenantId) filters below stay as
 * defence-in-depth, not the primary authority.
 */
import { DEFAULT_AUTO_REPLY, validateAutoReplyConfig } from '../lib/autoReply.js';

function requireTenant(req, res) {
  if (req.tenantId) return true;
  res.status(403).json({ success: false, error: 'No tenant associated with this account' });
  return false;
}

export async function getAutoReplySettings(req, res) {
  if (!requireTenant(req, res)) return;

  const { data, error } = await req.supabase
    .from('tenants')
    .select('auto_reply')
    .eq('id', req.tenantId)
    .maybeSingle();

  if (error) return res.status(500).json({ success: false, error: error.message });
  return res.json({ success: true, auto_reply: data?.auto_reply ?? DEFAULT_AUTO_REPLY });
}

export async function updateAutoReplySettings(req, res) {
  if (!requireTenant(req, res)) return;

  const v = validateAutoReplyConfig(req.body);
  if (!v.ok) return res.status(400).json({ success: false, error: 'Validation failed', issues: v.issues });

  const { data, error } = await req.supabase
    .from('tenants')
    .update({ auto_reply: v.data })
    .eq('id', req.tenantId)
    .select('auto_reply')
    .single();

  if (error) return res.status(500).json({ success: false, error: error.message });
  return res.json({ success: true, auto_reply: data.auto_reply });
}
