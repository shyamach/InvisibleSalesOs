/**
 * controllers/settings.js — Tenant settings (auto-reply config).
 *
 *   GET   /api/settings/auto-reply  — current auto_reply config (defaults if unset)
 *   PATCH /api/settings/auto-reply  — update (validated + merged onto defaults)
 */
import { supabase } from '../lib/supabase.js';
import { DEFAULT_AUTO_REPLY, validateAutoReplyConfig } from '../lib/autoReply.js';

const DEFAULT_TENANT_ID = process.env.DEFAULT_TENANT_ID || '00000000-0000-0000-0000-000000000001';
const tenantOf = (req) => req.headers['x-tenant-id'] || DEFAULT_TENANT_ID;

export async function getAutoReplySettings(req, res) {
  const { data, error } = await supabase
    .from('tenants')
    .select('auto_reply')
    .eq('id', tenantOf(req))
    .maybeSingle();

  if (error) return res.status(500).json({ success: false, error: error.message });
  return res.json({ success: true, auto_reply: data?.auto_reply ?? DEFAULT_AUTO_REPLY });
}

export async function updateAutoReplySettings(req, res) {
  const v = validateAutoReplyConfig(req.body);
  if (!v.ok) return res.status(400).json({ success: false, error: 'Validation failed', issues: v.issues });

  const { data, error } = await supabase
    .from('tenants')
    .update({ auto_reply: v.data })
    .eq('id', tenantOf(req))
    .select('auto_reply')
    .single();

  if (error) return res.status(500).json({ success: false, error: error.message });
  return res.json({ success: true, auto_reply: data.auto_reply });
}
