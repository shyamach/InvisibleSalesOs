-- phase_i_1_whatsapp_sessions_write_policies
--
-- APPLIED 2026-08-24 via the Supabase MCP `apply_migration` tool, version
-- `20260824094801`. Reviewed by security-lead and database-lead (two
-- rounds each — see DB_AUDIT_REPORT.md Section 42 for full detail,
-- including a `get_advisors` post-apply check and a live write-path test
-- confirming the RLS-blocked write this migration fixes now succeeds).
--
-- Part of the per-tenant WhatsApp session-isolation fix (2026-08-23,
-- security-lead SHOWSTOPPER finding): server.js used to run one shared
-- whatsapp-web.js session for every tenant. lib/whatsappSessions.js now
-- keys each tenant's Client by clientId and persists status/phone_number to
-- this table via createSystemClient(tenantId) — an anon-key client seeded
-- with a per-tenant JWT (see lib/supabase.js#mintSystemToken), always
-- RLS-enforced, since no service-role key exists anywhere in this codebase.
--
-- `whatsapp_sessions` has had a SELECT-only policy since phase_d_1
-- (whatsapp_sessions_tenant_select, tenant_id = auth_tenant_id(), no
-- dev-fallback branch — that was dropped repo-wide in phase_d_3). Nothing
-- has ever written to this table: the wwebjs client had zero DB interaction
-- before this fix (auth was purely LocalAuth's on-disk session). Add
-- INSERT/UPDATE policies so lib/whatsappSessions.js's writes succeed,
-- matching the "one policy per command" pattern already used for
-- brand_dna (phase_h_3) and every other tenant-scoped table since Phase D.
--
-- Also adds get_active_whatsapp_sessions(), a SECURITY DEFINER RPC used
-- once at backend boot (lib/whatsappSessions.js#rehydrateSessions) to
-- reconnect every previously-connected tenant's session. That read is
-- inherently cross-tenant (it doesn't know which tenants had active
-- sessions yet — that's what it's discovering), so it can't go through the
-- normal per-tenant createSystemClient(tenantId) path the way single-tenant
-- reads/writes do; a plain RLS-scoped SELECT would only ever return the one
-- tenant whose JWT happened to be minted to make the call. Returns only
-- tenant_id + status — no phone numbers, no session material — and is
-- never exposed as a public HTTP route.
--
-- database-lead review (2026-08-23) caught that an earlier draft of this
-- function, gated only by `grant execute ... to authenticated`, was a real
-- cross-tenant leak: every backend-minted system JWT (mintSystemToken(),
-- lib/supabase.js) carries Postgres role `authenticated` — the SAME role a
-- real logged-in tenant's own session carries, since no service_role key
-- exists anywhere in this codebase. The GRANT alone can't tell a trusted
-- boot-time caller apart from any real customer hitting
-- /rest/v1/rpc/get_active_whatsapp_sessions directly with their own,
-- legitimately-held session token — which would hand back every tenant's
-- id + WhatsApp status, a full client-roster/connection-state leak. (An
-- initially-cited precedent, phase_g_1's Gmail OAuth RPCs, does NOT apply
-- here — those are correctly `to service_role`/`postgres` with an explicit
-- `revoke ... from authenticated`, the opposite grantee shape, and were
-- also found to have zero real app-code callers, so they were never a
-- proven-safe pattern for this table to imitate.)
--
-- Fix: gate the function body itself on mintSystemToken()'s existing
-- `purpose: 'system-worker'` JWT claim (already stamped on every
-- system-minted token, lib/supabase.js — confirmed no other code sets this
-- claim and no custom access-token hook exists in this project that could
-- inject it into a real user's session). The GRANT stays `to authenticated`
-- (still required for the system-token call itself to succeed), but the
-- claim check is the actual access-control boundary, not the grant —
-- fails closed to an empty result set for any real user session, which
-- carries no `purpose` claim at all.
--
-- Explicit REVOKE added below (from public, from anon) per both reviewers'
-- independent follow-up: Postgres auto-grants EXECUTE on every new
-- function to anon/authenticated/service_role/postgres via the schema's
-- default ACL at creation time, so the `grant ... to authenticated` line
-- alone is not exclusive — without an explicit revoke, anon would also
-- retain default EXECUTE (able to CALL the function, though the
-- purpose-claim guard above still returns it an empty result either way).
-- Belt-and-suspenders, not the sole protection.
--
-- Rollback:
--   DROP POLICY IF EXISTS tenant_insert_whatsapp_sessions ON whatsapp_sessions;
--   DROP POLICY IF EXISTS tenant_update_whatsapp_sessions ON whatsapp_sessions;
--   DROP FUNCTION IF EXISTS get_active_whatsapp_sessions();

create policy tenant_insert_whatsapp_sessions
  on public.whatsapp_sessions
  for insert
  to authenticated
  with check (tenant_id = auth_tenant_id());

create policy tenant_update_whatsapp_sessions
  on public.whatsapp_sessions
  for update
  to authenticated
  using (tenant_id = auth_tenant_id())
  with check (tenant_id = auth_tenant_id());

create or replace function get_active_whatsapp_sessions()
returns table (tenant_id uuid, status text)
language sql
security definer
set search_path = public, pg_temp
as $$
  select w.tenant_id, w.status
  from public.whatsapp_sessions w
  where w.status in ('awaiting_scan', 'connected')
    and coalesce(current_setting('request.jwt.claims', true)::json ->> 'purpose', '') = 'system-worker';
$$;

revoke execute on function get_active_whatsapp_sessions() from public;
revoke execute on function get_active_whatsapp_sessions() from anon;
grant execute on function get_active_whatsapp_sessions() to authenticated;
