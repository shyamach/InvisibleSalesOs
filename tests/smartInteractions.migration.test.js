/**
 * tests/smartInteractions.migration.test.js
 *
 * RLS contract for `smart_interactions` after
 * supabase/migrations/phase_1_10b_drop_smart_interactions_permissive_policy.sql
 * (DRAFT, not yet applied), which follows the already-merged Block 1.10a
 * dispatch-proxy auth hotfix (commit 4e01380).
 *
 * WHY THIS FILE DOES NOT FOLLOW THE REPO'S USUAL MOCKED-SUPABASE PATTERN:
 * RLS policies are enforced by real Postgres, not the JS client — a mock
 * would "pass" these assertions regardless of whether the real policy state
 * matches. These tests use the REAL Supabase client (anon key, same as the
 * rest of the app) on purpose, following the pattern in
 * tests/emailThreads.migration.test.js, tests/closedDeals.migration.test.js,
 * tests/invoices.migration.test.js, tests/quotes.migration.test.js,
 * tests/smartLeads.migration.test.js, tests/callLogs.migration.test.js, and
 * tests/segments.migration.test.js.
 *
 * HOW THIS DIFFERS FROM THE REST OF THE FAMILY:
 * `smart_interactions` is not a zero-scoped-policy starting point like
 * `call_logs` (Block 1.8) or `segments` (Block 1.9) — SELECT and INSERT
 * already had correct scoped siblings (`interactions_tenant_select`,
 * `interactions_tenant_insert`) before this migration, and this migration
 * leaves both unchanged. Only UPDATE had no scoped sibling — the legacy
 * `tenant_interactions_update` (`USING true`) was the only thing serving
 * it — so this migration adds exactly one new policy
 * (`smart_interactions_tenant_update`) before dropping it. DELETE has no
 * scoped replacement (zero app dependents anywhere) and becomes fully
 * default-deny, the same reasoning already applied to `quotes`' DELETE
 * (Block 1.6b), `closed_deals`' UPDATE/DELETE (Block 1.4c), and `segments`'
 * DELETE (Block 1.9).
 *
 * THE UPDATE POLICY IS THE SOLE TENANT BOUNDARY FOR THREE LIVE FRONTEND
 * FLOWS: `frontend/src/app/app/drafts/page.tsx`'s `handleSaveAndSend`,
 * `handleDismiss`, and `handleEscalate` all call
 * `.from('smart_interactions').update(...).eq('id', draft.id)` with a raw
 * anon client and no tenant_id filter in the app-level query — the same
 * risk shape as `segments`' "Run Campaign" UPDATE (Block 1.9). The UPDATE
 * test below deliberately mirrors that shape (filtering only by `id`, not
 * `tenant_id`) rather than a more defensive `.eq('tenant_id', ...)` shape,
 * so it actually exercises the real risk this migration closes. (The
 * backend dispatch route's two UPDATEs, by contrast, already filter by
 * `req.tenantId` at the app level as of Block 1.10a — this table's UPDATE
 * policy is a backstop there, not the sole boundary.)
 *
 * ON THE TENANT_ID ESCAPE-HATCH ASSERTION: the migration's new
 * `smart_interactions_tenant_update` policy carries an explicit WITH CHECK
 * (identical to its USING clause) specifically so an UPDATE cannot move a
 * row's `tenant_id` to NULL or to a different tenant — see the migration
 * file's own "WHY THE NEW UPDATE POLICY CARRIES AN EXPLICIT WITH CHECK"
 * rationale. The test below attempts exactly that (`tenant_id: null`, then
 * `tenant_id: NONEXISTENT_TENANT_ID`) against the same row already proven
 * updatable above, and only asserts on the outcome that matters — the
 * row's `tenant_id` is still `DEV_TENANT_ID` afterward — not on HOW
 * Postgres rejects the attempt. Depending on Postgres/PostgREST version, a
 * WITH CHECK failure on a single-row UPDATE can surface either as a thrown
 * policy-violation error (the same shape already documented for
 * `smart_leads`' soft-delete UPDATE diagnostic in DB_AUDIT_REPORT.md's
 * Block 1.7b entry, where PostgREST's implicit RETURNING clause requires
 * the post-UPDATE row to satisfy WITH CHECK) or as a "0 rows affected"
 * result with no client-visible error. This assertion deliberately does
 * not pin down which shape occurs, so it isn't brittle to that
 * implementation detail.
 *
 * ⚠️ CLEANUP LIMITATION — READ BEFORE RUNNING:
 * DELETE is intentionally default-deny for `smart_interactions` after this
 * migration (that is itself part of what's under test), so the anon client
 * used here has NO way to truly remove the row it inserts — the same
 * constraint documented in tests/callLogs.migration.test.js and
 * tests/segments.migration.test.js. Cleanup is handled two ways, in order
 * of preference:
 *   1. If SUPABASE_SERVICE_ROLE_KEY is configured, a privileged client
 *      (which bypasses RLS entirely) deletes the marked `smart_interactions`
 *      row, THEN the marked `smart_leads` row created alongside it (see FK
 *      note below for why this order matters).
 *   2. If no service-role key is configured (the default in this repo's
 *      .env.local), BOTH the `smart_interactions` row and its parent
 *      `smart_leads` row are left in place, clearly tagged with
 *      MARKER_PREFIX — the anon client cannot delete the `smart_leads` row
 *      either in this case, since `smart_interactions.lead_id` still
 *      references it (see FK note below), and attempting that delete would
 *      just fail with a foreign-key violation rather than accomplish
 *      anything. This is a real, documented gap, not silently swallowed —
 *      the console warning below names both residual rows.
 *
 * WHY THIS TEST CREATES ITS OWN `smart_leads` ROW RATHER THAN REUSING AN
 * EXISTING ONE: `smart_interactions.lead_id` has a live FOREIGN KEY to
 * `smart_leads(id)` with NO `ON DELETE CASCADE` (confirmed live via
 * `pg_constraint` — unlike `smart_interactions.tenant_id`'s FK to
 * `tenants(id)`, which IS `ON DELETE CASCADE`). Reusing one of the 18 live
 * dev-fallback-tenant rows would risk mutating or orphaning real data this
 * migration's own planning audit found in the table. `smart_leads` already
 * has full scoped CRUD policies for the dev-fallback tenant
 * (`smart_leads_tenant_select/_insert/_update/_delete`, confirmed live and
 * unaffected by this migration), so anon can safely create and — with a
 * service-role key — clean up its own throwaway lead row instead. Because
 * of the FK's direction and lack of cascade, cleanup order matters: the
 * `smart_interactions` row (child) must be deleted before the `smart_leads`
 * row (parent), or the parent delete fails with a foreign-key violation.
 * This mirrors a cleanup-ordering bug already found and fixed once before
 * in this codebase for the same FK (see DB_AUDIT_REPORT.md's Block 1.7a-2
 * entry: an `afterEach` that deleted `smart_leads` rows directly, without
 * deleting their `smart_interactions` children first, failed for exactly
 * this reason).
 *
 * ⚠️ IMPORTANT — THIS REFLECTS INTERIM POLICY BEHAVIOUR, NOT THE FINAL MODEL:
 * the new scoped UPDATE policy — and the two pre-existing scoped SELECT/
 * INSERT policies this migration leaves unchanged — all use
 * `tenant_id = auth_tenant_id() OR tenant_id = <dev-fallback-tenant>`. The
 * `OR <dev-fallback-tenant>` branch is a pre-auth-mapping scaffold (see
 * DB_AUDIT_REPORT.md §3 item 1 and the Block 1.4a audit), not the desired
 * production model. Under an anon client with no JWT, `auth_tenant_id()`
 * always evaluates to NULL, so every assertion below that "succeeds" only
 * does so via the dev-fallback branch matching the literal dev-fallback
 * tenant UUID — it is not proof that per-tenant `auth.uid()`-based isolation
 * works correctly for two *authenticated* tenants. That remains open work
 * (Block 1's `auth.uid() → tenant_id` mapping, still not implemented
 * anywhere in this codebase). This file tests interim dev-fallback
 * behaviour only, not final authenticated multi-tenant isolation.
 *
 * ON THE MISMATCHED-TENANT INSERT TEST — A SCHEMA CAVEAT WORTH FLAGGING:
 * like every other table in this family, `smart_interactions.tenant_id` has
 * a live FOREIGN KEY to `tenants(id) ON DELETE CASCADE`. Only one tenant row
 * currently exists in this project (the dev-fallback tenant itself,
 * `00000000-0000-0000-0000-000000000001`) — there is no second real tenant
 * to insert against. That means an INSERT using any other UUID as
 * `tenant_id` is rejected by the FK constraint regardless of RLS, so that
 * rejection alone does NOT isolate "RLS denied this" from "no such tenant
 * exists." This test asserts only that the insert fails, without claiming
 * the failure is purely an RLS violation. (`tenant_id` is also nullable at
 * the schema level for this table — unlike most others in this family — but
 * that has no bearing on this assertion, since the test supplies a non-null,
 * non-existent UUID rather than omitting the column.)
 *
 * ON THE DELETE DEFAULT-DENY ASSERTION — WHAT "REJECTED" ACTUALLY LOOKS
 * LIKE HERE:
 * PostgREST does not require a row to be visible under a table's SELECT
 * policy in order to attempt a DELETE against it — RLS filters which rows
 * the command actually touches, not whether the command can be issued.
 * With no DELETE policy at all for `smart_interactions` after this
 * migration, the expected shape is the same as tests/quotes.migration.
 * test.js's DELETE assertion, tests/callLogs.migration.test.js's UPDATE/
 * DELETE assertions, and tests/segments.migration.test.js's DELETE
 * assertion: the request completes without a client-visible error, but
 * affects zero rows — not a thrown/rejected error. This test asserts on
 * that "no error, zero rows affected, row still visible after" shape
 * rather than asserting an error object is present, since default-deny via
 * an absent policy does not itself raise a PostgREST-visible error in this
 * project's observed behaviour (confirmed empirically for every prior
 * table in this family with a default-deny command). If a future Postgres/
 * PostgREST version changes this behaviour to a raised RLS error instead,
 * this assertion would need updating to match.
 *
 * WHY THIS FILE IS SKIPPED BY DEFAULT:
 * set RUN_DB_INTEGRATION_TESTS=true to run it manually, after the migration
 * has been applied. It is never run as part of `npm test` / CI. The
 * privileged cleanup block additionally requires SUPABASE_SERVICE_ROLE_KEY
 * — see the cleanup-limitation note above for what happens without one.
 *
 * HOW TO RUN, MANUALLY, AFTER THE MIGRATION IS APPLIED:
 *   RUN_DB_INTEGRATION_TESTS=true npx vitest run tests/smartInteractions.migration.test.js
 *
 * TEST DATA NOTES:
 * - `smart_interactions` has no UNIQUE constraint suitable as a marker
 *   column, so every insert that needs one uses a distinct, timestamped/
 *   randomised value in `message_content` (nullable, no uniqueness
 *   constraint, no CHECK constraint) as the lookup key for that test's row
 *   — the same field real app code (e.g. `db.js`'s `saveLeadAndLogToDatabase`)
 *   uses to store the actual draft text, confirmed via
 *   `information_schema.columns` to carry no CHECK constraint that a test
 *   marker string could violate.
 * - `tenant_id` and `lead_id` are both nullable at the schema level for
 *   this table (confirmed live, unlike most siblings in this family);
 *   `direction` is also nullable with no CHECK constraint (unlike some
 *   other tables' `direction`/`outcome` columns); `channel` is NOT NULL
 *   with a `'whatsapp'::text` default, so it is never set explicitly below,
 *   matching `db.js`'s real insert shape.
 * - No live customer data is used anywhere in this file — every row's
 *   content is a synthetic, randomised marker string.
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
const MARKER_PREFIX = '__integration_test__smart_interactions_contract__';

function uniqueMarker() {
  return `${MARKER_PREFIX}${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

function validLeadRow(tenantId, overrides = {}) {
  return {
    tenant_id: tenantId,
    lead_channel_id: uniqueMarker(),
    ...overrides,
  };
}

function validInteractionRow(tenantId, leadId, overrides = {}) {
  return {
    tenant_id: tenantId,
    lead_id: leadId,
    message_content: uniqueMarker(),
    direction: 'outbound_draft',
    ...overrides,
  };
}

// Cleanup by marker — only fully possible via a privileged client, since
// anon has no DELETE policy on smart_interactions after this migration
// (see the file header's cleanup-limitation note). Deletes the
// smart_interactions row (child) before the smart_leads row (parent) —
// smart_interactions.lead_id has no ON DELETE CASCADE, so deleting the
// parent first would fail with a foreign-key violation while the child
// still exists. A no-op, clearly documented as such, when no service-role
// key is configured — both rows stay in their tables, tagged with
// MARKER_PREFIX, for manual/future cleanup.
async function cleanupByMarker(marker, leadId) {
  if (!canCleanupPrivileged) {
    console.warn(
      `⚠️  [smartInteractions.migration.test.js] No SUPABASE_SERVICE_ROLE_KEY configured — leaving residual smart_interactions row (message_content="${marker}") AND its parent smart_leads row (id="${leadId}") uncleaned. See file header.`
    );
    return;
  }
  await service.from('smart_interactions').delete().eq('message_content', marker).eq('tenant_id', DEV_TENANT_ID);
  if (leadId) {
    await service.from('smart_leads').delete().eq('id', leadId).eq('tenant_id', DEV_TENANT_ID);
  }
}

maybeDescribe('smart_interactions — real Postgres/RLS contract (run manually post-migration)', () => {
  it('anon INSERT with a tenant_id that does not exist is rejected', async () => {
    const { error } = await anon.from('smart_interactions').insert(validInteractionRow(NONEXISTENT_TENANT_ID, null));
    // Rejected either by the FK constraint (no such tenants row) or by RLS
    // (mismatched tenant_id satisfies neither branch of the scoped policy's
    // OR) — see header caveat on why this test cannot isolate which one.
    // No row is created either way (lead_id is null, so no smart_leads row
    // is involved), so no cleanup is needed here.
    expect(error).not.toBeNull();
  });

  // Combined into a single test — create a throwaway smart_leads row, then
  // INSERT/SELECT/UPDATE/tenant_id-escape-hatch-guard/DELETE on
  // smart_interactions — deliberately reusing the ONE interaction row this
  // creates for all assertions, rather than one row per assertion, to keep
  // this file's total footprint to at most one residual row pair when no
  // service-role key is configured (see the cleanup-limitation header
  // note; same combined-row approach as tests/callLogs.migration.test.js
  // and tests/segments.migration.test.js).
  it('anon can INSERT/SELECT/UPDATE a dev-fallback tenant row; DELETE on it is default-deny', async () => {
    const marker = uniqueMarker();
    let leadId = null;
    try {
      const { data: leadData, error: leadErr } = await anon
        .from('smart_leads')
        .insert(validLeadRow(DEV_TENANT_ID))
        .select('id')
        .single();
      expect(leadErr).toBeNull();
      leadId = leadData.id;

      const { error: insertErr } = await anon
        .from('smart_interactions')
        .insert(validInteractionRow(DEV_TENANT_ID, leadId, { message_content: marker }));
      expect(insertErr).toBeNull();

      // SELECT via the scoped SELECT policy (interactions_tenant_select,
      // unchanged by this migration) — separate SELECT call, not relying
      // on INSERT's own RETURNING output.
      const { data: selectData, error: selectErr } = await anon
        .from('smart_interactions')
        .select('id, tenant_id, message_content, direction')
        .eq('message_content', marker);
      expect(selectErr).toBeNull();
      expect(selectData).toHaveLength(1);
      expect(selectData[0].tenant_id).toBe(DEV_TENANT_ID);

      const rowId = selectData[0].id;

      // UPDATE — deliberately filtering ONLY by `id`, matching the real
      // frontend drafts page's handleDismiss/handleEscalate/
      // handleSaveAndSend call shape (none of them filter by tenant_id), so
      // this exercises the new scoped UPDATE policy as the sole tenant
      // boundary, not an app-level WHERE clause.
      const { data: updateData, error: updateErr } = await anon
        .from('smart_interactions')
        .update({ direction: 'dismissed' })
        .eq('id', rowId)
        .select('id, direction');
      expect(updateErr).toBeNull();
      expect(updateData).toHaveLength(1);
      expect(updateData[0].direction).toBe('dismissed');

      // tenant_id escape-hatch guard — with the migration's explicit WITH
      // CHECK (identical to USING), neither of these attempts should be
      // able to actually move the row off the dev-fallback tenant. Not
      // asserting on the error/response shape of either attempt on purpose
      // (see the header's "ON THE TENANT_ID ESCAPE-HATCH ASSERTION" note)
      // — only the row's final tenant_id, checked via a fresh SELECT
      // below, is the contract under test.
      await anon.from('smart_interactions').update({ tenant_id: null }).eq('id', rowId);
      await anon.from('smart_interactions').update({ tenant_id: NONEXISTENT_TENANT_ID }).eq('id', rowId);

      const { data: tenantGuardRow, error: tenantGuardErr } = await anon
        .from('smart_interactions')
        .select('id, tenant_id')
        .eq('id', rowId)
        .maybeSingle();
      expect(tenantGuardErr).toBeNull();
      expect(tenantGuardRow?.tenant_id).toBe(DEV_TENANT_ID);

      // DELETE default-deny — no DELETE policy before or after this
      // migration's scoped set (tenant_interactions_delete is dropped with
      // no replacement); expected to complete without a client-visible
      // error but affect zero rows, not to throw (see header note on why
      // this isn't asserted as a thrown error).
      const { data: deleteData, error: deleteErr } = await anon
        .from('smart_interactions')
        .delete()
        .eq('id', rowId)
        .select('id');
      expect(deleteErr).toBeNull();
      expect(deleteData).toEqual([]);

      // Confirm the row is still visible after the denied DELETE attempt —
      // RLS evaluates each command's policy set independently, so SELECT
      // visibility is unaffected by DELETE having no policy.
      const { data: stillThere, error: stillThereErr } = await anon
        .from('smart_interactions')
        .select('id')
        .eq('message_content', marker);
      expect(stillThereErr).toBeNull();
      expect(stillThere).toHaveLength(1);
    } finally {
      await cleanupByMarker(marker, leadId);
    }
  });
});

if (!canRun) {
  describe('smart_interactions — real Postgres/RLS contract', () => {
    it.skip('SKIPPED: set RUN_DB_INTEGRATION_TESTS=true after applying the Block 1.10b migration to run these', () => {});
  });
}
