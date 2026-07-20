/**
 * tests/authTenantId.migration.test.js
 *
 * Contract for `public.auth_tenant_id()` after
 * supabase/migrations/phase_1_12b_harden_auth_tenant_id.sql (DRAFT, not yet
 * applied) — pinned search_path, a narrowed (but NOT anon-revoking) EXECUTE
 * grant list, deterministic ORDER BY, and a one-row backfill mapping the one
 * real auth.users row to the one real tenants row.
 *
 * anon's EXECUTE grant on auth_tenant_id() is DELIBERATELY PRESERVED by this
 * migration — see the migration file's "WHY ANON KEEPS EXECUTE" section.
 * Many current scoped RLS policies are shaped `tenant_id = auth_tenant_id()
 * OR tenant_id = <dev-fallback>`, and several Lane C frontend pages still
 * query those tables with the raw anon browser client, depending on that
 * dev-fallback branch. Postgres checks EXECUTE at evaluation time, not only
 * when the return value is used, so revoking anon's EXECUTE would break
 * every one of those queries with a permission-denied error before the
 * dev-fallback branch could ever be reached. An earlier draft of this file
 * asserted the opposite (that anon's RPC call should fail) — that assertion
 * has been replaced below with one that documents the actual, intentional
 * behaviour instead.
 *
 * WHY THIS FILE IS METADATA-ONLY, NOT A FULL RLS-CONTRACT TEST LIKE THE
 * REST OF THIS FAMILY (tests/whatsappSessions.migration.test.js,
 * tests/smartLeads.migration.test.js, etc.):
 * Those files test row-level behaviour (INSERT/SELECT/UPDATE/DELETE on a
 * data table) using the anon client, which is enough to prove RLS policy
 * shape. This migration instead changes a FUNCTION's search_path, body, and
 * GRANTs — none of which are visible through the anon-key PostgREST REST
 * surface. `pg_proc.proconfig` (search_path), `pg_get_functiondef` (body
 * text), and `information_schema.routine_privileges` (grants per role) are
 * catalog introspection queries — PostgREST does not expose `pg_catalog` or
 * `information_schema` as REST resources for any role, anon included, and
 * this block's constraints explicitly forbid using a service-role key or a
 * real authenticated JWT to work around that. Those assertions are
 * therefore `it.skip`'d below with an explicit note on how to verify them
 * instead (Supabase MCP `execute_sql`, the same queries run during the
 * Block 1.12b planning audit) — documented as a limitation, not silently
 * dropped, matching this repo's established pattern for capability-gated
 * tests (see e.g. tests/whatsappSessions.migration.test.js's
 * SUPABASE_SERVICE_ROLE_KEY-gated optional test).
 *
 * WHAT ANON *CAN* PROVE, AND IS TESTED FOR REAL BELOW:
 *   1. anon can STILL call auth_tenant_id() via RPC
 *      (`/rest/v1/rpc/auth_tenant_id`) after this migration, and the result
 *      is NULL — this is the intentionally preserved behaviour (see file
 *      header above), not a gap this migration failed to close. It remains
 *      preserved until Lane C is migrated off the raw anon client or the
 *      dev-fallback branch is removed from these policies, whichever comes
 *      first, in a later block.
 *   2. `user_tenants` stays fully locked out for anon regardless of this
 *      migration — its own `user_tenants_self` policy is
 *      `auth.uid() = user_id`, and anon's `auth.uid()` is always NULL, so
 *      no anon SELECT can ever return the backfilled row (or any row). This
 *      test documents that limitation directly rather than pretending to
 *      confirm the backfill — the backfill itself must be confirmed via the
 *      Supabase MCP or dashboard after this migration is applied, not via
 *      this test file.
 *
 * WHY THIS FILE IS SKIPPED BY DEFAULT:
 * set RUN_DB_INTEGRATION_TESTS=true to run it manually, after the migration
 * has been applied. It is never run as part of `npm test` / CI. No
 * SUPABASE_SERVICE_ROLE_KEY and no real authenticated JWT are used or
 * required anywhere in this file, per Block 1.12b's constraints.
 *
 * HOW TO RUN, MANUALLY, AFTER THE MIGRATION IS APPLIED:
 *   RUN_DB_INTEGRATION_TESTS=true npx vitest run tests/authTenantId.migration.test.js
 *
 * HOW TO VERIFY THE SKIPPED (catalog-only) ASSERTIONS AFTER APPLYING:
 * via the Supabase MCP `execute_sql` tool (or any `postgres`/service-role
 * connection), the same queries used during the Block 1.12b planning audit:
 *   SELECT proconfig FROM pg_proc WHERE proname = 'auth_tenant_id';
 *   SELECT pg_get_functiondef(oid) FROM pg_proc WHERE proname = 'auth_tenant_id';
 *   SELECT grantee, privilege_type FROM information_schema.routine_privileges
 *     WHERE routine_name = 'auth_tenant_id';
 *   SELECT * FROM public.user_tenants; -- confirm the backfilled row exists
 */
import { describe, it, expect } from 'vitest';
import { createClient } from '@supabase/supabase-js';

const RUN_INTEGRATION = process.env.RUN_DB_INTEGRATION_TESTS === 'true';
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
const canRun = RUN_INTEGRATION && Boolean(supabaseUrl) && Boolean(supabaseAnonKey);

const maybeDescribe = canRun ? describe : describe.skip;
const anon = canRun ? createClient(supabaseUrl, supabaseAnonKey) : null;

const EXPECTED_USER_ID = '15616618-d401-4c8d-8ef8-99f61cfd278f'; // test@gmail.com, confirmed live 2026-07-20
const EXPECTED_TENANT_ID = '00000000-0000-0000-0000-000000000001'; // dev-fallback tenant, confirmed live 2026-07-20

maybeDescribe('auth_tenant_id() — hardening contract (run manually post-migration)', () => {
  it('anon can still execute auth_tenant_id() via RPC and gets NULL — intentionally preserved until Lane C/dev-fallback cleanup', async () => {
    const { data, error } = await anon.rpc('auth_tenant_id');

    // This migration deliberately does NOT revoke EXECUTE from anon (see
    // the migration file's "WHY ANON KEEPS EXECUTE" section) — several
    // scoped RLS policies are shaped `tenant_id = auth_tenant_id() OR
    // tenant_id = <dev-fallback>`, and Postgres must be able to EVALUATE
    // the `auth_tenant_id()` call to reach the dev-fallback branch at all.
    // Several Lane C frontend pages still query those tables with the raw
    // anon browser client and depend on that branch working. So: the call
    // succeeds, and returns NULL, because anon's auth.uid() is always NULL
    // — this is the correct, intentional, unchanged behaviour, and this
    // test exists to document that it stays this way until Lane C is
    // migrated or the dev-fallback branch is removed from these policies.
    expect(error).toBeNull();
    expect(data).toBeNull();
  });

  it('anon cannot read the backfilled user_tenants row, or any row — documents a test limitation, does not confirm the backfill', async () => {
    const { data, error } = await anon
      .from('user_tenants')
      .select('id')
      .eq('user_id', EXPECTED_USER_ID)
      .eq('tenant_id', EXPECTED_TENANT_ID);

    // user_tenants_self is `auth.uid() = user_id`; anon's auth.uid() is
    // always NULL, so this can never match any row, including the one this
    // migration backfills. A non-empty result here would actually indicate
    // something is WRONG (RLS not enforcing), not that the backfill
    // succeeded — an empty result is the correct and only possible outcome
    // for this query via anon, regardless of migration state. Confirm the
    // backfill directly via the Supabase MCP (`SELECT * FROM
    // public.user_tenants;`) after applying, not via this test.
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  // The following are genuine parts of this migration's contract but are not
  // reachable through the anon-key PostgREST REST surface at all — see file
  // header "WHY THIS FILE IS METADATA-ONLY". Left as explicit skips (not
  // silently omitted) so the required coverage is visible in test output,
  // with the exact catalog query to run instead documented above and here.
  it.skip('SKIPPED (requires direct SQL/catalog access, not available via anon+REST): auth_tenant_id() has search_path pinned to public, pg_temp — verify via `SELECT proconfig FROM pg_proc WHERE proname = \'auth_tenant_id\';` (Supabase MCP execute_sql or a postgres/service-role connection)', () => {});

  it.skip('SKIPPED (requires direct SQL/catalog access, not available via anon+REST): auth_tenant_id() body qualifies public.user_tenants and orders by created_at ASC, id ASC before LIMIT 1 — verify via `SELECT pg_get_functiondef(oid) FROM pg_proc WHERE proname = \'auth_tenant_id\';`', () => {});

  it.skip('SKIPPED (requires direct SQL/catalog access, not available via anon+REST): authenticated/service_role/postgres retain EXECUTE on auth_tenant_id() — verify via `SELECT grantee, privilege_type FROM information_schema.routine_privileges WHERE routine_name = \'auth_tenant_id\';` (a real JWT or service-role key would be needed to prove this positively by calling the RPC as each role, and this block\'s constraints forbid using either here)', () => {});
});

if (!canRun) {
  describe('auth_tenant_id() — hardening contract', () => {
    it.skip('SKIPPED: set RUN_DB_INTEGRATION_TESTS=true after applying the Block 1.12b migration to run these', () => {});
  });
}
