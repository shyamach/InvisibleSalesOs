/**
 * controllers/settings.js — Tenant settings (auto-reply config, email IMAP).
 *
 *   GET    /api/settings/auto-reply   — current auto_reply config (defaults if unset)
 *   PATCH  /api/settings/auto-reply   — update (validated + merged onto defaults)
 *   GET    /api/settings/email-imap   — current IMAP config (host/port/username/enabled — never the password)
 *   PATCH  /api/settings/email-imap   — upsert host/port/username/enabled; password (if provided) goes through
 *                                        the vault-backed store_email_imap_password RPC, not a direct column write
 *   DELETE /api/settings/email-imap   — disconnect (revokes the vault secret + deletes the row)
 *
 * Tenant identity comes from req.tenantId (set by requireAuth from the
 * caller's verified JWT) — never from a header/body/query value. Queries run
 * on req.supabase, the per-request client seeded with that JWT, so auth.uid()
 * resolves for RLS; the .eq('id', req.tenantId) filters below stay as
 * defence-in-depth, not the primary authority.
 */
import { DEFAULT_AUTO_REPLY, validateAutoReplyConfig } from '../lib/autoReply.js';
import { createSystemClient } from '../lib/supabase.js';
import { registerTenantConnection, unregisterTenantConnection } from '../lib/emailImapConnections.js';

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

// ─── Email IMAP settings ────────────────────────────────────────────────────

export async function getEmailImapSettings(req, res) {
  if (!requireTenant(req, res)) return;

  const { data, error } = await req.supabase
    .from('email_imap_connections')
    .select('host, port, username, enabled, last_polled_at, last_error')
    .eq('tenant_id', req.tenantId)
    .maybeSingle();

  if (error) return res.status(500).json({ success: false, error: error.message });
  return res.json({ success: true, config: data ?? null });
}

export async function updateEmailImapSettings(req, res) {
  if (!requireTenant(req, res)) return;

  const { host, port, username, enabled, password } = req.body || {};

  if (typeof host !== 'string' || !host.trim()) {
    return res.status(400).json({ success: false, error: 'host is required' });
  }
  if (typeof username !== 'string' || !username.trim()) {
    return res.status(400).json({ success: false, error: 'username is required' });
  }
  const portNum = Number(port) || 993;
  if (!Number.isInteger(portNum) || portNum < 1 || portNum > 65535) {
    return res.status(400).json({ success: false, error: 'port must be a valid port number' });
  }

  const { data, error } = await req.supabase
    .from('email_imap_connections')
    .upsert(
      { tenant_id: req.tenantId, host: host.trim(), port: portNum, username: username.trim(), enabled: enabled !== false },
      { onConflict: 'tenant_id' }
    )
    .select('host, port, username, enabled')
    .single();

  if (error) return res.status(500).json({ success: false, error: error.message });

  // Password goes through the vault-backed RPC, not a direct column write —
  // only touch it when the caller actually sent one (an empty field on
  // re-save shouldn't clobber an already-stored password).
  if (typeof password === 'string' && password.length > 0) {
    const { error: pwError } = await createSystemClient(req.tenantId)
      .rpc('store_email_imap_password', { p_tenant_id: req.tenantId, p_password: password });
    if (pwError) return res.status(500).json({ success: false, error: pwError.message });
  }

  if (data.enabled) {
    registerTenantConnection(req.tenantId, { host: data.host, port: data.port, username: data.username });
  } else {
    unregisterTenantConnection(req.tenantId);
  }

  return res.json({ success: true, config: data });
}

export async function deleteEmailImapSettings(req, res) {
  if (!requireTenant(req, res)) return;

  const { error } = await createSystemClient(req.tenantId)
    .rpc('revoke_email_imap_password', { p_tenant_id: req.tenantId });

  if (error) return res.status(500).json({ success: false, error: error.message });

  unregisterTenantConnection(req.tenantId);
  return res.json({ success: true });
}
