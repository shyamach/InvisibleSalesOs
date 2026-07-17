/**
 * tests/segments.migration.test.js
 *
 * RLS contract for `segments` after
 * supabase/migrations/phase_1_9_drop_segments_permissive_policy.sql
 * (DRAFT, not yet applied).
 *
 * WHY THIS FILE DOES NOT FOLLOW THE REPO'S USUAL MOCKED-SUPABASE PATTERN:
 * RLS policies are enforced by real Postgres, not the JS client — a mock
 * would "pass" these assertions regardless of whether the real policy state
 * matches. These tests use the REAL Supabase client (anon key, same as the
 * rest of the app) on purpose, following the pattern in
 * tests/emailThreads.migration.test.js, tests/closedDeals.migration.test.js,
 * tests/invoices.migration.test.js, tests/quotes.migration.test.js,
 * tests/smartLeads.migration.test.js, and tests/callLogs.migration.test.js.
 *
 * HOW THIS DIFFERS FROM THE REST OF THE FAMILY:
 * `segments` had ZERO scoped sibling policies before this migration — the
 * same zero-scoped starting point as `call_logs` (Block 1.8) — but harder:
 * `call_logs` had only ONE command (INSERT) with a real app dependent, so
 * only one scoped policy needed adding. `segments` has THREE — SELECT,
 * INSERT, and UPDATE all have live, end-user-reachable frontend anon
 * dependents (list view, "Save Segment" form, and the "Run Campaign"
 * button's `last_run_at` update, respectively — see the migration file's
 * header for exact locations). DELETE has no app dependent anywhere and
 * becomes fully default-deny after this migration, the same reasoning
 * already applied to `quotes`' DELETE (Block 1.6b) and `closed_deals`'
 * UPDATE/DELETE (Block 1.4c).
 *
 * A NOTE ON THE "RUN CAMPAIGN" UPDATE PATH:
 * frontend/src/app/app/segments/page.tsx's Run Campaign UPDATE filters
 * only by `.eq("id", segment.id)` — it does not filter by tenant_id in the
 * app-level query. That means, for that call shape, the scoped UPDATE
 * policy's `USING` clause is the *sole* tenant boundary — there is no
 * app-level WHERE clause backing it up. The UPDATE test below deliberately
 * mirrors that shape (filtering only by `id`, not `tenant_id`) rather than
 * the more defensive `.eq('tenant_id', ...)` shape some other tables' app
 * code uses, so it actually exercises the real risk this migration closes.
 *
 * ⚠️ CLEANUP LIMITATION — READ BEFORE RUNNING:
 * DELETE is intentionally default-deny after this migration (that is
 * itself part of what's under test), so the anon client used here has NO
 * way to truly remove the row it inserts — unlike tests/quotes.migration.
 * test.js (which can still soft-mark via a retained UPDATE policy) or
 * tests/invoices.migration.test.js (which retains a scoped DELETE policy
 * outright). Cleanup is handled two ways, in order of preference, the same
 * as tests/callLogs.migration.test.js:
 *   1. If SUPABASE_SERVICE_ROLE_KEY is configured, a privileged client
 *      (which bypasses RLS entirely) deletes the marked row after the test
 *      that creates it.
 *   2. If no service-role key is configured (the default in this repo's
 *      .env.local), the row-creating test still runs, because "anon can
 *      INSERT/SELECT/UPDATE for the dev-fallback tenant" is real, required
 *      app behaviour that must be verified — but the row it creates is NOT
 *      cleaned up and remains in the live `segments` table, clearly tagged
 *      with MARKER_PREFIX in its `name` column. Since `segments` had 0 rows
 *      before this migration, at most ONE residual row will exist after a
 *      full run without a service-role key — every assertion below either
 *      creates no row (the rejected cross-tenant INSERT) or reuses that
 *      same one row (SELECT/UPDATE/DELETE checks), the same combined-row
 *      approach as tests/callLogs.migration.test.js, rather than one row
 *      per assertion.
 *
 * ⚠️ IMPORTANT — THIS REFLECTS INTERIM POLICY BEHAVIOUR, NOT THE FINAL MODEL:
 * all three new scoped policies use `tenant_id = auth_tenant_id() OR
 * tenant_id = <dev-fallback-tenant>` — the `OR <dev-fallback-tenant>`
 * branch is a pre-auth-mapping scaffold (see DB_AUDIT_REPORT.md §3 item 1
 * and the Block 1.4a audit), not the desired production model. Under an
 * anon client with no JWT, `auth_tenant_id()` always evaluates to NULL, so
 * every assertion below that "succeeds" only does so via the dev-fallback
 * branch matching the literal dev-fallback tenant UUID — it is not proof
 * that per-tenant `auth.uid()`-based isolation works correctly for two
 * *authenticated* tenants. That remains open work (Block 1's
 * `auth.uid() → tenant_id` mapping, still not implemented anywhere in this
 * codebase). This file tests interim dev-fallback behaviour only, not
 * final authenticated multi-tenant isolation.
 *
 * ON THE MISMATCHED-TENANT INSERT TEST — A SCHEMA CAVEAT WORTH FLAGGING:
 * like every other table in this family, `segments.tenant_id` has a live
 * FOREIGN KEY to `tenants(id) ON DELETE CASCADE`. Only one tenant row
 * currently exists in this project (the dev-fallback tenant itself,
 * `00000000-0000-0000-0000-000000000001`) — there is no second real tenant
 * to insert against. That means an INSERT using any other UUID as
 * `tenant_id` is rejected by the FK constraint regardless of RLS, so that
 * rejection alone does NOT isolate "RLS denied this" from "no such tenant
 * exists." This test asserts only that the insert fails, without claiming
 * the failure is purely an RLS violation.
 *
 * ON THE DELETE DEFAULT-DENY ASSERTION — WHAT "REJECTED" ACTUALLY LOOKS
 * LIKE HERE:
 * PostgREST does not require a row to be visible under a table's SELECT
 * policy in order to attempt a DELETE against it — RLS filters which rows
 * the command actually touches, not whether the command can be issued.
 * With no DELETE policy at all for `segments` after this migration, the
 * expected shape is the same as tests/quotes.migration.test.js's DELETE
 * assertion and tests/callLogs.migration.test.js's UPDATE/DELETE
 * assertions: the request completes without a client-visible error, but
 * affects zero rows — not a thrown/rejected error. This test asserts on
 * that "no error, zero rows affected, row still visible after" shape
 * rather than asserting an error object is present, since default-deny via
 * an absent policy does not itself raise a PostgREST-visible error in this
 * project's observed behaviour (confirmed empirically for every prior
 * table in this family with a default-deny command — see call_logs and
 * quotes above). If a future Postgres/PostgREST version changes this
 * behaviour to a raised RLS error instead, this assertion would need
 * updating to match — flagging that here rather than asserting a specific
 * error object that may not materialize.
 *
 * WHY THIS FILE IS SKIPPED BY DEFAULT:
 * set RUN_DB_INTEGRATION_TESTS=true to run it manually, after the migration
 * has been applied. It is never run as part of `npm test` / CI. The
 * privileged cleanup block additionally requires SUPABASE_SERVICE_ROLE_KEY
 * — see the cleanup-limitation note above for what happens without one.
 *
 * HOW TO RUN, MANUALLY, AFTER THE MIGRATION IS APPLIED:
 *   RUN_DB_INTEGRATION_TESTS=true npx vitest run tests/segments.migration.test.js
 *
 * TEST DATA NOTES:
 * - `segments` has no UNIQUE constraint suitable as a marker column, so
 *   every insert that needs one uses a distinct, timestamped/randomised
 *   value in `name` (NOT NULL, no uniqueness constraint, no CHECK
 *   constraint) as the lookup key for that test's row.
 * - `tenant_id` and `name` are the only NOT NULL columns without a
 *   default; `filters` defaults to `{}`, `channel` defaults to
 *   `'whatsapp'` (also CHECK-constrained to whatsapp/email/both — every
 *   insert below relies on that default rather than supplying it
 *   explicitly), `lead_count` defaults to 0, and `description`/
 *   `last_run_at` are nullable.
 * - `segment_runs` is NOT touched by this file — it is an adjacent table
 *   with its own identical zero-scoped-policy shape, out of scope for
 *   Block 1.9 (see the migration file's header).
 */
import { describe, it, expect } from 'vitest';
import { createClient } from '@supabase/supabase-js';

const RUN_INTEGRATION = process.env.RUN_DB_INTEGRATION_TESTS === 'true';
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
const canRun = RUN_INTEGRATION && Boolean(supabaseUrl) && Boolean(supabaseAnonKey);

const maybeDescribe = canRun ? describe : describe.skip;
const anon = canRun ? createClient(supabaseUrl, supabaseAnonKey) : null;

const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const canCleanupPrivileged = canRun && Boolean(supabaseServiceRoleKey);
const service = canCleanupPrivileged ? createClient(supabaseUrl, supabaseServiceRoleKey) : null;

const DEV_TENANT_ID = '00000000-0000-0000-0000-000000000001'; // verified to exist, 2026-07-17
const NONEXISTENT_TENANT_ID = '11111111-1111-1111-1111-111111111111'; // no such tenants row (see header caveat)
const MARKER_PREFIX = '__integration_test__segments_contract__';

function uniqueMarker() {
  return `${MARKER_PREFIX}${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

function validRow(tenantId, overrides = {}) {
  return {
    tenant_id: tenantId,
    name: uniqueMarker(),
    ...overrides,
  };
}

// Cleanup by `name` marker — only possible via a privileged client, since
// anon has no DELETE policy on segments after this migration (see the
// file header's cleanup-limitation note). A no-op, clearly documented as
// such, when no service-role key is configured — the row stays in the
// table, tagged with MARKER_PREFIX, for manual/future cleanup.
async function cleanupByMarker(marker) {
  if (!canCleanupPrivileged) {
    console.warn(
      `⚠️  [segments.migration.test.js] No SUPABASE_SERVICE_ROLE_KEY configured — leaving residual segments row (name="${marker}") uncleaned. See file header.`
    );
    return;
  }
  await service.from('segments').delete().eq('name', marker).eq('tenant_id', DEV_TENANT_ID);
}

maybeDescribe('segments — real Postgres/RLS contract (run manually post-migration)', () => {
  it('anon INSERT with a tenant_id that does not exist is rejected', async () => {
    const { error } = await anon.from('segments').insert(validRow(NONEXISTENT_TENANT_ID));
    // Rejected either by the FK constraint (no such tenants row) or by RLS
    // (mismatched tenant_id satisfies neither branch of the scoped policy's
    // OR) — see header caveat on why this test cannot isolate which one.
    // No row is created either way, so no cleanup is needed here.
    expect(error).not.toBeNull();
  });

  // Combined into a single test — INSERT, then SELECT/UPDATE/DELETE —
  // deliberately reusing the ONE row this creates for all four
  // assertions, rather than one row per assertion, to keep this file's
  // total footprint to at most a single residual row when no
  // service-role key is configured (see the cleanup-limitation header
  // note; same approach as tests/callLogs.migration.test.js).
  it('anon can INSERT/SELECT/UPDATE a dev-fallback tenant row; DELETE on it is default-deny', async () => {
    const marker = uniqueMarker();
    try {
      const { error: insertErr } = await anon.from('segments').insert(validRow(DEV_TENANT_ID, { name: marker }));
      expect(insertErr).toBeNull();

      // SELECT via the new scoped policy — separate SELECT call, not
      // relying on INSERT's own RETURNING output.
      const { data: selectData, error: selectErr } = await anon
        .from('segments')
        .select('id, tenant_id, name')
        .eq('name', marker);
      expect(selectErr).toBeNull();
      expect(selectData).toHaveLength(1);
      expect(selectData[0].tenant_id).toBe(DEV_TENANT_ID);

      const rowId = selectData[0].id;

      // UPDATE — deliberately filtering ONLY by `id`, matching the real
      // frontend "Run Campaign" call shape (page.tsx does not filter by
      // tenant_id here), so this exercises the scoped UPDATE policy as the
      // sole tenant boundary, not an app-level WHERE clause.
      const { data: updateData, error: updateErr } = await anon
        .from('segments')
        .update({ last_run_at: new Date().toISOString() })
        .eq('id', rowId)
        .select('id, last_run_at');
      expect(updateErr).toBeNull();
      expect(updateData).toHaveLength(1);
      expect(updateData[0].last_run_at).not.toBeNull();

      // DELETE default-deny — no DELETE policy before or after this
      // migration for segments' scoped set; expected to complete without
      // a client-visible error but affect zero rows, not to throw (see
      // header note on why this isn't asserted as a thrown error).
      const { data: deleteData, error: deleteErr } = await anon
        .from('segments')
        .delete()
        .eq('id', rowId)
        .select('id');
      expect(deleteErr).toBeNull();
      expect(deleteData).toEqual([]);

      // Confirm the row is still visible after the denied DELETE attempt —
      // RLS evaluates each command's policy set independently, so SELECT
      // visibility is unaffected by the DELETE having no policy.
      const { data: stillThere, error: stillThereErr } = await anon
        .from('segments')
        .select('id')
        .eq('name', marker);
      expect(stillThereErr).toBeNull();
      expect(stillThere).toHaveLength(1);
    } finally {
      await cleanupByMarker(marker);
    }
  });
});

if (!canRun) {
  describe('segments — real Postgres/RLS contract', () => {
    it.skip('SKIPPED: set RUN_DB_INTEGRATION_TESTS=true after applying the Block 1.9 migration to run these', () => {});
  });
}
