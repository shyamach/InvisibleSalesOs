/**
 * tests/invoices.migration.test.js
 *
 * RLS contract for `invoices` after
 * supabase/migrations/phase_1_5b_drop_invoices_permissive_policy.sql
 * (DRAFT, not yet applied).
 *
 * WHY THIS FILE DOES NOT FOLLOW THE REPO'S USUAL MOCKED-SUPABASE PATTERN:
 * RLS policies are enforced by real Postgres, not the JS client — a mock
 * would "pass" these assertions regardless of whether the real policy state
 * matches. These tests use the REAL Supabase client (anon key, same as the
 * rest of the app) on purpose, following the pattern in
 * tests/emailThreads.migration.test.js and tests/closedDeals.migration.test.js.
 *
 * HOW THIS DIFFERS FROM tests/emailThreads.migration.test.js AND
 * tests/closedDeals.migration.test.js:
 * `invoices` already has a correct tenant-scoped policy for ALL FOUR
 * commands (invoices_tenant_select/_insert/_update/_delete), unlike
 * email_threads (no scoped sibling at all → full default-deny after the
 * drop) or closed_deals (only SELECT/INSERT had a scoped sibling → UPDATE/
 * DELETE became default-deny after the drop). So this migration is a strict
 * risk-reduction drop with full CRUD coverage retained — and, unusually for
 * this family of tests, the anon client can actually DELETE the rows it
 * inserts, so this file cleans up its own test data (the sibling files
 * cannot, and say so in their own headers).
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
 * tenants. That remains open work (Block 1's `auth.uid() → tenant_id`
 * mapping, still not implemented anywhere in this codebase).
 *
 * ON THE MISMATCHED-TENANT INSERT TEST — A SCHEMA CAVEAT WORTH FLAGGING:
 * unlike closed_deals, `invoices.tenant_id` has a live FOREIGN KEY to
 * `tenants(id) ON DELETE CASCADE`. Only one tenant row currently exists in
 * this project (the dev-fallback tenant itself, `00000000-0000-0000-0000-
 * 000000000001`) — there is no second real tenant to insert against. That
 * means an INSERT using any other UUID as `tenant_id` is rejected by the FK
 * constraint regardless of RLS, so that rejection alone does NOT isolate
 * "RLS denied this" from "no such tenant exists." This test asserts only
 * that the insert fails, without asserting the error is specifically an RLS
 * violation — a stronger, RLS-only assertion needs a second seeded tenant
 * row, deferred to the same open work as cross-tenant SELECT isolation
 * (Block 1.9 per the Block 1.4a audit).
 *
 * WHY THIS FILE IS SKIPPED BY DEFAULT:
 * set RUN_DB_INTEGRATION_TESTS=true to run it manually, after the migration
 * has been applied. It is never run as part of `npm test` / CI.
 *
 * HOW TO RUN, MANUALLY, AFTER THE MIGRATION IS APPLIED:
 *   RUN_DB_INTEGRATION_TESTS=true npx vitest run tests/invoices.migration.test.js
 *
 * TEST DATA NOTES:
 * - `invoice_number` has no UNIQUE constraint, but every insert still uses a
 *   distinct, timestamped/randomised marker value so assertions never read
 *   back a stray row from a previous run.
 * - `tenant_id` and `invoice_number` are the only NOT NULL columns without a
 *   default — every insert payload supplies just those two.
 * - Rows inserted under the dev-fallback tenant are deleted at the end of
 *   each test that creates one, since the scoped DELETE policy allows it —
 *   via a try/finally around each test body, so cleanup still runs if an
 *   assertion above it throws.
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
const NONEXISTENT_TENANT_ID = '11111111-1111-1111-1111-111111111111'; // no such tenants row (see header caveat)
const MARKER_PREFIX = '__integration_test__invoices_contract__';

function uniqueInvoiceNumber() {
  return `${MARKER_PREFIX}${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

function validRow(tenantId, overrides = {}) {
  return {
    tenant_id: tenantId,
    invoice_number: uniqueInvoiceNumber(),
    ...overrides,
  };
}

// Best-effort cleanup by invoice_number marker — run in `finally` so it
// still fires if an assertion above it throws. Swallows its own error since
// a failed cleanup shouldn't mask the real test failure.
async function cleanupByInvoiceNumber(marker) {
  await anon.from('invoices').delete().eq('invoice_number', marker);
}

maybeDescribe('invoices — real Postgres/RLS contract (run manually post-migration)', () => {
  it('anon can INSERT a row for the dev-fallback tenant (scoped policy, interim dev-fallback branch)', async () => {
    const marker = uniqueInvoiceNumber();
    try {
      const { error } = await anon.from('invoices').insert(validRow(DEV_TENANT_ID, { invoice_number: marker }));
      expect(error).toBeNull();
    } finally {
      await cleanupByInvoiceNumber(marker);
    }
  });

  it('anon INSERT with a tenant_id that does not exist is rejected', async () => {
    const { error } = await anon.from('invoices').insert(validRow(NONEXISTENT_TENANT_ID));
    // Rejected either by the FK constraint (no such tenants row) or by RLS
    // (mismatched tenant_id satisfies neither branch of the scoped policy's
    // OR) — see header caveat on why this test cannot isolate which one.
    expect(error).not.toBeNull();
  });

  it('anon SELECT: a row inserted for the dev-fallback tenant is visible via the scoped policy', async () => {
    const marker = uniqueInvoiceNumber();
    try {
      const { error: insertErr } = await anon.from('invoices').insert(validRow(DEV_TENANT_ID, { invoice_number: marker }));
      expect(insertErr).toBeNull();

      const { data, error } = await anon
        .from('invoices')
        .select('id, tenant_id, invoice_number')
        .eq('invoice_number', marker);

      // This only demonstrates the dev-fallback branch of the scoped policy
      // grants visibility for a row it inserted itself — it does NOT prove
      // isolation from a pre-existing other-tenant row (see header caveat).
      expect(error).toBeNull();
      expect(data).toHaveLength(1);
      expect(data[0].tenant_id).toBe(DEV_TENANT_ID);
    } finally {
      await cleanupByInvoiceNumber(marker);
    }
  });

  it('anon can UPDATE a dev-fallback tenant row (scoped policy retained, unlike email_threads/closed_deals)', async () => {
    const marker = uniqueInvoiceNumber();
    try {
      const { error: insertErr } = await anon.from('invoices').insert(validRow(DEV_TENANT_ID, { invoice_number: marker }));
      expect(insertErr).toBeNull();

      const { error, data } = await anon
        .from('invoices')
        .update({ notes: 'updated by invoices.migration.test.js' })
        .eq('invoice_number', marker)
        .select('id, notes');

      expect(error).toBeNull();
      expect(data).toHaveLength(1);
      expect(data[0].notes).toBe('updated by invoices.migration.test.js');
    } finally {
      await cleanupByInvoiceNumber(marker);
    }
  });

  it('anon can DELETE a dev-fallback tenant row (scoped policy retained, unlike email_threads/closed_deals)', async () => {
    const marker = uniqueInvoiceNumber();
    try {
      const { error: insertErr } = await anon.from('invoices').insert(validRow(DEV_TENANT_ID, { invoice_number: marker }));
      expect(insertErr).toBeNull();

      const { error, data } = await anon
        .from('invoices')
        .delete()
        .eq('invoice_number', marker)
        .select('id');

      expect(error).toBeNull();
      expect(data).toHaveLength(1);

      const { data: postDelete } = await anon
        .from('invoices')
        .select('id')
        .eq('invoice_number', marker);
      expect(postDelete).toEqual([]);
    } finally {
      // Row is already gone via the DELETE under test, but this stays
      // harmless/idempotent if that assertion failed before deleting it.
      await cleanupByInvoiceNumber(marker);
    }
  });
});

if (!canRun) {
  describe('invoices — real Postgres/RLS contract', () => {
    it.skip('SKIPPED: set RUN_DB_INTEGRATION_TESTS=true after applying the Block 1.5b migration to run these', () => {});
  });
}
