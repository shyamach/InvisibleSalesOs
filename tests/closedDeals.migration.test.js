/**
 * tests/closedDeals.migration.test.js
 *
 * RLS contract for `closed_deals` after
 * supabase/migrations/phase_1_4c_drop_closed_deals_permissive_policy.sql
 * (DRAFT, not yet applied).
 *
 * WHY THIS FILE DOES NOT FOLLOW THE REPO'S USUAL MOCKED-SUPABASE PATTERN:
 * RLS policies are enforced by real Postgres, not the JS client — a mock
 * would "pass" these assertions regardless of whether the real policy state
 * matches. These tests use the REAL Supabase client (anon key, same as the
 * rest of the app) on purpose, following the pattern in
 * tests/emailThreads.migration.test.js and tests/failedIngestions.migration.test.js.
 *
 * HOW THIS DIFFERS FROM tests/emailThreads.migration.test.js:
 * email_threads had no scoped sibling policy at all, so dropping its legacy
 * policies converts it to full default-deny for every command. `closed_deals`
 * already has correct tenant-scoped SELECT/INSERT policies
 * (closed_deals_tenant_select / closed_deals_tenant_insert) that are
 * untouched by this migration — so post-migration, SELECT and INSERT remain
 * usable, just scoped to a tenant, rather than denied outright. Only UPDATE
 * (and DELETE, which had no policy before or after) become default-deny.
 *
 * ⚠️ IMPORTANT — THIS REFLECTS INTERIM POLICY BEHAVIOUR, NOT THE FINAL MODEL:
 * the scoped policies use `tenant_id = auth_tenant_id() OR tenant_id =
 * <dev-fallback-tenant>` — the `OR <dev-fallback-tenant>` branch is a
 * pre-auth-mapping scaffold (see DB_AUDIT_REPORT.md §3 item 1 and the Block
 * 1.4a audit), not the desired production model. Under an anon client with
 * no JWT, `auth_tenant_id()` always evaluates to NULL, so every assertion
 * below that "succeeds" only does so via the dev-fallback branch matching
 * the literal dev-fallback tenant UUID — it is not proof that per-tenant
 * `auth.uid()`-based isolation works correctly for two *authenticated*
 * tenants. That remains open work, tracked separately (Block 1's
 * `auth.uid() → tenant_id` mapping, still not implemented anywhere in this
 * codebase). This test only proves: (a) a row belonging to a tenant OTHER
 * than the dev-fallback tenant is not visible/writable by anon, and (b) a
 * row belonging to the dev-fallback tenant still is — which is the correct,
 * intentionally scoped-down interim behaviour for a single-tenant system,
 * not full multi-tenant RLS enforcement.
 *
 * WHY THIS FILE IS SKIPPED BY DEFAULT:
 * set RUN_DB_INTEGRATION_TESTS=true to run it manually, after the migration
 * has been applied. It is never run as part of `npm test` / CI.
 *
 * HOW TO RUN, MANUALLY, AFTER THE MIGRATION IS APPLIED:
 *   RUN_DB_INTEGRATION_TESTS=true npx vitest run tests/closedDeals.migration.test.js
 *
 * TEST DATA NOTES:
 * - `invoice_number` has a UNIQUE constraint (nullable) — every insert uses
 *   a distinct, timestamped/randomised marker value so repeat runs never
 *   collide.
 * - `final_amount` is NOT NULL — every insert payload supplies it.
 * - `lead_id` is nullable with no FK constraint — omitted entirely to avoid
 *   any dependency on real lead data.
 * - Rows inserted under the dev-fallback tenant are left in place (anon has
 *   no DELETE policy on this table, before or after the migration, so the
 *   test client cannot clean them up itself) — same accepted trade-off
 *   documented in tests/failedIngestions.migration.test.js for its
 *   anon-INSERT-only table.
 */
import { describe, it, expect } from 'vitest';
import { createClient } from '@supabase/supabase-js';

const RUN_INTEGRATION = process.env.RUN_DB_INTEGRATION_TESTS === 'true';
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
const canRun = RUN_INTEGRATION && Boolean(supabaseUrl) && Boolean(supabaseAnonKey);

const maybeDescribe = canRun ? describe : describe.skip;
const anon = canRun ? createClient(supabaseUrl, supabaseAnonKey) : null;

const DEV_TENANT_ID = '00000000-0000-0000-0000-000000000001'; // verified to exist, 2026-07-02
const OTHER_TENANT_ID = '11111111-1111-1111-1111-111111111111';
const MARKER_PREFIX = '__integration_test__closed_deals_contract__';

function uniqueInvoiceNumber() {
  return `${MARKER_PREFIX}${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

function validRow(tenantId, overrides = {}) {
  return {
    tenant_id: tenantId,
    invoice_number: uniqueInvoiceNumber(),
    final_amount: 100,
    ...overrides,
  };
}

maybeDescribe('closed_deals — real Postgres/RLS contract (run manually post-migration)', () => {
  it('anon can INSERT a row for the dev-fallback tenant (scoped policy, interim dev-fallback branch)', async () => {
    const { error } = await anon.from('closed_deals').insert(validRow(DEV_TENANT_ID));
    expect(error).toBeNull();
  });

  it('anon INSERT with a different tenant_id is rejected by RLS', async () => {
    const { error } = await anon.from('closed_deals').insert(validRow(OTHER_TENANT_ID));
    // No auth.uid() context in this anon-only test, so the mismatched
    // tenant_id satisfies neither branch of the scoped policy's OR — the
    // insert is rejected outright with an RLS violation error, the same
    // shape as email_threads' post-migration INSERT denial.
    expect(error).not.toBeNull();
    expect(error.message.toLowerCase()).toMatch(/row-level security|policy/);
  });

  it('anon SELECT: a row inserted for the dev-fallback tenant is visible via the scoped policy', async () => {
    const marker = uniqueInvoiceNumber();
    const { error: insertErr } = await anon.from('closed_deals').insert(validRow(DEV_TENANT_ID, { invoice_number: marker }));
    expect(insertErr).toBeNull();

    const { data, error } = await anon
      .from('closed_deals')
      .select('id, tenant_id, invoice_number')
      .eq('invoice_number', marker);

    // This only demonstrates the dev-fallback branch of the scoped policy
    // grants visibility for a row it inserted itself — it does NOT prove
    // isolation from a pre-existing other-tenant row, since this anon
    // client can never create one to test against (see the INSERT
    // rejection test above). Cross-tenant SELECT isolation is unverified
    // here and remains open work (deferred to Block 1.9 per the Block 1.4a
    // audit, which needs a second real tenant to test against).
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data[0].tenant_id).toBe(DEV_TENANT_ID);
  });

  it('anon cannot UPDATE (no UPDATE policy remains → matches zero visible rows)', async () => {
    const marker = uniqueInvoiceNumber();
    const { error: insertErr } = await anon.from('closed_deals').insert(validRow(DEV_TENANT_ID, { invoice_number: marker }));
    expect(insertErr).toBeNull();

    const { error, data } = await anon
      .from('closed_deals')
      .update({ final_amount: 999 })
      .eq('invoice_number', marker)
      .select('id');
    // No UPDATE policy (legacy dropped, no scoped replacement exists) →
    // zero rows visible for UPDATE purposes → silently affects nothing,
    // even though the same row is SELECT-visible above. This is expected:
    // RLS evaluates each command's policy set independently.
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });
});

if (!canRun) {
  describe('closed_deals — real Postgres/RLS contract', () => {
    it.skip('SKIPPED: set RUN_DB_INTEGRATION_TESTS=true after applying the Block 1.4c migration to run these', () => {});
  });
}
