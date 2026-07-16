/**
 * tests/smartLeads.migration.test.js
 *
 * RLS contract for `smart_leads` after
 * supabase/migrations/phase_1_7b_drop_smart_leads_permissive_policy.sql
 * (DRAFT, not yet applied).
 *
 * WHY THIS FILE DOES NOT FOLLOW THE REPO'S USUAL MOCKED-SUPABASE PATTERN:
 * RLS policies are enforced by real Postgres, not the JS client — a mock
 * would "pass" these assertions regardless of whether the real policy state
 * matches. These tests use the REAL Supabase client (anon key, same as the
 * rest of the app) on purpose, following the pattern in
 * tests/emailThreads.migration.test.js, tests/closedDeals.migration.test.js,
 * tests/invoices.migration.test.js, and tests/quotes.migration.test.js.
 *
 * HOW THIS DIFFERS FROM THE REST OF THE FAMILY:
 * `smart_leads` keeps correct tenant-scoped SELECT/INSERT/UPDATE/DELETE
 * policies after this migration — like invoices, not like email_threads (no
 * scoped sibling at all) or quotes/closed_deals (partial coverage, some
 * commands become default-deny). Unlike every sibling in this family,
 * `smart_leads` ALSO gets its scoped SELECT policy replaced (not just the
 * legacy ones dropped): `smart_leads_tenant_select` is recreated with an
 * added `AND deleted_at IS NULL` clause, to preserve the soft-delete
 * enforcement the legacy `tenant_leads_select` used to provide alone. See
 * the migration file's header for the full rationale. Because DELETE stays
 * scoped-but-available (like invoices), this file can genuinely clean up
 * every row it inserts, including the soft-deleted one from the
 * soft-delete-parity test below — DELETE's policy only checks `tenant_id`,
 * not `deleted_at`, so a row that has become invisible to SELECT is still
 * reachable by DELETE.
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
 * mapping, still not implemented anywhere in this codebase). This file
 * tests interim dev-fallback behaviour only, not final authenticated
 * multi-tenant isolation.
 *
 * ON THE MISMATCHED-TENANT INSERT TEST — A SCHEMA CAVEAT WORTH FLAGGING:
 * like invoices and quotes, `smart_leads.tenant_id` has a live FOREIGN KEY
 * to `tenants(id) ON DELETE CASCADE`. Only one tenant row currently exists
 * in this project (the dev-fallback tenant itself, `00000000-0000-0000-
 * 0000-000000000001`) — there is no second real tenant to insert against,
 * and this file deliberately does not seed one (no existing file in this
 * family does either — cross-tenant isolation testing is deferred to Block
 * 1.9 per the Block 1.4a audit). That means an INSERT using any other UUID
 * as `tenant_id` is rejected by the FK constraint regardless of RLS, so
 * that rejection alone does NOT isolate "RLS denied this" from "no such
 * tenant exists." This test asserts only that the insert fails, without
 * claiming the failure is purely an RLS violation.
 *
 * WHY THIS FILE IS SKIPPED BY DEFAULT:
 * set RUN_DB_INTEGRATION_TESTS=true to run it manually, after the migration
 * has been applied. It is never run as part of `npm test` / CI.
 *
 * HOW TO RUN, MANUALLY, AFTER THE MIGRATION IS APPLIED:
 *   RUN_DB_INTEGRATION_TESTS=true npx vitest run tests/smartLeads.migration.test.js
 *
 * TEST DATA NOTES:
 * - `smart_leads` has no UNIQUE constraint suitable as a marker column, so
 *   every insert uses a distinct, timestamped/randomised value in
 *   `lead_channel_id` (nullable, no uniqueness constraint) as the lookup
 *   key for that test's row — collisions are practically impossible across
 *   runs given the timestamp+random suffix.
 * - `tenant_id` is the only column that meaningfully needs to be supplied
 *   for these tests — everything else has a column default or is nullable.
 * - Rows inserted under the dev-fallback tenant are deleted at the end of
 *   each test that creates one, via a try/finally around each test body, so
 *   cleanup still runs if an assertion above it throws.
 */
import { describe, it, expect } from 'vitest';
import { createClient } from '@supabase/supabase-js';

const RUN_INTEGRATION = process.env.RUN_DB_INTEGRATION_TESTS === 'true';
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
const canRun = RUN_INTEGRATION && Boolean(supabaseUrl) && Boolean(supabaseAnonKey);

const maybeDescribe = canRun ? describe : describe.skip;
const anon = canRun ? createClient(supabaseUrl, supabaseAnonKey) : null;

const DEV_TENANT_ID = '00000000-0000-0000-0000-000000000001'; // verified to exist, 2026-07-16
const NONEXISTENT_TENANT_ID = '11111111-1111-1111-1111-111111111111'; // no such tenants row (see header caveat)
const MARKER_PREFIX = '__integration_test__smart_leads_contract__';

function uniqueMarker() {
  return `${MARKER_PREFIX}${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

function validRow(tenantId, overrides = {}) {
  return {
    tenant_id: tenantId,
    lead_channel_id: uniqueMarker(),
    ...overrides,
  };
}

// Best-effort cleanup by lead_channel_id marker — run in `finally` so it
// still fires if an assertion above it throws. DELETE's scoped policy only
// checks tenant_id, not deleted_at, so this reaches a row even after the
// soft-delete-parity test has made it invisible to SELECT. Swallows its own
// error since a failed cleanup shouldn't mask the real test failure.
async function cleanupByMarker(marker) {
  await anon.from('smart_leads').delete().eq('lead_channel_id', marker);
}

maybeDescribe('smart_leads — real Postgres/RLS contract (run manually post-migration)', () => {
  it('anon can INSERT a row for the dev-fallback tenant (scoped policy, interim dev-fallback branch)', async () => {
    const marker = uniqueMarker();
    try {
      const { error } = await anon.from('smart_leads').insert(validRow(DEV_TENANT_ID, { lead_channel_id: marker }));
      expect(error).toBeNull();
    } finally {
      await cleanupByMarker(marker);
    }
  });

  it('anon INSERT with a tenant_id that does not exist is rejected', async () => {
    const { error } = await anon.from('smart_leads').insert(validRow(NONEXISTENT_TENANT_ID));
    // Rejected either by the FK constraint (no such tenants row) or by RLS
    // (mismatched tenant_id satisfies neither branch of the scoped policy's
    // OR) — see header caveat on why this test cannot isolate which one.
    expect(error).not.toBeNull();
  });

  it('anon SELECT: a row inserted for the dev-fallback tenant is visible via the scoped policy', async () => {
    const marker = uniqueMarker();
    try {
      const { error: insertErr } = await anon.from('smart_leads').insert(validRow(DEV_TENANT_ID, { lead_channel_id: marker }));
      expect(insertErr).toBeNull();

      const { data, error } = await anon
        .from('smart_leads')
        .select('id, tenant_id, lead_channel_id, deleted_at')
        .eq('lead_channel_id', marker);

      // This only demonstrates the dev-fallback branch of the scoped policy
      // grants visibility for a row it inserted itself — it does NOT prove
      // isolation from a pre-existing other-tenant row (see header caveat).
      expect(error).toBeNull();
      expect(data).toHaveLength(1);
      expect(data[0].tenant_id).toBe(DEV_TENANT_ID);
      expect(data[0].deleted_at).toBeNull();
    } finally {
      await cleanupByMarker(marker);
    }
  });

  it('anon can UPDATE a dev-fallback tenant row (scoped policy retained)', async () => {
    const marker = uniqueMarker();
    try {
      const { error: insertErr } = await anon.from('smart_leads').insert(validRow(DEV_TENANT_ID, { lead_channel_id: marker }));
      expect(insertErr).toBeNull();

      const { error: updateErr } = await anon
        .from('smart_leads')
        .update({ triage_status: 'reviewed' })
        .eq('lead_channel_id', marker);

      expect(updateErr).toBeNull();

      const { data, error: selectErr } = await anon
        .from('smart_leads')
        .select('triage_status')
        .eq('lead_channel_id', marker);

      expect(selectErr).toBeNull();
      expect(data).toHaveLength(1);
      expect(data[0].triage_status).toBe('reviewed');
    } finally {
      await cleanupByMarker(marker);
    }
  });

  it('anon can DELETE a dev-fallback tenant row (scoped policy retained)', async () => {
    const marker = uniqueMarker();
    try {
      const { error: insertErr } = await anon.from('smart_leads').insert(validRow(DEV_TENANT_ID, { lead_channel_id: marker }));
      expect(insertErr).toBeNull();

      const { error: deleteErr } = await anon.from('smart_leads').delete().eq('lead_channel_id', marker);
      expect(deleteErr).toBeNull();

      const { data: postDelete, error: selectErr } = await anon
        .from('smart_leads')
        .select('id')
        .eq('lead_channel_id', marker);
      expect(selectErr).toBeNull();
      expect(postDelete).toEqual([]);
    } finally {
      // Row is already gone via the DELETE under test, but this stays
      // harmless/idempotent if that assertion failed before deleting it.
      await cleanupByMarker(marker);
    }
  });

  it('soft-delete parity: a dev-fallback row with deleted_at set disappears from SELECT, but can still be UPDATEd/DELETEd', async () => {
    const marker = uniqueMarker();
    try {
      const { error: insertErr } = await anon.from('smart_leads').insert(validRow(DEV_TENANT_ID, { lead_channel_id: marker }));
      expect(insertErr).toBeNull();

      // Sanity check: visible before the soft-delete.
      const { data: beforeData, error: beforeErr } = await anon
        .from('smart_leads')
        .select('id')
        .eq('lead_channel_id', marker);
      expect(beforeErr).toBeNull();
      expect(beforeData).toHaveLength(1);

      // Soft-delete via UPDATE. smart_leads_tenant_update's USING clause only
      // checks tenant_id (no WITH CHECK restriction), so setting deleted_at
      // is permitted by the UPDATE policy even though it makes the row
      // invisible to the (now deleted_at-aware) SELECT policy afterwards.
      // Deliberately not chaining .select() onto this UPDATE: Postgres RLS
      // filters RETURNING output through the table's SELECT policy, so a
      // RETURNING clause here would itself be filtered out by the very
      // deleted_at IS NULL clause under test — asserting on that would test
      // an incidental interaction, not the thing this test is for. The
      // SELECT immediately below is the real assertion.
      const { error: softDeleteErr } = await anon
        .from('smart_leads')
        .update({ deleted_at: new Date().toISOString() })
        .eq('lead_channel_id', marker);
      expect(softDeleteErr).toBeNull();

      // Core assertion: smart_leads_tenant_select's added
      // `AND deleted_at IS NULL` clause hides the row now.
      const { data: afterData, error: afterErr } = await anon
        .from('smart_leads')
        .select('id')
        .eq('lead_channel_id', marker);
      expect(afterErr).toBeNull();
      expect(afterData).toEqual([]);
    } finally {
      // DELETE's policy only checks tenant_id, not deleted_at, so cleanup
      // reaches this row even though it is no longer SELECT-visible — a
      // real removal, not a soft marker workaround.
      await cleanupByMarker(marker);
    }
  });
});

if (!canRun) {
  describe('smart_leads — real Postgres/RLS contract', () => {
    it.skip('SKIPPED: set RUN_DB_INTEGRATION_TESTS=true after applying the Block 1.7b migration to run these', () => {});
  });
}
