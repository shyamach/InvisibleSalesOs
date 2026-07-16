/**
 * tests/callLogs.migration.test.js
 *
 * RLS contract for `call_logs` after
 * supabase/migrations/phase_1_8_drop_call_logs_permissive_policy.sql
 * (DRAFT, not yet applied).
 *
 * WHY THIS FILE DOES NOT FOLLOW THE REPO'S USUAL MOCKED-SUPABASE PATTERN:
 * RLS policies are enforced by real Postgres, not the JS client — a mock
 * would "pass" these assertions regardless of whether the real policy state
 * matches. These tests use the REAL Supabase client (anon key, same as the
 * rest of the app) on purpose, following the pattern in
 * tests/emailThreads.migration.test.js, tests/closedDeals.migration.test.js,
 * tests/invoices.migration.test.js, tests/quotes.migration.test.js, and
 * tests/smartLeads.migration.test.js.
 *
 * HOW THIS DIFFERS FROM THE REST OF THE FAMILY:
 * `call_logs` had ZERO scoped sibling policies before this migration — not
 * partial coverage (quotes/closed_deals) or full coverage (invoices,
 * smart_leads), but none at all. The migration adds exactly one scoped
 * policy (`call_logs_tenant_insert`), because INSERT is the only command
 * any app code actually depends on. SELECT and UPDATE get no scoped
 * replacement by design (zero app dependents for either) and become fully
 * default-deny; DELETE was already default-deny before this migration and
 * stays that way. That makes `call_logs` closer to `email_threads` (no
 * scoped policy existed) than to any of the tables with partial/full scoped
 * coverage — except `email_threads` had zero app dependents at all, while
 * `call_logs` has two real INSERT dependents this migration must keep
 * working.
 *
 * ⚠️ CLEANUP LIMITATION — READ BEFORE RUNNING:
 * Because SELECT and DELETE are both default-deny for anon after this
 * migration, the anon client used by these tests has NO way to find or
 * remove the row it inserts — unlike every other file in this family
 * (including tests/quotes.migration.test.js and tests/closedDeals.
 * migration.test.js, which could at least soft-mark or fully delete their
 * own rows). Cleanup is handled two ways, in order of preference:
 *   1. If SUPABASE_SERVICE_ROLE_KEY is configured, a privileged client
 *      (which bypasses RLS entirely) deletes the marked row after each test
 *      that creates one.
 *   2. If no service-role key is configured (the default in this repo's
 *      .env.local — see the "Browser-side... never service_role" comment
 *      there), the row-creating test still runs, because "anon can INSERT"
 *      is real, required app behaviour that must be verified — but the row
 *      it creates is NOT cleaned up and remains in the live `call_logs`
 *      table, clearly tagged with MARKER_PREFIX in its `notes` column, same
 *      as the residual `status: 'expired'` rows tests/quotes.migration.
 *      test.js leaves under its own anon-cannot-DELETE constraint. Since
 *      `call_logs` had 0 rows before this migration, at most ONE residual
 *      row will exist after a full run without a service-role key — every
 *      other assertion in this file either creates no row (the rejected
 *      cross-tenant INSERT) or reuses that same one row (SELECT/UPDATE/
 *      DELETE default-deny checks) rather than creating additional ones.
 *
 * ⚠️ IMPORTANT — THIS REFLECTS INTERIM POLICY BEHAVIOUR, NOT THE FINAL MODEL:
 * the new scoped INSERT policy uses `tenant_id = auth_tenant_id() OR
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
 * like every other table in this family, `call_logs.tenant_id` has a live
 * FOREIGN KEY to `tenants(id) ON DELETE CASCADE`. Only one tenant row
 * currently exists in this project (the dev-fallback tenant itself,
 * `00000000-0000-0000-0000-000000000001`) — there is no second real tenant
 * to insert against, and this file deliberately does not seed one (no
 * existing file in this family does either — cross-tenant isolation
 * testing is deferred to Block 1.9 per the Block 1.4a audit). That means an
 * INSERT using any other UUID as `tenant_id` is rejected by the FK
 * constraint regardless of RLS, so that rejection alone does NOT isolate
 * "RLS denied this" from "no such tenant exists." This test asserts only
 * that the insert fails, without claiming the failure is purely an RLS
 * violation.
 *
 * ON THE SELECT/UPDATE/DELETE DEFAULT-DENY ASSERTIONS — WHY THEY DON'T
 * CHECK RETURNED ROW DATA:
 * PostgREST does not require a row to be visible under a table's SELECT
 * policy in order to attempt an UPDATE or DELETE against it — RLS filters
 * which rows the command actually touches, not whether the command can be
 * issued. With no UPDATE or DELETE policy at all for `call_logs` after this
 * migration, both operations are expected to complete without error but
 * affect zero rows (the same shape already proven for default-deny commands
 * elsewhere in this family — see tests/quotes.migration.test.js's DELETE
 * assertion and tests/closedDeals.migration.test.js's UPDATE assertion) —
 * not to throw. The SELECT default-deny assertion also does not rely on
 * `.insert().select()` returning row data: PostgREST's INSERT RETURNING
 * output is itself filtered by the SELECT policy, so a chained `.select()`
 * on the INSERT would be expected to come back empty even though the
 * INSERT succeeded — asserting on that would test an incidental
 * interaction, not the thing this test is for (the same reasoning
 * documented in tests/smartLeads.migration.test.js's file header for its
 * own soft-delete diagnostic). The SELECT check here is a separate,
 * explicit `.select()` call after the INSERT, checked independently.
 *
 * WHY THIS FILE IS SKIPPED BY DEFAULT:
 * set RUN_DB_INTEGRATION_TESTS=true to run it manually, after the migration
 * has been applied. It is never run as part of `npm test` / CI. The
 * privileged cleanup block additionally requires SUPABASE_SERVICE_ROLE_KEY
 * — see the cleanup-limitation note above for what happens without one.
 *
 * HOW TO RUN, MANUALLY, AFTER THE MIGRATION IS APPLIED:
 *   RUN_DB_INTEGRATION_TESTS=true npx vitest run tests/callLogs.migration.test.js
 *
 * TEST DATA NOTES:
 * - `call_logs` has no UNIQUE constraint suitable as a marker column, so
 *   every insert that needs one uses a distinct, timestamped/randomised
 *   value in `notes` (nullable, no uniqueness constraint, no CHECK
 *   constraint) as the lookup key for that test's row.
 * - `outcome` is NOT NULL with a CHECK constraint restricting it to a fixed
 *   set of values and no column default — every insert payload supplies a
 *   valid value (`'no_answer'`) explicitly. `tenant_id` is the only other
 *   column that meaningfully needs to be supplied; `direction` defaults to
 *   `'outbound'` and everything else is nullable or has a default.
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

const DEV_TENANT_ID = '00000000-0000-0000-0000-000000000001'; // verified to exist, 2026-07-16
const NONEXISTENT_TENANT_ID = '11111111-1111-1111-1111-111111111111'; // no such tenants row (see header caveat)
const MARKER_PREFIX = '__integration_test__call_logs_contract__';

function uniqueMarker() {
  return `${MARKER_PREFIX}${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

function validRow(tenantId, overrides = {}) {
  return {
    tenant_id: tenantId,
    outcome: 'no_answer',
    notes: uniqueMarker(),
    ...overrides,
  };
}

// Cleanup by `notes` marker — only possible via a privileged client, since
// anon has no SELECT or DELETE policy on call_logs after this migration
// (see the file header's cleanup-limitation note). A no-op, clearly
// documented as such, when no service-role key is configured — the row
// stays in the table, tagged with MARKER_PREFIX, for manual/future cleanup.
async function cleanupByMarker(marker) {
  if (!canCleanupPrivileged) {
    console.warn(
      `⚠️  [callLogs.migration.test.js] No SUPABASE_SERVICE_ROLE_KEY configured — leaving residual call_logs row (notes="${marker}") uncleaned. See file header.`
    );
    return;
  }
  await service.from('call_logs').delete().eq('notes', marker).eq('tenant_id', DEV_TENANT_ID);
}

maybeDescribe('call_logs — real Postgres/RLS contract (run manually post-migration)', () => {
  it('anon INSERT with a tenant_id that does not exist is rejected', async () => {
    const { error } = await anon.from('call_logs').insert(validRow(NONEXISTENT_TENANT_ID));
    // Rejected either by the FK constraint (no such tenants row) or by RLS
    // (mismatched tenant_id satisfies neither branch of the scoped policy's
    // OR) — see header caveat on why this test cannot isolate which one.
    // No row is created either way, so no cleanup is needed here.
    expect(error).not.toBeNull();
  });

  // Combined into a single test — INSERT, then SELECT/UPDATE/DELETE
  // default-deny — deliberately reusing the ONE row this creates for all
  // four assertions, rather than one row per assertion, to keep this
  // file's total footprint to at most a single residual row when no
  // service-role key is configured (see the cleanup-limitation header note).
  it('anon can INSERT a row for the dev-fallback tenant; SELECT/UPDATE/DELETE on it are all default-deny', async () => {
    const marker = uniqueMarker();
    try {
      const { error: insertErr } = await anon.from('call_logs').insert(validRow(DEV_TENANT_ID, { notes: marker }));
      expect(insertErr).toBeNull();

      // SELECT default-deny — separate SELECT call, not relying on
      // INSERT's own RETURNING output (see header).
      const { data: selectData, error: selectErr } = await anon
        .from('call_logs')
        .select('id, notes')
        .eq('notes', marker);
      expect(selectErr).toBeNull();
      expect(selectData).toEqual([]);

      // UPDATE default-deny — with no UPDATE policy at all, expected to
      // complete without error but affect zero rows, not to throw.
      const { data: updateData, error: updateErr } = await anon
        .from('call_logs')
        .update({ outcome: 'interested' })
        .eq('notes', marker)
        .select('id');
      expect(updateErr).toBeNull();
      expect(updateData).toEqual([]);

      // DELETE default-deny — no DELETE policy before or after this
      // migration; same expected shape as UPDATE above. This also means
      // anon's own DELETE attempt (the thing under test) cannot be relied
      // on for cleanup — see the `finally` block below.
      const { data: deleteData, error: deleteErr } = await anon
        .from('call_logs')
        .delete()
        .eq('notes', marker)
        .select('id');
      expect(deleteErr).toBeNull();
      expect(deleteData).toEqual([]);
    } finally {
      await cleanupByMarker(marker);
    }
  });
});

if (!canRun) {
  describe('call_logs — real Postgres/RLS contract', () => {
    it.skip('SKIPPED: set RUN_DB_INTEGRATION_TESTS=true after applying the Block 1.8 migration to run these', () => {});
  });
}
