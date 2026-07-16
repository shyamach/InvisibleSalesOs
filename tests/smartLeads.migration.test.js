/**
 * tests/smartLeads.migration.test.js
 *
 * RLS contract for `smart_leads` after
 * supabase/migrations/phase_1_7b_drop_smart_leads_permissive_policy.sql
 * (APPLIED live 2026-07-16 — see DB_AUDIT_REPORT.md once documented).
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
 * the migration file's header for the full rationale.
 *
 * ⚠️ LIVE DIAGNOSTIC FINDING (2026-07-16) — WHY SOFT-DELETE IS TESTED IN TWO
 * PARTS, NOT ONE:
 * An earlier version of this file asserted that anon could set `deleted_at`
 * via UPDATE and then find the row excluded from its own SELECT. That
 * assertion was wrong, and failed live with `42501 — new row violates row-
 * level security policy`. Root cause, confirmed by direct anon-client
 * reproduction: PostgREST always executes UPDATE as `UPDATE ... RETURNING *`
 * internally, regardless of whether the client chains `.select()` (a retry
 * with `.select()` chained produced the byte-identical error). Postgres RLS
 * requires the RETURNING row to satisfy the table's SELECT policy — and
 * `smart_leads_tenant_update` has no explicit `WITH CHECK`, so it falls back
 * to reusing its own `USING` clause (tenant-only, says nothing about
 * `deleted_at`) rather than the SELECT policy's stricter one. The result:
 * the moment an UPDATE would make a row invisible to `smart_leads_tenant_
 * select`, Postgres rejects the whole statement instead of silently
 * succeeding. The failed UPDATE does not partially apply (`deleted_at`
 * stays null). This is expected, well-understood Postgres+PostgREST RLS
 * behaviour, not a defect in the migration — and no app code path anywhere
 * in this codebase soft-deletes `smart_leads` today, so anon self-service
 * soft-delete was never an actual requirement to prove.
 *
 * Given that, this file now tests two separate things:
 *   1. Anon CANNOT set `deleted_at` on its own row (expected, see above) —
 *      exercised with the real anon client, always runs when this file runs.
 *   2. The SELECT policy's `deleted_at IS NULL` clause actually excludes an
 *      already-soft-deleted row — proven by seeding that state with a
 *      privileged/service-role client (which bypasses RLS entirely, sidestepping
 *      the anon-only interaction in #1 — matching how any future real
 *      soft-delete feature would plausibly be implemented: server-side, not
 *      raw anon), then confirming anon's SELECT excludes it. This second
 *      block is gated separately on `SUPABASE_SERVICE_ROLE_KEY` and is
 *      SKIPPED if that key isn't configured (see below).
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
 * set RUN_DB_INTEGRATION_TESTS=true to run it manually. It is never run as
 * part of `npm test` / CI. The privileged soft-delete invariant block
 * additionally requires SUPABASE_SERVICE_ROLE_KEY — this repo's .env.local
 * does not currently define one (by design; see the "Browser-side... use
 * ANON key only, never service_role" comment in .env.local), so that block
 * is skipped in this environment and will activate automatically if a
 * service-role key is ever added.
 *
 * HOW TO RUN, MANUALLY:
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
 * - Rows inserted under the dev-fallback tenant via the anon client are
 *   deleted at the end of each test that creates one, via a try/finally
 *   around each test body, so cleanup still runs if an assertion above it
 *   throws. Rows inserted via the privileged client in the soft-delete
 *   invariant block are cleaned up the same way, using the privileged
 *   client (filtered by both marker and tenant_id) since it bypasses RLS
 *   regardless of the row's deleted_at state.
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
// still fires if an assertion above it throws. Swallows its own error since
// a failed cleanup shouldn't mask the real test failure.
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

  it('anon CANNOT set deleted_at on its own row (expected RLS/PostgREST interaction — see header)', async () => {
    const marker = uniqueMarker();
    try {
      const { error: insertErr } = await anon.from('smart_leads').insert(validRow(DEV_TENANT_ID, { lead_channel_id: marker }));
      expect(insertErr).toBeNull();

      const { error: softDeleteErr } = await anon
        .from('smart_leads')
        .update({ deleted_at: new Date().toISOString() })
        .eq('lead_channel_id', marker);

      // Expected to fail with 42501: PostgREST always runs UPDATE with an
      // internal RETURNING clause, and Postgres RLS requires the resulting
      // row to satisfy the table's SELECT policy. smart_leads_tenant_update
      // has no explicit WITH CHECK (falls back to its tenant-only USING
      // clause), so nothing about this UPDATE policy stops deleted_at from
      // being set — but the row that would result no longer satisfies
      // smart_leads_tenant_select's `AND deleted_at IS NULL`, so Postgres
      // rejects the whole statement rather than silently succeeding. See
      // the file header for the full diagnostic writeup (confirmed live,
      // 2026-07-16, including that this happens identically whether or not
      // `.select()` is chained).
      expect(softDeleteErr).not.toBeNull();
      expect(softDeleteErr.code).toBe('42501');

      // Confirm no partial application: row is untouched, still visible,
      // deleted_at still null.
      const { data, error: selectErr } = await anon
        .from('smart_leads')
        .select('id, deleted_at')
        .eq('lead_channel_id', marker);
      expect(selectErr).toBeNull();
      expect(data).toHaveLength(1);
      expect(data[0].deleted_at).toBeNull();
    } finally {
      await cleanupByMarker(marker);
    }
  });
});

// ─── Privileged/service-role: the SELECT soft-delete invariant ──────────────
//
// The assertion that actually matters for Block 1.7b — "a row with
// deleted_at set is excluded from SELECT" — can't be proven by having anon
// perform the soft-delete itself (see the test above and the file header).
// This block seeds that state directly with a privileged client, which
// bypasses RLS entirely and sidesteps the anon-only PostgREST/RLS
// interaction — matching how any future real soft-delete feature would
// plausibly be implemented (server-side, not raw anon). No such feature
// exists in the app today; this only verifies the policy itself works.
//
// Gated separately from the rest of this file on SUPABASE_SERVICE_ROLE_KEY —
// see the file header for why that's expected to be unset in this repo.
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const canRunPrivileged = canRun && Boolean(supabaseServiceRoleKey);
const maybeDescribePrivileged = canRunPrivileged ? describe : describe.skip;
const service = canRunPrivileged ? createClient(supabaseUrl, supabaseServiceRoleKey) : null;

maybeDescribePrivileged('smart_leads — SELECT soft-delete invariant (requires SUPABASE_SERVICE_ROLE_KEY)', () => {
  it('a row soft-deleted via a privileged client is excluded from anon SELECT', async () => {
    const marker = uniqueMarker();
    try {
      const { error: insertErr } = await service
        .from('smart_leads')
        .insert(validRow(DEV_TENANT_ID, { lead_channel_id: marker, deleted_at: new Date().toISOString() }));
      expect(insertErr).toBeNull();

      const { data, error: selectErr } = await anon
        .from('smart_leads')
        .select('id')
        .eq('lead_channel_id', marker);

      expect(selectErr).toBeNull();
      expect(data).toEqual([]);
    } finally {
      // Service role bypasses RLS entirely, so this reaches the row
      // regardless of its deleted_at state or anon's DELETE policy.
      await service.from('smart_leads').delete().eq('lead_channel_id', marker).eq('tenant_id', DEV_TENANT_ID);
    }
  });
});

if (canRun && !canRunPrivileged) {
  describe('smart_leads — SELECT soft-delete invariant', () => {
    it.skip('SKIPPED: set SUPABASE_SERVICE_ROLE_KEY to run the privileged soft-delete SELECT-exclusion test', () => {});
  });
}

if (!canRun) {
  describe('smart_leads — real Postgres/RLS contract', () => {
    it.skip('SKIPPED: set RUN_DB_INTEGRATION_TESTS=true after applying the Block 1.7b migration to run these', () => {});
  });
}
