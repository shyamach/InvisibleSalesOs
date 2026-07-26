/**
 * tests/bootstrapTenantRpc.migration.test.js
 *
 * Contract for `public.bootstrap_tenant(p_name text, p_settings jsonb)`, the
 * Block 1.12c bootstrap RPC (DRAFT, not yet applied — see
 * supabase/migrations/phase_1_12c_bootstrap_tenant_rpc.sql). `tenants` has
 * no INSERT policy at all, and a brand-new user has no `user_tenants` row
 * yet, so there is no RLS predicate a direct insert could ever satisfy —
 * bootstrap_tenant() is a SECURITY DEFINER RPC that performs both the
 * `tenants` and `user_tenants` inserts atomically, deriving user_id/
 * owner_email server-side from auth.uid()/auth.users, self-serializing
 * concurrent calls for the same user via an advisory transaction lock, and
 * granting EXECUTE to `authenticated` only (not `anon`).
 *
 * WHY THIS FILE IS MOSTLY METADATA-ONLY, NOT A FULL RPC-CONTRACT TEST:
 * proving the RPC's actual write behaviour (tenant + user_tenants rows
 * created correctly, the advisory lock actually serializing a real race,
 * the idempotent re-check actually returning an existing mapping) needs a
 * real authenticated JWT for a *new* signup. Getting one means either
 * running a real `supabase.auth.signUp()` against this shared live project
 * (mutates live `auth.users` with a throwaway account — needs explicit
 * sign-off, not something a test file should do unprompted) or a
 * service-role key (does not exist anywhere in this codebase, and Block
 * 1.12c's own planning audit rejected introducing one). Per this block's
 * constraints (no service-role key, no real JWT), this file does not fake
 * that coverage — the function's SECURITY DEFINER property, search_path,
 * body shape, and grants are catalog introspection queries instead
 * (`pg_get_functiondef`, `information_schema.routine_privileges`), which
 * PostgREST does not expose to any role including anon, so those are
 * `it.skip`'d below with the exact query to run manually (Supabase MCP
 * `execute_sql` or a postgres/service-role connection), matching this
 * repo's established pattern (see tests/authTenantId.migration.test.js).
 *
 * WHAT ANON *CAN* PROVE, AND IS TESTED FOR REAL BELOW:
 * anon has no EXECUTE grant on bootstrap_tenant() (Block 1.12c deliberately
 * does not grant it — see the migration file's "GRANTS" section), so an
 * anon RPC call must fail one way or another and must not create any row.
 * Note the *cause* of that failure differs depending on whether this
 * migration has been applied yet:
 *   - Pre-apply (the function does not exist in the live DB at all): the
 *     call fails with a "function not found" / PGRST202-style error.
 *   - Post-apply, pre-EXECUTE-grant-verification: the call fails with a
 *     permission-denied error because anon lacks EXECUTE.
 *   - Post-apply, if somehow called by an authenticated-looking anon
 *     session: the function's own `auth.uid() IS NULL` check would reject
 *     it with SQLSTATE 28000 before touching either table.
 * All three are still failures with no row created, so the assertion below
 * only checks for *an* error and a null result, not a specific SQLSTATE or
 * message — it holds in this draft (pre-apply) state and remains true
 * after apply, without needing to be rewritten once the migration lands.
 *
 * Separately, `tenants` still carries the `authenticated_read_tenants`
 * policy (`USING (true)`, roles anon+authenticated — a known, separately-
 * tracked leftover gap, not touched by this migration, expected to be
 * removed in a later block), which means anon CURRENTLY can read all
 * `tenants` rows unconditionally. While that leak remains open, this test
 * uses it for a POSITIVE no-row check — a stronger confirmation than "the
 * call errored" alone. This test does NOT depend on that leak staying open:
 * once it's fixed, the same probe SELECT will come back as a permission/
 * RLS-shaped error instead of an empty array, and the assertion below
 * treats that as an acceptable, expected outcome (a strictly better
 * security posture) rather than a regression to chase down. This does not
 * extend to `user_tenants`: that table's `user_tenants_self` policy
 * (`auth.uid() = user_id`) always evaluates false for anon (whose
 * `auth.uid()` is always NULL), so anon can never confirm anything about
 * `user_tenants` either way — documented here as a genuine test limitation,
 * not silently skipped, consistent with tests/authTenantId.migration.test.js's
 * own note about the same table.
 *
 * WHY THIS FILE IS SKIPPED BY DEFAULT:
 * set RUN_DB_INTEGRATION_TESTS=true to run it manually. It is never run as
 * part of `npm test` / CI. No SUPABASE_SERVICE_ROLE_KEY and no real
 * authenticated JWT are used or required anywhere in this file.
 *
 * HOW TO RUN, MANUALLY:
 *   RUN_DB_INTEGRATION_TESTS=true npx vitest run tests/bootstrapTenantRpc.migration.test.js
 *
 * HOW TO VERIFY THE SKIPPED (catalog-only) ASSERTIONS, AFTER APPLYING:
 * via the Supabase MCP `execute_sql` tool (or any postgres/service-role
 * connection):
 *   SELECT pg_get_functiondef(oid) FROM pg_proc WHERE proname = 'bootstrap_tenant';
 *   SELECT grantee, privilege_type FROM information_schema.routine_privileges
 *     WHERE routine_name = 'bootstrap_tenant';
 *   SELECT * FROM public.tenants ORDER BY created_at DESC LIMIT 5; -- manual
 *     smoke-test confirmation after a real signup, not via this file
 */
import { describe, it, expect } from 'vitest';
import { createClient } from '@supabase/supabase-js';

const RUN_INTEGRATION = process.env.RUN_DB_INTEGRATION_TESTS === 'true';
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
const canRun = RUN_INTEGRATION && Boolean(supabaseUrl) && Boolean(supabaseAnonKey);

const maybeDescribe = canRun ? describe : describe.skip;
const anon = canRun ? createClient(supabaseUrl, supabaseAnonKey) : null;

// A distinctive, never-expected-to-succeed probe name. If this ever shows up
// in `tenants` it means the anon-rejection assertion below has regressed.
const PROBE_TENANT_NAME = '__bootstrap_tenant_rpc_migration_test_probe__';

maybeDescribe('bootstrap_tenant() — bootstrap RPC contract (run manually, pre- or post-apply)', () => {
  it('anon cannot successfully call bootstrap_tenant() — no EXECUTE grant (post-apply) or function not found (pre-apply); either way, no row is created', async () => {
    const { data, error } = await anon.rpc('bootstrap_tenant', {
      p_name: PROBE_TENANT_NAME,
      p_settings: {},
    });

    // See file header "WHAT ANON CAN PROVE" — the exact cause differs
    // pre- vs post-apply, but the outcome (error, no data) does not.
    expect(error).toBeTruthy();
    expect(data).toBeNull();

    // tenants' authenticated_read_tenants policy (USING true) CURRENTLY lets
    // anon read all rows unconditionally — a separately-tracked leftover gap
    // (DB_AUDIT_REPORT.md Section 7), not something this test relies on
    // staying open. While it's open, use it for a positive no-row check; if
    // a later block fixes it, anon SELECT gets denied instead, and that
    // denial is itself the acceptable, expected outcome — not a regression.
    const { data: probeRows, error: probeError } = await anon
      .from('tenants')
      .select('id')
      .eq('name', PROBE_TENANT_NAME);

    if (probeError) {
      // The tenants SELECT leak has been fixed — anon is correctly denied
      // read access. That's a strictly better security posture than this
      // test was originally written against, so a permission/RLS-shaped
      // error here is success, not something to investigate.
      expect(probeError.message).toMatch(/permission|row-level security|not allowed|denied/i);
    } else {
      expect(probeRows).toEqual([]);
    }
  });

  it('anon cannot confirm anything about user_tenants either way — documents a test limitation, does not attempt to verify it', async () => {
    // user_tenants_self is `auth.uid() = user_id`; anon's auth.uid() is
    // always NULL, so this can never match any row. An empty result here is
    // the correct and only possible outcome for this query via anon,
    // regardless of migration state — it does NOT confirm bootstrap_tenant()
    // behaves correctly, only that user_tenants stays locked out for anon.
    const { data, error } = await anon
      .from('user_tenants')
      .select('id')
      .eq('user_id', '00000000-0000-0000-0000-000000000000');

    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  // The following are genuine parts of this RPC's contract but are not
  // reachable through the anon-key PostgREST REST surface at all — see file
  // header "WHY THIS FILE IS MOSTLY METADATA-ONLY". Left as explicit skips
  // (not silently omitted) so the required coverage is visible in test
  // output, with the exact catalog query to run instead documented above
  // and here.
  it.skip('SKIPPED (requires direct SQL/catalog access, not available via anon+REST): bootstrap_tenant(text, jsonb) is SECURITY DEFINER with search_path pinned to public, pg_temp — verify via `SELECT pg_get_functiondef(oid) FROM pg_proc WHERE proname = \'bootstrap_tenant\';` (Supabase MCP execute_sql or a postgres/service-role connection)', () => {});

  it.skip('SKIPPED (requires direct SQL/catalog access, not available via anon+REST): bootstrap_tenant() derives user id/owner email from auth.uid()/auth.users, serializes via pg_advisory_xact_lock, and inserts into both public.tenants and public.user_tenants — verify by inspecting the same pg_get_functiondef output above for the substrings `auth.uid()`, `pg_advisory_xact_lock`, `insert into public.tenants` / `insert into tenants`, and `insert into public.user_tenants` / `insert into user_tenants`', () => {});

  it.skip('SKIPPED (requires direct SQL/catalog access, not available via anon+REST): authenticated retains EXECUTE on bootstrap_tenant(text, jsonb) and anon/PUBLIC do not — verify via `SELECT grantee, privilege_type FROM information_schema.routine_privileges WHERE routine_name = \'bootstrap_tenant\';` (a real authenticated JWT would be needed to prove authenticated CAN call it positively by actually invoking the RPC, and this block\'s constraints forbid using one here)', () => {});
});

if (!canRun) {
  describe('bootstrap_tenant() — bootstrap RPC contract', () => {
    it.skip('SKIPPED: set RUN_DB_INTEGRATION_TESTS=true to run these against the live project (works both pre- and post-apply — see file header)', () => {});
  });
}
