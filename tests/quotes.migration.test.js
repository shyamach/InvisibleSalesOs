/**
 * tests/quotes.migration.test.js
 *
 * RLS contract for `quotes` after
 * supabase/migrations/phase_1_6b_drop_quotes_permissive_policy.sql
 * (DRAFT, not yet applied).
 *
 * WHY THIS FILE DOES NOT FOLLOW THE REPO'S USUAL MOCKED-SUPABASE PATTERN:
 * RLS policies are enforced by real Postgres, not the JS client — a mock
 * would "pass" these assertions regardless of whether the real policy state
 * matches. These tests use the REAL Supabase client (anon key, same as the
 * rest of the app) on purpose, following the pattern in
 * tests/emailThreads.migration.test.js, tests/closedDeals.migration.test.js,
 * and tests/invoices.migration.test.js.
 *
 * HOW THIS DIFFERS FROM THE OTHER THREE:
 * `quotes` keeps correct tenant-scoped SELECT/INSERT/UPDATE policies
 * (quotes_tenant_select/_insert/_update) after this migration — like
 * invoices, not like email_threads (no scoped sibling at all) or
 * closed_deals (only SELECT/INSERT scoped). Unlike invoices, `quotes` has
 * NO scoped DELETE sibling and this migration does not add one: the legacy
 * `tenant_quotes_delete` (qual = true) is dropped with nothing to replace
 * it, by design, because no DELETE route/UI/app code exists anywhere in
 * this codebase for quotes (confirmed by repo-wide grep) and no FK cascades
 * into a quote delete either. So DELETE becomes fully default-deny — this
 * file verifies that explicitly, the same way tests/closedDeals.migration.
 * test.js verifies UPDATE-denial for a command with no policy at all.
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
 * like invoices, `quotes.tenant_id` has a live FOREIGN KEY to
 * `tenants(id) ON DELETE CASCADE`. Only one tenant row currently exists in
 * this project (the dev-fallback tenant itself,
 * `00000000-0000-0000-0000-000000000001`) — there is no second real tenant
 * to insert against. That means an INSERT using any other UUID as
 * `tenant_id` is rejected by the FK constraint regardless of RLS, so that
 * rejection alone does NOT isolate "RLS denied this" from "no such tenant
 * exists." This test asserts only that the insert fails, without asserting
 * the error is specifically an RLS violation — a stronger, RLS-only
 * assertion needs a second seeded tenant row, deferred to the same open
 * work as cross-tenant SELECT isolation (Block 1.9 per the Block 1.4a
 * audit).
 *
 * WHY THIS FILE IS SKIPPED BY DEFAULT:
 * set RUN_DB_INTEGRATION_TESTS=true to run it manually, after the migration
 * has been applied. It is never run as part of `npm test` / CI.
 *
 * HOW TO RUN, MANUALLY, AFTER THE MIGRATION IS APPLIED:
 *   RUN_DB_INTEGRATION_TESTS=true npx vitest run tests/quotes.migration.test.js
 *
 * TEST DATA NOTES:
 * - `quote_number` is NOT NULL with a UNIQUE (tenant_id, quote_number)
 *   constraint — every insert uses a distinct, timestamped/randomised
 *   marker value so repeat runs never collide.
 * - `tenant_id` and `quote_number` are the only NOT NULL columns without a
 *   default — every insert payload supplies just those two.
 * - `status` has a CHECK constraint restricting it to
 *   draft/sent/accepted/rejected/expired — cleanup below uses `expired` as
 *   a soft "this row is done" marker, not a real status value collision.
 * - CLEANUP: because DELETE is default-deny after this migration (that is
 *   the behaviour under test), the anon client used here has no way to
 *   truly remove rows it inserts, unlike tests/invoices.migration.test.js
 *   (which retains a scoped DELETE policy and can clean up for real). Every
 *   test that creates a row instead best-effort UPDATEs it to
 *   `status: 'expired'` in a `finally` block via the retained scoped UPDATE
 *   policy — a soft marker, not true removal. This intentionally leaves
 *   residual `status: 'expired'` rows tagged with the MARKER_PREFIX under
 *   the dev-fallback tenant after each run, the same accepted trade-off
 *   documented in tests/closedDeals.migration.test.js for its
 *   anon-cannot-DELETE table.
 */
import { describe, it, expect } from 'vitest';
import { createClient } from '@supabase/supabase-js';

const RUN_INTEGRATION = process.env.RUN_DB_INTEGRATION_TESTS === 'true';
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
const canRun = RUN_INTEGRATION && Boolean(supabaseUrl) && Boolean(supabaseAnonKey);

const maybeDescribe = canRun ? describe : describe.skip;
const anon = canRun ? createClient(supabaseUrl, supabaseAnonKey) : null;

const DEV_TENANT_ID = '00000000-0000-0000-0000-000000000001'; // verified to exist, 2026-07-14
const NONEXISTENT_TENANT_ID = '11111111-1111-1111-1111-111111111111'; // no such tenants row (see header caveat)
const MARKER_PREFIX = '__integration_test__quotes_contract__';

function uniqueQuoteNumber() {
  return `${MARKER_PREFIX}${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

function validRow(tenantId, overrides = {}) {
  return {
    tenant_id: tenantId,
    quote_number: uniqueQuoteNumber(),
    ...overrides,
  };
}

// Best-effort soft-cleanup by quote_number marker — marks the row 'expired'
// via the retained scoped UPDATE policy, since anon has no DELETE policy to
// remove it for real (see header). Run in `finally` so it still fires if an
// assertion above it throws. Supabase normally returns cleanup errors in the
// response object rather than throwing; this helper is best-effort and does
// not assert on cleanup success.
async function softCleanupByQuoteNumber(marker) {
  await anon.from('quotes').update({ status: 'expired' }).eq('quote_number', marker);
}

maybeDescribe('quotes — real Postgres/RLS contract (run manually post-migration)', () => {
  it('anon can INSERT a row for the dev-fallback tenant (scoped policy, interim dev-fallback branch)', async () => {
    const marker = uniqueQuoteNumber();
    try {
      const { error } = await anon.from('quotes').insert(validRow(DEV_TENANT_ID, { quote_number: marker }));
      expect(error).toBeNull();
    } finally {
      await softCleanupByQuoteNumber(marker);
    }
  });

  it('anon INSERT with a tenant_id that does not exist is rejected', async () => {
    const { error } = await anon.from('quotes').insert(validRow(NONEXISTENT_TENANT_ID));
    // Rejected either by the FK constraint (no such tenants row) or by RLS
    // (mismatched tenant_id satisfies neither branch of the scoped policy's
    // OR) — see header caveat on why this test cannot isolate which one.
    expect(error).not.toBeNull();
  });

  it('anon SELECT: a row inserted for the dev-fallback tenant is visible via the scoped policy', async () => {
    const marker = uniqueQuoteNumber();
    try {
      const { error: insertErr } = await anon.from('quotes').insert(validRow(DEV_TENANT_ID, { quote_number: marker }));
      expect(insertErr).toBeNull();

      const { data, error } = await anon
        .from('quotes')
        .select('id, tenant_id, quote_number')
        .eq('quote_number', marker);

      // This only demonstrates the dev-fallback branch of the scoped policy
      // grants visibility for a row it inserted itself — it does NOT prove
      // isolation from a pre-existing other-tenant row (see header caveat).
      expect(error).toBeNull();
      expect(data).toHaveLength(1);
      expect(data[0].tenant_id).toBe(DEV_TENANT_ID);
    } finally {
      await softCleanupByQuoteNumber(marker);
    }
  });

  it('anon can UPDATE a dev-fallback tenant row (scoped policy retained)', async () => {
    const marker = uniqueQuoteNumber();
    try {
      const { error: insertErr } = await anon.from('quotes').insert(validRow(DEV_TENANT_ID, { quote_number: marker }));
      expect(insertErr).toBeNull();

      const { error, data } = await anon
        .from('quotes')
        .update({ notes: 'updated by quotes.migration.test.js' })
        .eq('quote_number', marker)
        .select('id, notes');

      expect(error).toBeNull();
      expect(data).toHaveLength(1);
      expect(data[0].notes).toBe('updated by quotes.migration.test.js');
    } finally {
      await softCleanupByQuoteNumber(marker);
    }
  });

  it('anon cannot DELETE (legacy tenant_quotes_delete dropped, no scoped replacement by design → default-deny)', async () => {
    const marker = uniqueQuoteNumber();
    try {
      const { error: insertErr } = await anon.from('quotes').insert(validRow(DEV_TENANT_ID, { quote_number: marker }));
      expect(insertErr).toBeNull();

      const { error, data } = await anon
        .from('quotes')
        .delete()
        .eq('quote_number', marker)
        .select('id');

      // No DELETE policy at all after this migration → zero rows visible
      // for DELETE purposes → the operation "succeeds" affecting nothing,
      // the same shape as tests/closedDeals.migration.test.js's
      // no-UPDATE-policy assertion. RLS evaluates each command's policy set
      // independently, so this row stays SELECT/UPDATE-visible even though
      // it is now permanently undeletable via this anon client.
      expect(error).toBeNull();
      expect(data).toEqual([]);

      const { data: stillThere, error: selectErr } = await anon
        .from('quotes')
        .select('id')
        .eq('quote_number', marker);
      expect(selectErr).toBeNull();
      expect(stillThere).toHaveLength(1);
    } finally {
      // Cannot truly remove this row (that is the behaviour under test) —
      // best-effort soft-mark it via the retained UPDATE policy instead.
      await softCleanupByQuoteNumber(marker);
    }
  });
});

if (!canRun) {
  describe('quotes — real Postgres/RLS contract', () => {
    it.skip('SKIPPED: set RUN_DB_INTEGRATION_TESTS=true after applying the Block 1.6b migration to run these', () => {});
  });
}
