-- phase_1_12b_harden_auth_tenant_id
--
-- DRAFT ONLY — NOT YET APPLIED. Do not run against Supabase without explicit
-- Command Room approval (apply via the Supabase MCP `apply_migration` tool,
-- then update DB_AUDIT_REPORT.md's "Migrations Applied Summary" table).
--
-- Block 1.12b — narrow follow-on to Block 1.12a (commit 3ab4e39, auth
-- controller hygiene: getMe now uses req.supabase and no longer selects the
-- nonexistent tenants.slug column; registerWithAuth's bootstrap writes stay
-- on the shared client for now). The Block 1.12b planning audit (read-only,
-- no files touched) confirmed the live state below.
--
-- Confirmed live via `pg_get_functiondef`, `pg_policy`, `information_schema`,
-- and direct row-count queries during the Block 1.12b planning audit:
--   - auth.users has exactly 1 row (test@gmail.com,
--     15616618-d401-4c8d-8ef8-99f61cfd278f).
--   - public.tenants has exactly 1 row (the dev-fallback tenant,
--     00000000-0000-0000-0000-000000000001).
--   - public.user_tenants has 0 rows — auth_tenant_id() has NEVER returned a
--     non-NULL value anywhere in this project's history; every scoped RLS
--     policy on every table (the 9-table family plus `tenants`) has only
--     ever worked via its `OR <dev-fallback-tenant>` branch.
--   - auth_tenant_id() is LANGUAGE sql, STABLE, SECURITY DEFINER, owned by
--     postgres, with NO search_path pinned (Supabase advisor:
--     function_search_path_mutable) and EXECUTE granted to PUBLIC, anon,
--     authenticated, service_role, and postgres (Supabase advisor:
--     anon_security_definer_function_executable — this RPC is directly
--     callable by an unauthenticated caller today, harmlessly returning
--     NULL).
--   - Current body: `SELECT tenant_id FROM user_tenants WHERE user_id =
--     auth.uid() LIMIT 1;` — unqualified table name, no ORDER BY.
--   - Many current scoped RLS policies (the 9-table family plus `tenants`)
--     are shaped `tenant_id = auth_tenant_id() OR tenant_id =
--     '00000000-0000-0000-0000-000000000001'`, and several Lane C frontend
--     pages still query these tables directly with the raw anon browser
--     client, relying on that `OR <dev-fallback>` branch. Postgres does not
--     short-circuit past a permission error when evaluating a boolean
--     expression — evaluating the `tenant_id = auth_tenant_id()` operand
--     requires the connecting role to hold EXECUTE on `auth_tenant_id()`
--     regardless of which branch of the OR ultimately matches. This is
--     directly relevant to this migration's grant changes below.
--
-- WHAT THIS MIGRATION DOES:
--   1. Re-creates auth_tenant_id() with the same signature, language,
--      volatility, and SECURITY DEFINER property, adding:
--        - SET search_path = public, pg_temp — closes the search-path-
--          hijack vector standard for SECURITY DEFINER functions
--          (function_search_path_mutable).
--        - An explicit public.user_tenants qualification in the body —
--          defense-in-depth alongside the pinned search_path.
--        - A deterministic ORDER BY created_at ASC, id ASC before LIMIT 1 —
--          a no-op today (0, soon 1, row per user) but removes a latent
--          landmine: without it, the moment any user ever has 2+
--          user_tenants rows, which tenant LIMIT 1 returns is undefined.
--   2. Narrows EXECUTE grants from the redundant blanket PUBLIC grant to an
--      explicit per-role grant list — but deliberately KEEPS anon's ability
--      to call this function. See "WHY ANON KEEPS EXECUTE" below; this is a
--      correction from an earlier draft of this same migration, which
--      revoked anon's EXECUTE and would have been unsafe to apply.
--   3. Backfills the one real user → the one real tenant, role 'owner' —
--      the first time auth_tenant_id() will return a non-NULL value for a
--      real authenticated user anywhere in this project's history.
--
-- WHY THIS IS SAFE / WHY IT DOES NOT CHANGE OBSERVABLE APP BEHAVIOUR TODAY:
-- the one tenant this backfill maps the one user to IS the dev-fallback
-- tenant (00000000-0000-0000-0000-000000000001) — every scoped policy's
-- `tenant_id = auth_tenant_id() OR tenant_id = <dev-fallback>` branch
-- already resolves to the same tenant either way for this user today. This
-- migration makes the SCOPED branch real for the first time, without
-- changing which tenant any existing request resolves to.
--
-- WHY ANON KEEPS EXECUTE (do not revoke it in this block):
-- an earlier draft of this migration revoked EXECUTE from anon, on the
-- reasoning that an unauthenticated caller's auth.uid() is always NULL so
-- the function can only ever return NULL for them anyway. That reasoning is
-- correct about the RETURN VALUE but wrong about the consequence: every
-- scoped policy referencing `auth_tenant_id()` still needs to EVALUATE the
-- function call as part of its boolean expression, even on the request path
-- where the dev-fallback OR-branch is the one that actually ends up
-- matching. Postgres checks EXECUTE privilege at evaluation time, not only
-- when the return value is actually used — revoking EXECUTE from anon would
-- make every one of those queries fail with a permission-denied error
-- BEFORE the dev-fallback branch could ever be reached, for any caller
-- connecting as anon. Several Lane C frontend pages (see DB_AUDIT_REPORT.md
-- and the Block 1.4/1.12 audits — dashboard, leads, leads/[id], quotes/new,
-- drafts, segments, segments/new, onboarding/brand-dna) still query
-- tenant-scoped tables directly with the raw anon browser client and depend
-- on exactly this dev-fallback branch working. Revoking anon's EXECUTE here
-- would break all of them immediately, with no code change of this
-- migration's own to explain why. anon's EXECUTE is therefore preserved
-- until EITHER Lane C is migrated off the raw anon client (so no anon
-- request depends on the dev-fallback branch anymore) OR the dev-fallback
-- `OR <dev-fallback>` branch itself is removed from these policies (so anon
-- callers are denied outright by the policy shape rather than reaching
-- auth_tenant_id() at all) — whichever comes first, in a later block. Until
-- then, the Supabase `anon_security_definer_function_executable` advisor is
-- expected to remain open for this function; only
-- `function_search_path_mutable` is closed by this migration.
--
-- OUT OF SCOPE — deliberately NOT done here, tracked separately:
--   - `tenants` has NO INSERT policy at all (confirmed live via `pg_policy`
--     — no `polcmd = 'a'` row exists for this table). Live signup/
--     registration (`registerWithAuth`'s tenant-creation INSERT) is
--     currently broken at the database layer regardless of which Supabase
--     client is used, independent of this migration and independent of the
--     dev-fallback branch. This is a real, separately-tracked, elevated-
--     priority gap for Block 1.12c (likely a SECURITY DEFINER bootstrap
--     RPC) — NOT fixed here.
--   - `tenants`' unscoped `authenticated_read_tenants` SELECT policy
--     (`USING (true)`, roles anon+authenticated) — a real leftover gap, same
--     shape as the original 9-table legacy-permissive-policy family, not
--     touched by this migration.
--   - No dev-fallback branch is removed from any policy, on `tenants` or any
--     other table — this migration changes zero RLS policies.
--   - anon's EXECUTE grant on auth_tenant_id() is NOT revoked here — see
--     "WHY ANON KEEPS EXECUTE" above. Revoking it is a future follow-up,
--     gated on Lane C migration or dev-fallback-branch removal, not this
--     block.
--   - No `user_tenants` schema change beyond the single backfilled row — no
--     `is_default`/active-tenant column, no new index, no constraint change.
--   - No `auth.users` trigger, no bootstrap RPC, no change to
--     `registerWithAuth` / `controllers/auth.js` / `lib/authMiddleware.js` /
--     `controllers/tenants.js` — app code is entirely untouched by this
--     migration.
--   - Lane C frontend pages, Decision Brain, Inventory Engine — untouched.
--
-- Rollback: re-run the commented-out statements below, which reproduce the
-- exact pre-migration function definition and grants confirmed live during
-- the Block 1.12b planning audit. The backfilled user_tenants row is NOT
-- automatically rolled back by this block — restoring the pre-migration
-- FUNCTION/GRANT state does not require removing it, and the row is
-- foreign-key-safe to leave in place; delete it explicitly if ever needed.
-- Note anon's EXECUTE grant is unchanged by this migration in either
-- direction — the rollback's `GRANT ... TO PUBLIC` restores the original
-- redundant blanket grant this migration narrows, not a re-grant to anon
-- (which this migration never revoked).
--
-- ROLLBACK (commented out — for reference only, do not run alongside the
-- statements below in the same migration):
--
-- CREATE OR REPLACE FUNCTION public.auth_tenant_id()
--  RETURNS uuid
--  LANGUAGE sql
--  STABLE SECURITY DEFINER
-- AS $function$
--   SELECT tenant_id FROM user_tenants WHERE user_id = auth.uid() LIMIT 1;
-- $function$;
--
-- GRANT EXECUTE ON FUNCTION public.auth_tenant_id() TO PUBLIC;

-- 1. Harden the function definition.
CREATE OR REPLACE FUNCTION public.auth_tenant_id()
RETURNS uuid
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  SELECT tenant_id
  FROM public.user_tenants
  WHERE user_id = auth.uid()
  ORDER BY created_at ASC, id ASC
  LIMIT 1;
$function$;

-- 2. Narrow the redundant blanket PUBLIC grant to an explicit per-role list.
--    anon KEEPS EXECUTE — see "WHY ANON KEEPS EXECUTE" above. Revoking it
--    here would break every scoped policy's dev-fallback branch for any
--    anon caller, including the Lane C frontend pages that still depend on
--    it. Do not revoke anon's EXECUTE until Lane C is migrated or the
--    dev-fallback branch is removed from these policies.
REVOKE EXECUTE ON FUNCTION public.auth_tenant_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.auth_tenant_id() TO anon;
GRANT EXECUTE ON FUNCTION public.auth_tenant_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.auth_tenant_id() TO service_role;
GRANT EXECUTE ON FUNCTION public.auth_tenant_id() TO postgres;

-- 3. Backfill the one existing user → the one existing tenant, role owner.
--    ON CONFLICT DO NOTHING makes this statement safe to re-run.
INSERT INTO public.user_tenants (user_id, tenant_id, role)
VALUES (
  '15616618-d401-4c8d-8ef8-99f61cfd278f', -- test@gmail.com, confirmed live 2026-07-20
  '00000000-0000-0000-0000-000000000001', -- dev-fallback tenant, confirmed live 2026-07-20
  'owner'
)
ON CONFLICT (user_id, tenant_id) DO NOTHING;
