-- phase_j_1_email_imap_connections
--
-- APPLIED 2026-08-24 via the Supabase MCP `apply_migration` tool, version
-- `20260824124444`. Reviewed by security-lead and database-lead (two
-- rounds each — see DB_AUDIT_REPORT.md's numbered section for full detail,
-- including a `get_advisors` post-apply check confirming no new/unexpected
-- findings and none of the four new functions anon-executable).
--
-- Per-tenant email (IMAP) configuration (2026-08-24). lib/emailListener.js
-- currently polls ONE IMAP mailbox for the entire backend via global env
-- vars (EMAIL_IMAP_HOST/PORT/USER/PASS) and its message handler hardcodes
-- TENANT_ID = DEFAULT_TENANT_ID (server.js:591) — the same misattribution
-- bug class the WhatsApp session-isolation fix closed earlier this session
-- (see DB_AUDIT_REPORT.md's WhatsApp section and
-- decision_whatsapp_multitenant_isolation memory). CTO-agent reviewed the
-- fork between building this out now vs. prioritizing the already-designed
-- Gmail OAuth2 path (phase_g_1_gmail_oauth_connections, applied 2026-08-22
-- but with zero application code, zero frontend, and the Google Cloud
-- Console OAuth app itself unregistered — a real external, business-owner-
-- only blocker) and ruled: build per-tenant IMAP now, defer Gmail OAuth.
--
-- Table: one IMAP config per tenant. password_secret_id is a vault pointer
-- (supabase_vault, already installed) — the password itself is never
-- stored in a plain column. Modeled on email_oauth_connections'
-- refresh_token_secret_id, same reasoning: exposing the pointer via normal
-- SELECT is safe (it's inert without the claim-gated RPC below), matching
-- that table's own precedent.
--
-- RLS: plain tenant-scoped SELECT/INSERT/UPDATE for host/port/username/
-- enabled (an authenticated tenant member should be able to see and edit
-- their own non-secret config directly, same as brand_dna/auto_reply) --
-- INSERT+UPDATE both needed since the settings endpoint upserts
-- (onConflict: 'tenant_id'), matching phase_h_3's brand_dna precedent.
-- Only the password itself requires the RPC/vault path below.
--
-- IMPORTANT — do NOT copy phase_g_1's grant shape for the two RPCs below.
-- phase_g_1's store_gmail_refresh_token()/get_gmail_refresh_token() are
-- service_role-only, but this codebase has NO service_role key anywhere
-- (confirmed against lib/supabase.js — every backend caller uses the anon
-- key + a self-minted role:'authenticated' JWT via createSystemClient()/
-- mintSystemToken()), so that grant shape is uncallable here (found while
-- researching this exact migration — see the 2026-08-24 correction in the
-- project_gmail_oauth_migration memory). Use the proven-live pattern from
-- phase_i_1_whatsapp_sessions_write_policies.sql instead: grant to
-- authenticated, gate the function body on mintSystemToken()'s
-- purpose:'system-worker' JWT claim, explicit revoke from public/anon.
--
-- Also adds list_enabled_email_imap_connections(), a claim-gated cross-
-- tenant RPC used once at backend boot (lib/emailImapConnections.js) to
-- discover every tenant with IMAP enabled and seed the in-memory polling
-- registry — same reasoning and same pattern as
-- get_active_whatsapp_sessions() in phase_i_1: this read has no single
-- legitimate tenant caller by nature (it's discovering which tenants exist,
-- not reading one tenant's own data). Returns host/port/username only —
-- no password, no vault access.
--
-- database-lead review (2026-08-24) found two required fixes and one
-- recommended hardening, applied here:
--   1. store_email_imap_password's original bare UPDATE could silently
--      no-op (mint a vault secret, return a uuid, persist nothing) if no
--      row existed yet for that tenant — exactly the orphaned-secret class
--      of bug this migration's own vault-pointer design exists to avoid.
--      Current call sites always upsert the row first so this never
--      misfires today, but a future caller/retry/refactor could silently
--      drop a password. Now raises if the UPDATE matches zero rows.
--   2. Missing the updated_at auto-update trigger phase_g_1 (this table's
--      own modeled precedent) explicitly added to close a standing,
--      separately-tracked debt item — this table would have quietly
--      reintroduced it. Added below, using the already-live set_updated_at().
--   3. (Recommended, not required, applied anyway since it's cheap while
--      already in the file.) The three tenant-parameterized RPCs
--      (store_/get_/revoke_) checked "is this a system-worker token" but
--      not "does the token's OWN app_tenant_id claim match the p_tenant_id
--      argument" — unlike get_active_whatsapp_sessions()/
--      list_enabled_email_imap_connections(), which take no tenant
--      parameter at all so had nothing to mismatch. Not live-exploitable
--      (every real call site mints the token for the same tenant it
--      passes), but this table holds passwords, not just connection
--      status, so the extra claim check is worth having rather than
--      relying on caller discipline alone.
--
-- Rollback:
--   DROP POLICY IF EXISTS tenant_select_email_imap_connections ON email_imap_connections;
--   DROP POLICY IF EXISTS tenant_insert_email_imap_connections ON email_imap_connections;
--   DROP POLICY IF EXISTS tenant_update_email_imap_connections ON email_imap_connections;
--   DROP TRIGGER IF EXISTS trg_email_imap_connections_updated_at ON email_imap_connections;
--   DROP FUNCTION IF EXISTS store_email_imap_password(uuid, text);
--   DROP FUNCTION IF EXISTS get_email_imap_password(uuid);
--   DROP FUNCTION IF EXISTS revoke_email_imap_password(uuid);
--   DROP FUNCTION IF EXISTS list_enabled_email_imap_connections();
--   DROP TABLE IF EXISTS email_imap_connections;

create table public.email_imap_connections (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null unique references public.tenants(id) on delete cascade,
  host text,
  port integer,
  username text,
  password_secret_id uuid, -- pointer into vault.secrets; never the password itself
  enabled boolean not null default true,
  last_polled_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.email_imap_connections enable row level security;

create policy tenant_select_email_imap_connections
  on public.email_imap_connections
  for select
  to authenticated
  using (tenant_id = auth_tenant_id());

create policy tenant_insert_email_imap_connections
  on public.email_imap_connections
  for insert
  to authenticated
  with check (tenant_id = auth_tenant_id());

create policy tenant_update_email_imap_connections
  on public.email_imap_connections
  for update
  to authenticated
  using (tenant_id = auth_tenant_id())
  with check (tenant_id = auth_tenant_id());

create trigger trg_email_imap_connections_updated_at
  before update on public.email_imap_connections
  for each row
  execute function set_updated_at();

-- ── store_email_imap_password — settings PATCH's password write path ───────
create or replace function store_email_imap_password(p_tenant_id uuid, p_password text)
returns uuid
language plpgsql
security definer
set search_path = public, vault, pg_temp
as $$
declare
  v_existing_secret_id uuid;
  v_secret_id uuid;
begin
  if coalesce(current_setting('request.jwt.claims', true)::json ->> 'purpose', '') != 'system-worker' then
    raise exception 'store_email_imap_password: caller is not a trusted backend worker';
  end if;
  if coalesce(current_setting('request.jwt.claims', true)::json ->> 'app_tenant_id', '') != p_tenant_id::text then
    raise exception 'store_email_imap_password: token tenant does not match requested tenant';
  end if;

  select password_secret_id into v_existing_secret_id
  from public.email_imap_connections
  where tenant_id = p_tenant_id;

  if v_existing_secret_id is not null then
    perform vault.update_secret(
      v_existing_secret_id,
      p_password,
      'email_imap_password:' || p_tenant_id::text
    );
    v_secret_id := v_existing_secret_id;
  else
    v_secret_id := vault.create_secret(
      p_password,
      'email_imap_password:' || p_tenant_id::text
    );
  end if;

  update public.email_imap_connections
  set password_secret_id = v_secret_id, updated_at = now()
  where tenant_id = p_tenant_id;

  if not found then
    raise exception 'store_email_imap_password: no email_imap_connections row for tenant %; create it via the settings upsert first', p_tenant_id;
  end if;

  return v_secret_id;
end;
$$;

revoke execute on function store_email_imap_password(uuid, text) from public;
revoke execute on function store_email_imap_password(uuid, text) from anon;
grant execute on function store_email_imap_password(uuid, text) to authenticated;

-- ── get_email_imap_password — poller's read path ────────────────────────────
create or replace function get_email_imap_password(p_tenant_id uuid)
returns text
language plpgsql
security definer
set search_path = public, vault, pg_temp
as $$
declare
  v_password text;
begin
  if coalesce(current_setting('request.jwt.claims', true)::json ->> 'purpose', '') != 'system-worker' then
    return null;
  end if;
  if coalesce(current_setting('request.jwt.claims', true)::json ->> 'app_tenant_id', '') != p_tenant_id::text then
    return null;
  end if;

  select vs.decrypted_secret into v_password
  from public.email_imap_connections c
  join vault.decrypted_secrets vs on vs.id = c.password_secret_id
  where c.tenant_id = p_tenant_id;

  return v_password;
end;
$$;

revoke execute on function get_email_imap_password(uuid) from public;
revoke execute on function get_email_imap_password(uuid) from anon;
grant execute on function get_email_imap_password(uuid) to authenticated;

-- ── revoke_email_imap_password — settings DELETE/disconnect path ───────────
-- A plain RLS DELETE on the row can't clean up the vault.secrets row it
-- points to (no reverse FK/cascade), same reasoning as phase_g_1's
-- revoke_gmail_connection(). Deletes the vault secret and the connection
-- row together.
create or replace function revoke_email_imap_password(p_tenant_id uuid)
returns void
language plpgsql
security definer
set search_path = public, vault, pg_temp
as $$
declare
  v_secret_id uuid;
begin
  if coalesce(current_setting('request.jwt.claims', true)::json ->> 'purpose', '') != 'system-worker' then
    raise exception 'revoke_email_imap_password: caller is not a trusted backend worker';
  end if;
  if coalesce(current_setting('request.jwt.claims', true)::json ->> 'app_tenant_id', '') != p_tenant_id::text then
    raise exception 'revoke_email_imap_password: token tenant does not match requested tenant';
  end if;

  select password_secret_id into v_secret_id
  from public.email_imap_connections
  where tenant_id = p_tenant_id;

  delete from public.email_imap_connections where tenant_id = p_tenant_id;

  if v_secret_id is not null then
    delete from vault.secrets where id = v_secret_id;
  end if;
end;
$$;

revoke execute on function revoke_email_imap_password(uuid) from public;
revoke execute on function revoke_email_imap_password(uuid) from anon;
grant execute on function revoke_email_imap_password(uuid) to authenticated;

-- ── list_enabled_email_imap_connections — boot-time rehydration ────────────
create or replace function list_enabled_email_imap_connections()
returns table (tenant_id uuid, host text, port integer, username text)
language sql
security definer
set search_path = public, pg_temp
as $$
  select c.tenant_id, c.host, c.port, c.username
  from public.email_imap_connections c
  where c.enabled = true
    and c.host is not null
    and c.username is not null
    and c.password_secret_id is not null
    and coalesce(current_setting('request.jwt.claims', true)::json ->> 'purpose', '') = 'system-worker';
$$;

revoke execute on function list_enabled_email_imap_connections() from public;
revoke execute on function list_enabled_email_imap_connections() from anon;
grant execute on function list_enabled_email_imap_connections() to authenticated;
