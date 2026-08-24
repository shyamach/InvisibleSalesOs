-- phase_g_1_gmail_oauth_connections
--
-- DRAFT ONLY — NOT YET APPLIED. Do not run against Supabase without explicit
-- Command Room approval (apply via the Supabase MCP `apply_migration` tool,
-- then update DB_AUDIT_REPORT.md's "Migrations Applied Summary" table).
--
-- Phase G, step 1 — credential storage for multi-tenant Gmail OAuth2 email
-- ingestion, replacing the throttled/hanging app-password IMAP approach
-- (DB_AUDIT_REPORT.md Section 34 and its same-day updates: a raw-socket
-- diagnostic isolated the IMAP hang to Gmail-side flagging of this app's
-- connection pattern, not a code or credential bug — OAuth2 sidesteps that
-- failure mode entirely by never using an app password). "Phase G" is this
-- reviewer's own next-letter inference from the existing A / B(tracked) /
-- C(tracked) / D / E / F sequence (DB_AUDIT_REPORT.md Sections 23-38) — no
-- Phase G exists anywhere yet (confirmed by grep). Rename the file if a
-- different phase label has already been assigned elsewhere.
--
-- security-lead was consulted specifically on credential storage for this
-- feature, given the codebase's standing known gap "unencrypted third-party
-- credential storage" (stack_and_architecture memory: confirmed live, no
-- Supabase Vault usage found anywhere prior to this migration). This is the
-- first real use of Vault in this project. Their design is implemented
-- below with four changes from their original draft, each explained at its
-- own step below:
--   1. store_gmail_refresh_token() REUSES the existing vault secret on
--      reconnect (vault.update_secret) instead of minting a new one every
--      time (vault.create_secret) — the original shape would silently
--      orphan one still-decryptable vault.secrets row per reconnect,
--      forever, since vault.create_secret() has no paired "delete the old
--      one" step.
--   2. No direct INSERT or DELETE RLS policy on the table — both go
--      through SECURITY DEFINER RPCs only, matching this repo's own
--      `tenants`/`stock_movements` precedent for exactly this class of
--      risk (a working-but-unnecessary direct-write path with no
--      legitimate caller, or one that can silently orphan a paired
--      resource). SELECT/UPDATE are kept as plain RLS — see the WHY notes
--      inline below for why the four commands are not treated uniformly.
--   3. Added `revoke_gmail_connection()` — the consult required
--      "revocation alongside creation, not deferred" but only described it
--      in prose; this migration gives it an actual callable implementation.
--   4. Explicit table-level REVOKE of the privileges Supabase's own
--      project-level default-privilege rule auto-grants anon/authenticated
--      on every new table (see the CONFIRMED LIVE finding below) — the
--      consult's draft didn't mention table grants at all, only function
--      grants.
-- Also restyled from the consult's lowercase SQL to this repo's established
-- uppercase-keyword DDL convention, and from combined-grantee GRANT/REVOKE
-- lists to this repo's one-role-per-statement style (see
-- phase_1_12c_bootstrap_tenant_rpc_grant_correction.sql) — no logic changed
-- by either pass.
--
-- CONFIRMED LIVE before drafting this (2026-08-22, direct introspection via
-- the Supabase MCP tools, not assumed from the consult or from memory):
--   - `vault` extension (`supabase_vault`, 0.3.1) and `pgcrypto` (1.3) are
--     both already installed (`list_extensions`) — no extension work
--     needed. `tenants.id` and every existing tenant_id FK in this schema
--     default via `gen_random_uuid()` (pgcrypto), not `uuid_generate_v4()`
--     (uuid-ossp is installed but unused for this) — matched below.
--   - `vault.secrets` / `vault.decrypted_secrets` table grants are
--     `postgres` and `service_role` ONLY (`information_schema.role_table_
--     grants`) — `anon`/`authenticated` have zero table-level privilege on
--     either. `vault.create_secret` / `vault.update_secret` EXECUTE is
--     likewise `postgres` + `service_role` only. This means the REVOKE/
--     GRANT on the three wrapper functions below is the ENTIRE enforcement
--     boundary for who can reach decrypted token material, exactly as the
--     consult's design says — there is no RLS backstop on `vault.*` itself
--     to fall back on if a grant is ever wrong, which is exactly why the
--     next finding matters so much:
--   - **`pg_default_acl` for schema `public`, object type `f` (functions),
--     grantor `postgres`, is LIVE TODAY as
--     `{postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,
--     service_role=X/postgres}`** — i.e. Postgres auto-grants EXECUTE to
--     ALL FOUR roles, including anon and authenticated, on every new
--     function created in `public` by `postgres`, at CREATE FUNCTION time,
--     before any REVOKE in the same migration file runs. This is not
--     theoretical: it is the exact, confirmed root cause documented in
--     phase_1_12c_bootstrap_tenant_rpc_grant_correction.sql — that
--     migration's REVOKE only named `PUBLIC`, not `anon`/`service_role` by
--     name, and post-apply verification found both still had live EXECUTE
--     on a function meant to be `authenticated`+`postgres`-only. The same
--     default-privilege rule ALSO applies to object type `r` (relations) —
--     `{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,
--     authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}` —
--     meaning every new TABLE created in `public` by `postgres` similarly
--     auto-grants anon and authenticated full table-level privileges
--     (SELECT/INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER/MAINTAIN),
--     regardless of what a later GRANT statement adds. Every REVOKE
--     statement in this migration — on the table and on all three
--     functions — exists because of this confirmed, live, systemic
--     behavior, not as generic best-practice padding.
--   - `get_advisors(security)` currently flags exactly 5 SECURITY DEFINER
--     functions as `authenticated`-executable (`apply_stock_movement`,
--     `auth_tenant_id`, `bootstrap_tenant`, `get_tenant_members`,
--     `get_user_id_by_email`) — matches the consult's "don't add a 6th"
--     framing exactly. None of the three functions this migration adds are
--     meant to join that list; see the POST-APPLY VERIFICATION note near
--     the bottom.
--   - No `email_oauth_connections` table, and no Gmail/Google-API-ingestion
--     code, exists anywhere in the repo yet (`list_tables`; repo-wide
--     grep) — this is genuinely new surface, not a refactor of something
--     partial. The only existing Google references are Supabase-Auth
--     "Sign in with Google" (`server.js`, `AuthProvider.tsx`,
--     `complete-profile/page.tsx`) — an unrelated login flow, not the
--     Gmail API this table backs.
--
-- SEQUENCING (per the consult): this migration is a hard blocker for the
-- OAuth callback handler that persists a refresh token, but NOT a blocker
-- for Google Cloud Console app registration or Gmail REST API integration
-- work — those can proceed in parallel against this file's review.
--
-- WHAT THIS DOES:
--   1. Creates `email_oauth_connections` — one row per tenant-connected
--      Gmail inbox. Never stores the refresh token itself; only a pointer
--      (`refresh_token_secret_id`) into `vault.secrets`.
--   2. Locks table-level grants down to exactly what the RLS design
--      intends (SELECT + UPDATE for `authenticated`, nothing for `anon`),
--      explicitly undoing the default-privilege auto-grant described
--      above. `phase_f_1_system_logs_table.sql` did not do this for
--      `system_logs` — safe there too because RLS default-denies any
--      command with zero matching policies regardless of the table grant,
--      same as here, but this table is the one directly holding a pointer
--      to live third-party credentials, and this project has a confirmed
--      history of intended-vs-actual grant drift on exactly this
--      mechanism, so the extra explicitness is judged worth it here even
--      though it goes one step further than the most recent precedent.
--   3. Enables RLS with exactly two policies — SELECT and UPDATE, both
--      scoped to `tenant_id = auth_tenant_id()` (no dev-fallback branch;
--      Phase D already closed that pattern out repo-wide, Section 28).
--      UPDATE also carries a matching WITH CHECK, so a tenant can never
--      move their own row's `tenant_id` out from under their own scope —
--      same defensive shape as `smart_interactions_tenant_update`
--      (Section 19). No INSERT or DELETE policy — see the WHY note below.
--   4. Adds the `set_updated_at()` trigger — the existing shared trigger
--      function every other `updated_at`-bearing table added under Phase 1
--      uses (`contacts`, `products`, `escalations`) — closing this table
--      off from DB_AUDIT_REPORT.md's standing item 8 (`updated_at` columns
--      with no auto-update trigger) from day one instead of adding to it.
--   5. Adds three SECURITY DEFINER functions, `service_role`-only:
--        a. `store_gmail_refresh_token(tenant_id, email, token, scopes)` —
--           the OAuth callback handler's write path. Reuses the existing
--           vault secret via `vault.update_secret()` on reconnect instead
--           of minting a new one via `vault.create_secret()` every time —
--           see change 1 above and the function's own comment.
--        b. `get_gmail_refresh_token(tenant_id)` — the sync job's read
--           path. Joins to `vault.decrypted_secrets`; never called
--           directly by `authenticated`.
--        c. `revoke_gmail_connection(tenant_id, connection_id)` — the
--           disconnect flow's DB-teardown path (new in this review; see
--           change 3 above). Deletes both the `vault.secrets` row and the
--           connection row together. Does NOT call Google's own revoke
--           endpoint — that is an outbound HTTP call the database cannot
--           make here (the `http` extension is available in this project
--           but not installed, and installing it is out of scope) — that
--           half of revocation stays app-code's responsibility, exactly as
--           the consult specified.
--
-- WHY NO DIRECT INSERT/DELETE POLICY (departure from the consult's draft,
-- which had all four CRUD policies): the browser never holds a refresh
-- token to begin with — the OAuth callback exchange happens server-side —
-- so there is no legitimate caller for a raw `INSERT INTO
-- email_oauth_connections` from an `authenticated` session; every real
-- write must originate from a real Google token exchange, which only
-- `store_gmail_refresh_token()` can turn into a row. A working-but-unused
-- direct-INSERT path is attack surface with no offsetting benefit, so it
-- is not added — same reasoning `tenants` already applies (no INSERT
-- policy; `bootstrap_tenant()` is the only path in). DELETE is withheld
-- for a sharper reason: a raw `DELETE FROM email_oauth_connections` (which
-- the consult's `email_oauth_connections_tenant_delete` policy would have
-- allowed directly from the browser) removes the connection row but has no
-- way to also delete the `vault.secrets` row it pointed to — nothing in
-- Postgres cascades from a child row's deletion back to a foreign key it
-- merely held a matching value for (CASCADE only ever propagates
-- parent-to-child, never the reverse), so that path would silently orphan
-- a live, decryptable refresh token in Vault forever. Routing DELETE
-- through `revoke_gmail_connection()` instead closes that off structurally
-- rather than relying on every future caller remembering to do both steps
-- in the right order — same shape as `stock_movements` withholding
-- UPDATE/DELETE entirely to keep the ledger append-only (Section 9).
--
-- WHY THE UPDATE POLICY IS KEPT AS PLAIN RLS (not routed through an RPC
-- like INSERT/DELETE): background sync jobs need to write `status`/
-- `last_error`/`last_synced_at` on every poll, running as a per-tenant
-- system-JWT client (`role: authenticated`, Phase D's `app_tenant_id`
-- claim, Section 25) — a real, necessary, high-frequency direct-table-
-- write path, unlike INSERT/DELETE which have no legitimate non-RPC caller
-- at all. `refresh_token_secret_id` is technically still writable through
-- this same UPDATE grant (Postgres RLS gates rows, not columns), but the
-- realistic worst case is a tenant pointing their OWN row at a
-- non-existent id, or — only if they already separately know it through
-- some other leak — another tenant's real secret id; this UPDATE path
-- itself is not a way to discover a secret id they don't already have, and
-- WITH CHECK still keeps the row inside their own tenant scope either way.
-- Judged not worth introducing column-level GRANTs (a pattern not used
-- anywhere else in this schema) to close off a self-harm-at-worst
-- residual; flagged here rather than left undocumented.
--
-- OUT OF SCOPE — deliberately NOT done here:
--   - The Google OAuth client ID/secret (the Cloud Console app
--     registration — one value per environment, not per tenant) is a
--     different, separate secret. It belongs in `.env.local` as
--     `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET` (same trust
--     tier as `INTERNAL_API_KEY`), not Vault — Vault is for the per-tenant
--     row secret specifically. Do not confuse with the existing
--     `GOOGLE_CREDENTIALS_BASE64` (`sheets.js`'s unrelated service-account
--     credential for the Sheets backup). No action for either here;
--     app-code/env concern.
--   - Access tokens are never persisted anywhere, by design — minted from
--     the refresh token per sync job, held in process memory only,
--     discarded after. No column for one exists in this table.
--   - Google's own `/revoke` HTTP endpoint is not called by anything in
--     this migration — app-code's responsibility, see step 5c above.
--   - `whatsapp_sessions.session_data`'s plaintext-column storage
--     (currently dormant, 0 rows, not a live leak) is the same
--     anti-pattern this migration avoids for Gmail — flagged again here as
--     a pointer, not fixed; worth its own migration before WhatsApp
--     session persistence goes live, tracked separately.
--   - No FK from `refresh_token_secret_id` to `vault.secrets(id)` — adding
--     one would only help the wrong direction anyway (FK CASCADE only
--     propagates parent-deleted → child-deleted, never the reverse we'd
--     actually want on disconnect), and a tenant hard-delete code path
--     doesn't appear to exist anywhere in this codebase today, so the
--     residual risk this leaves (tenant deleted → `ON DELETE CASCADE`
--     removes the connection row, but nothing cleans up its orphaned
--     `vault.secrets` row) is currently theoretical, not live. Worth a
--     trigger-based fix if/when real tenant hard-delete ships.
--   - No `provider` column in the UNIQUE constraint (`UNIQUE (tenant_id,
--     email_address)`, not `(tenant_id, provider, email_address)`) —
--     considered and rejected: a live mailbox address is inherently
--     provider-specific (it cannot simultaneously be a real Gmail inbox
--     and a real Outlook inbox on two different providers), so the extra
--     column would guard against a case that cannot occur.
--   - No `lower(email_address)` normalization on the unique constraint
--     (unlike `products.sku`, which does normalize) — the value's
--     provenance is Google's own OAuth id-token `email` claim, not
--     free-typed user input, and Google returns the same canonical casing
--     for a given account on every consent — the collision this would
--     guard against isn't reachable from how this column is populated.
--
-- POST-APPLY VERIFICATION — treat as required, not optional, given the
-- confirmed live `pg_default_acl` finding above: after `apply_migration`,
-- re-run `get_advisors(type=security)` and separately query
-- `information_schema.routine_privileges` / `role_table_grants` for
-- `email_oauth_connections` and all three new functions. Expected end
-- state: `anon` has NO privilege on the table or any of the three
-- functions; `authenticated` has exactly SELECT+UPDATE on the table and NO
-- EXECUTE on any of the three functions; `service_role` (+`postgres`) has
-- EXECUTE on all three functions. If verification finds anon/authenticated
-- still holding anything beyond that, this is the same class of gap
-- `phase_1_12c_bootstrap_tenant_rpc_grant_correction.sql` fixed after the
-- fact for `bootstrap_tenant` — the fix is a narrow grant-correction
-- follow-up migration naming the exact excess grant, not a redo of this
-- file.
--
-- Rollback:
--   DROP FUNCTION IF EXISTS public.revoke_gmail_connection(uuid, uuid);
--   DROP FUNCTION IF EXISTS public.get_gmail_refresh_token(uuid);
--   DROP FUNCTION IF EXISTS public.store_gmail_refresh_token(uuid, text, text, text[]);
--   DROP TABLE IF EXISTS public.email_oauth_connections;
--   -- Vault secrets already created by real use are NOT cleaned up by this
--   -- rollback — they become orphaned but harmless (no code path left that
--   -- can reach them once the functions above are dropped); delete them
--   -- from vault.secrets explicitly first if a clean rollback matters.

-- ── 1. Table ────────────────────────────────────────────────────────────
CREATE TABLE public.email_oauth_connections (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                 UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  provider                  TEXT NOT NULL DEFAULT 'gmail' CHECK (provider IN ('gmail')),
  email_address             TEXT NOT NULL,
  refresh_token_secret_id   UUID NOT NULL, -- points into vault.secrets(id); NEVER the token itself
  scopes                    TEXT[] NOT NULL DEFAULT ARRAY['https://www.googleapis.com/auth/gmail.readonly'],
  status                    TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked', 'error')),
  last_synced_at            TIMESTAMPTZ,
  last_error                TEXT,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, email_address)
);

COMMENT ON TABLE public.email_oauth_connections IS
  'One row per tenant-connected Gmail inbox (OAuth2). refresh_token_secret_id is a pointer into vault.secrets -- the refresh token itself is never stored here. Rows are written/removed only via store_gmail_refresh_token()/revoke_gmail_connection(); status/last_synced_at/last_error are written directly by tenant-scoped sync jobs under normal RLS.';

-- The implicit unique-constraint index on (tenant_id, email_address)
-- already covers the only real query shape this table serves ("list my
-- connected inboxes for tenant X") -- no additional index added.

-- Undo the default-privilege auto-grant described above before RLS is even
-- enabled, so the table never has a moment where anon/authenticated hold
-- more than intended.
REVOKE ALL ON public.email_oauth_connections FROM PUBLIC;
REVOKE ALL ON public.email_oauth_connections FROM anon;
REVOKE ALL ON public.email_oauth_connections FROM authenticated;
GRANT SELECT, UPDATE ON public.email_oauth_connections TO authenticated;

ALTER TABLE public.email_oauth_connections ENABLE ROW LEVEL SECURITY;

-- Settings-page "list my connected inboxes" read. No column-level
-- restriction is needed: refresh_token_secret_id is an inert pointer
-- without EXECUTE on get_gmail_refresh_token(), which authenticated never
-- receives (see step 3 below).
CREATE POLICY email_oauth_connections_tenant_select ON public.email_oauth_connections
  FOR SELECT
  USING (tenant_id = auth_tenant_id());

-- Sync-job status writebacks (status / last_synced_at / last_error). See
-- "WHY THE UPDATE POLICY IS KEPT AS PLAIN RLS" above for why this one
-- command gets a plain policy while INSERT/DELETE do not.
CREATE POLICY email_oauth_connections_tenant_update ON public.email_oauth_connections
  FOR UPDATE
  USING (tenant_id = auth_tenant_id())
  WITH CHECK (tenant_id = auth_tenant_id());

-- No INSERT policy -- all row creation goes through store_gmail_refresh_
-- token() (SECURITY DEFINER, service_role-only), which bypasses RLS via
-- its own owner privileges. Matches the `tenants` table's
-- bootstrap_tenant()-only precedent.
--
-- No DELETE policy -- all teardown goes through revoke_gmail_connection()
-- (SECURITY DEFINER, service_role-only), which deletes the vault secret
-- and the connection row together. See the WHY note above.

CREATE TRIGGER trg_email_oauth_connections_updated_at
  BEFORE UPDATE ON public.email_oauth_connections
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

-- ── 2. store_gmail_refresh_token — OAuth callback write path ──────────────
-- On a genuine first connect, mints a new vault secret. On reconnect for a
-- (tenant_id, email_address) pair that already has a connection row,
-- ROTATES the existing vault secret in place via vault.update_secret()
-- instead of minting a new one -- vault.create_secret() has no paired
-- "delete the old one" step, so calling it unconditionally on every
-- reconnect (the consult's original shape) would leave a growing trail of
-- orphaned, still-decryptable vault.secrets rows, one per reconnect, for
-- the life of the project. Reusing the secret id keeps exactly one
-- vault.secrets row per connection for that connection's entire lifetime.
CREATE OR REPLACE FUNCTION public.store_gmail_refresh_token(
  p_tenant_id uuid,
  p_email_address text,
  p_refresh_token text,
  p_scopes text[] DEFAULT ARRAY['https://www.googleapis.com/auth/gmail.readonly']
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault, pg_temp
AS $$
DECLARE
  v_existing_secret_id uuid;
  v_secret_id           uuid;
  v_connection_id       uuid;
BEGIN
  -- Serialize concurrent calls for the same (tenant, mailbox) -- e.g. a
  -- double-submitted OAuth callback, or a user reconnecting in two tabs.
  -- Without this, two racing calls could both read "no existing secret"
  -- below and both mint a fresh vault.create_secret(), orphaning whichever
  -- one loses the final INSERT ... ON CONFLICT. Transaction-scoped, same
  -- pattern as bootstrap_tenant()'s own advisory lock (Section 22) --
  -- releases automatically on commit or rollback, no explicit unlock.
  PERFORM pg_advisory_xact_lock(hashtext(p_tenant_id::text || ':' || p_email_address));

  SELECT refresh_token_secret_id INTO v_existing_secret_id
  FROM public.email_oauth_connections
  WHERE tenant_id = p_tenant_id AND email_address = p_email_address;

  IF v_existing_secret_id IS NOT NULL THEN
    PERFORM vault.update_secret(
      v_existing_secret_id,
      p_refresh_token,
      'gmail_refresh:' || p_tenant_id::text || ':' || p_email_address
    );
    v_secret_id := v_existing_secret_id;
  ELSE
    v_secret_id := vault.create_secret(
      p_refresh_token,
      'gmail_refresh:' || p_tenant_id::text || ':' || p_email_address
    );
  END IF;

  INSERT INTO public.email_oauth_connections
    (tenant_id, email_address, refresh_token_secret_id, scopes, status)
  VALUES (p_tenant_id, p_email_address, v_secret_id, p_scopes, 'active')
  ON CONFLICT (tenant_id, email_address) DO UPDATE
    SET refresh_token_secret_id = excluded.refresh_token_secret_id,
        scopes                  = excluded.scopes,
        status                  = 'active',
        last_error              = NULL,
        updated_at              = now()
  RETURNING id INTO v_connection_id;

  RETURN v_connection_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.store_gmail_refresh_token(uuid, text, text, text[]) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.store_gmail_refresh_token(uuid, text, text, text[]) FROM anon;
REVOKE EXECUTE ON FUNCTION public.store_gmail_refresh_token(uuid, text, text, text[]) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.store_gmail_refresh_token(uuid, text, text, text[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.store_gmail_refresh_token(uuid, text, text, text[]) TO postgres;

-- ── 3. get_gmail_refresh_token — sync job read path ────────────────────────
-- Single-tenant-scoped per call, matching how every other background
-- worker in this codebase already operates (mint a per-tenant system JWT,
-- loop tenant-by-tenant at the orchestration layer -- Phase D, Section 25).
-- NOTE for whoever wires the sync job: the orchestration step of "which
-- tenants currently have an active Gmail connection" cannot itself go
-- through a per-tenant system-JWT client (that client is role
-- `authenticated`, already scoped to one tenant) -- it needs a service_role
-- client for that one cross-tenant enumeration query against
-- email_oauth_connections directly (not vault; status/tenant_id only, no
-- secret material), the same way the existing IMAP/WhatsApp/digest workers
-- already discover which tenants to process each run.
CREATE OR REPLACE FUNCTION public.get_gmail_refresh_token(p_tenant_id uuid)
RETURNS TABLE (connection_id uuid, email_address text, refresh_token text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, vault, pg_temp
AS $$
  SELECT c.id, c.email_address, s.decrypted_secret
  FROM public.email_oauth_connections c
  JOIN vault.decrypted_secrets s ON s.id = c.refresh_token_secret_id
  WHERE c.tenant_id = p_tenant_id AND c.status = 'active';
$$;

REVOKE EXECUTE ON FUNCTION public.get_gmail_refresh_token(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_gmail_refresh_token(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_gmail_refresh_token(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.get_gmail_refresh_token(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_gmail_refresh_token(uuid) TO postgres;

-- ── 4. revoke_gmail_connection — disconnect DB-teardown path ───────────────
-- New in this review -- the consult specified revocation must exist
-- alongside creation, not deferred, but only described it in prose. This
-- is that implementation's DB half: deletes the vault secret and the
-- connection row together (one function call is one implicit transaction,
-- so both succeed or neither does). Does NOT call Google's own /revoke
-- endpoint -- app-code's job, before calling this, using the token this
-- same migration's get_gmail_refresh_token() returns. Requires BOTH
-- p_tenant_id and p_connection_id to match the same row, so a guessed/
-- leaked connection id alone is not enough to revoke a connection outside
-- the caller's asserted tenant.
CREATE OR REPLACE FUNCTION public.revoke_gmail_connection(
  p_tenant_id uuid,
  p_connection_id uuid
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault, pg_temp
AS $$
DECLARE
  v_secret_id uuid;
BEGIN
  SELECT refresh_token_secret_id INTO v_secret_id
  FROM public.email_oauth_connections
  WHERE id = p_connection_id AND tenant_id = p_tenant_id;

  IF v_secret_id IS NULL THEN
    RETURN false;
  END IF;

  DELETE FROM public.email_oauth_connections
  WHERE id = p_connection_id AND tenant_id = p_tenant_id;

  DELETE FROM vault.secrets WHERE id = v_secret_id;

  RETURN true;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.revoke_gmail_connection(uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.revoke_gmail_connection(uuid, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.revoke_gmail_connection(uuid, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_gmail_connection(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.revoke_gmail_connection(uuid, uuid) TO postgres;
