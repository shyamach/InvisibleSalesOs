/**
 * tests/whatsappSessions.migration.test.js
 *
 * RLS contract for `whatsapp_sessions` after
 * supabase/migrations/phase_1_11_drop_whatsapp_sessions_permissive_policy.sql
 * (DRAFT, not yet applied) — the LAST of the original 9 tables named in
 * DB_AUDIT_REPORT.md §7/§10's legacy-permissive-policy SHOWSTOPPER.
 *
 * WHY THIS FILE DOES NOT FOLLOW THE REPO'S USUAL MOCKED-SUPABASE PATTERN:
 * RLS policies are enforced by real Postgres, not the JS client — a mock
 * would "pass" these assertions regardless of whether the real policy state
 * matches. These tests use the REAL Supabase client (anon key, same as the
 * rest of the app) on purpose, following the pattern in
 * tests/emailThreads.migration.test.js, tests/closedDeals.migration.test.js,
 * tests/invoices.migration.test.js, tests/quotes.migration.test.js,
 * tests/smartLeads.migration.test.js, tests/callLogs.migration.test.js,
 * tests/segments.migration.test.js, and tests/smartInteractions.migration.test.js.
 *
 * HOW THIS DIFFERS FROM THE REST OF THE FAMILY:
 * `whatsapp_sessions` had ZERO scoped sibling policies before this
 * migration — the same zero-scoped starting point as `call_logs` (Block
 * 1.8) and `segments` (Block 1.9) — but simpler than both: only ONE
 * command (SELECT) has any live app dependent at all
 * (`controllers/tenants.js#getTenantStatus`). INSERT, UPDATE, and DELETE
 * have NO app dependent anywhere in this repo (no route, controller,
 * webhook, cron, or frontend page ever writes to this table — the real
 * WhatsApp connection uses filesystem `LocalAuth`, not this DB table), so
 * this migration adds exactly one new policy and leaves all three write
 * commands fully default-deny. This is a narrower shape than every prior
 * table in this family, each of which had at least one live write
 * dependent.
 *
 * A NOTE ON WHAT MAKES THE INSERT TEST CLEANER HERE THAN ELSEWHERE: every
 * other table in this family has a live FOREIGN KEY from `tenant_id` to
 * `tenants(id)`, which means an INSERT with a nonexistent tenant_id is
 * rejected by EITHER the FK constraint OR RLS, and those tests cannot
 * isolate which one fired. `whatsapp_sessions.tenant_id` is `varchar(255)`
 * with NO foreign key at all (a varchar column cannot FK to a uuid PK —
 * see the migration file's header) — so the INSERT test below has no such
 * ambiguity: with zero INSERT policies after this migration, any anon
 * INSERT (using the real dev-fallback tenant_id or otherwise) is rejected
 * by RLS alone.
 *
 * ⚠️ CLEANUP LIMITATION — READ BEFORE RUNNING:
 * DELETE is intentionally default-deny for `whatsapp_sessions` after this
 * migration (that is itself part of what's under test). Unlike prior
 * tables in this family, the plain (non-service-role) tests below never
 * need to clean up a row THEY created, because INSERT is also fully
 * default-deny here — none of the required tests (1-4) can create a row
 * in the first place. Only the OPTIONAL stronger test (gated on
 * SUPABASE_SERVICE_ROLE_KEY) creates a row at all, and it cleans up via
 * the privileged service client in a `finally` block, which bypasses RLS
 * entirely and can always succeed. No residual rows are left by this file
 * under any environment configuration.
 *
 * ⚠️ IMPORTANT — THIS REFLECTS INTERIM POLICY BEHAVIOUR, NOT THE FINAL MODEL:
 * the new scoped SELECT policy uses `tenant_id = auth_tenant_id()::text OR
 * tenant_id = <dev-fallback-tenant>` — the `OR <dev-fallback-tenant>`
 * branch is a pre-auth-mapping scaffold (see DB_AUDIT_REPORT.md §3 item 1
 * and the Block 1.4a audit), not the desired production model. Under an
 * anon client with no JWT, `auth_tenant_id()` always evaluates to NULL, so
 * every assertion below that "succeeds" only does so via the dev-fallback
 * branch matching the literal dev-fallback tenant string — it is not proof
 * that per-tenant `auth.uid()`-based isolation works correctly for two
 * *authenticated* tenants. That remains open work (Block 1's
 * `auth.uid() → tenant_id` mapping, still not implemented anywhere in this
 * codebase). This file tests interim dev-fallback behaviour only, not
 * final authenticated multi-tenant isolation.
 *
 * ON THE UPDATE/DELETE DEFAULT-DENY ASSERTIONS (tests 3 and 4) — A
 * LIMITATION WORTH FLAGGING: `whatsapp_sessions` has 0 rows in production
 * (confirmed live, 2026-07-18) and INSERT is fully default-deny after
 * this migration, so there is no way for these tests to target an
 * EXISTING row with a mismatched/nonexistent tenant_id or id — there is
 * no row to begin with. These two tests therefore cannot, on their own,
 * distinguish "RLS blocked this" from "there was nothing there to
 * update/delete regardless of RLS." They still document the required
 * contract (no thrown error, zero rows affected) and match the shape used
 * for every other default-deny command in this family (see
 * tests/quotes.migration.test.js's DELETE assertion,
 * tests/callLogs.migration.test.js's UPDATE/DELETE assertions, and
 * tests/segments.migration.test.js's DELETE assertion) — the OPTIONAL
 * service-role-seeded test below closes this gap when a service-role key
 * is available, by seeding a real row anon cannot legitimately reach via
 * pure default-deny.
 *
 * WHY THIS FILE IS SKIPPED BY DEFAULT:
 * set RUN_DB_INTEGRATION_TESTS=true to run it manually, after the migration
 * has been applied. It is never run as part of `npm test` / CI. The
 * optional stronger test additionally requires SUPABASE_SERVICE_ROLE_KEY —
 * it is skipped (not failed) when that key is not configured.
 *
 * HOW TO RUN, MANUALLY, AFTER THE MIGRATION IS APPLIED:
 *   RUN_DB_INTEGRATION_TESTS=true npx vitest run tests/whatsappSessions.migration.test.js
 *
 * TEST DATA NOTES:
 * - `whatsapp_sessions` has a UNIQUE constraint on `tenant_id` (at most one
 *   session row per tenant by design), so `phone_number` (nullable text, no
 *   CHECK constraint, no uniqueness constraint) is used as the marker
 *   column for the tests that need one, the same role `message_content`/
 *   `name` play in this family's other migration test files.
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

const DEV_TENANT_ID = '00000000-0000-0000-0000-000000000001'; // verified to exist, 2026-07-18
const NONEXISTENT_TENANT_ID = '11111111-1111-1111-1111-111111111111'; // no such tenants row
const MARKER_PREFIX = '__integration_test__whatsapp_sessions_contract__';

function uniqueMarker() {
  return `${MARKER_PREFIX}${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

maybeDescribe('whatsapp_sessions — real Postgres/RLS contract (run manually post-migration)', () => {
  it('anon INSERT with the dev-fallback tenant_id is rejected (INSERT is fully default-deny)', async () => {
    const marker = uniqueMarker();
    const { data, error } = await anon
      .from('whatsapp_sessions')
      .insert({ tenant_id: DEV_TENANT_ID, phone_number: marker })
      .select('id');

    // INSERT has zero policies of any kind after this migration (see the
    // migration file's "WHY INSERT/UPDATE/DELETE GET NO REPLACEMENT
    // POLICY" rationale). Unlike SELECT/UPDATE/DELETE's silent
    // zero-rows-affected shape (those are implemented as a USING filter
    // over existing rows), Postgres evaluates INSERT against WITH CHECK
    // before the row is written — with no permissive WITH CHECK policy
    // for any role, the expected and empirically observed shape elsewhere
    // in this codebase is a thrown RLS-violation error, not a silently
    // empty response. This assertion tolerates the no-error/empty-data
    // shape defensively, in case a future PostgREST version changes this,
    // but does not require it — only the end state (no row created)
    // matters.
    if (error) {
      expect(error).not.toBeNull();
    } else {
      expect(data === null || (Array.isArray(data) && data.length === 0)).toBe(true);
    }

    // Confirm no row was actually created, via the new scoped SELECT
    // policy (dev-fallback tenant_id matches its OR branch).
    const { data: check, error: checkErr } = await anon
      .from('whatsapp_sessions')
      .select('id')
      .eq('phone_number', marker);
    expect(checkErr).toBeNull();
    expect(check).toEqual([]);
  });

  it('anon SELECT with the dev-fallback tenant_id succeeds and returns an empty array (table has 0 rows)', async () => {
    const { data, error } = await anon.from('whatsapp_sessions').select('*').eq('tenant_id', DEV_TENANT_ID);

    expect(error).toBeNull();
    expect(Array.isArray(data)).toBe(true);
    // Table is confirmed empty in production (0 rows, 2026-07-18 audit) and
    // INSERT is fully default-deny for anon (see test above), so this is
    // expected to stay [] for the lifetime of this migration.
    expect(data).toEqual([]);
  });

  it('anon UPDATE is default-deny (no scoped UPDATE policy exists)', async () => {
    // See file header note on why this test cannot isolate "RLS blocked
    // it" from "there was nothing there to update" — the table has 0 rows
    // and INSERT cannot create one, so a nonexistent tenant_id is used to
    // still exercise the call shape and document the required contract.
    const { data, error } = await anon
      .from('whatsapp_sessions')
      .update({ status: 'ready' })
      .eq('tenant_id', NONEXISTENT_TENANT_ID)
      .select('id');

    expect(error).toBeNull();
    expect(data).toEqual([]);

    const { data: check, error: checkErr } = await anon
      .from('whatsapp_sessions')
      .select('id')
      .eq('tenant_id', NONEXISTENT_TENANT_ID);
    expect(checkErr).toBeNull();
    expect(check).toEqual([]);
  });

  it('anon DELETE is default-deny (no scoped DELETE policy exists)', async () => {
    // Same limitation as the UPDATE test above — see file header note.
    const { data, error } = await anon
      .from('whatsapp_sessions')
      .delete()
      .eq('tenant_id', NONEXISTENT_TENANT_ID)
      .select('id');

    expect(error).toBeNull();
    expect(data).toEqual([]);

    const { data: check, error: checkErr } = await anon
      .from('whatsapp_sessions')
      .select('id')
      .eq('tenant_id', NONEXISTENT_TENANT_ID);
    expect(checkErr).toBeNull();
    expect(check).toEqual([]);
  });

  // Optional stronger test — only runs when SUPABASE_SERVICE_ROLE_KEY is
  // configured. Seeds a real row via the privileged service client (which
  // bypasses RLS entirely), so anon's UPDATE/DELETE default-deny can be
  // proven against an ACTUAL row rather than an empty table, closing the
  // gap flagged in the file header for tests 3 and 4. Skipped (not
  // failed) without a service-role key, so this file still runs fully in
  // a local env with none configured.
  (canCleanupPrivileged ? it : it.skip)(
    'optional (requires SUPABASE_SERVICE_ROLE_KEY): anon can SELECT a service-role-seeded dev-fallback row but cannot UPDATE or DELETE it',
    async () => {
      const marker = uniqueMarker();
      let rowId = null;
      try {
        const { data: seeded, error: seedErr } = await service
          .from('whatsapp_sessions')
          .insert({ tenant_id: DEV_TENANT_ID, phone_number: marker, status: 'active' })
          .select('id')
          .single();
        expect(seedErr).toBeNull();
        rowId = seeded.id;

        // anon SELECT via the new scoped policy (dev-fallback branch).
        const { data: selectData, error: selectErr } = await anon
          .from('whatsapp_sessions')
          .select('id, tenant_id, phone_number, status')
          .eq('id', rowId);
        expect(selectErr).toBeNull();
        expect(selectData).toHaveLength(1);
        expect(selectData[0].tenant_id).toBe(DEV_TENANT_ID);
        expect(selectData[0].phone_number).toBe(marker);

        // anon UPDATE — no scoped UPDATE policy exists; expected to
        // complete without a client-visible error but affect zero rows.
        const { data: updateData, error: updateErr } = await anon
          .from('whatsapp_sessions')
          .update({ status: 'ready' })
          .eq('id', rowId)
          .select('id');
        expect(updateErr).toBeNull();
        expect(updateData).toEqual([]);

        // anon DELETE — no scoped DELETE policy exists; same shape.
        const { data: deleteData, error: deleteErr } = await anon
          .from('whatsapp_sessions')
          .delete()
          .eq('id', rowId)
          .select('id');
        expect(deleteErr).toBeNull();
        expect(deleteData).toEqual([]);

        // Confirm via the privileged client that the row is unchanged and
        // still present — anon's denied UPDATE/DELETE had no effect.
        const { data: stillThere, error: stillThereErr } = await service
          .from('whatsapp_sessions')
          .select('id, status')
          .eq('id', rowId)
          .maybeSingle();
        expect(stillThereErr).toBeNull();
        expect(stillThere?.status).toBe('active');
      } finally {
        if (rowId) {
          await service.from('whatsapp_sessions').delete().eq('id', rowId);
        }
      }
    }
  );
});

if (!canRun) {
  describe('whatsapp_sessions — real Postgres/RLS contract', () => {
    it.skip('SKIPPED: set RUN_DB_INTEGRATION_TESTS=true after applying the Block 1.11 migration to run these', () => {});
  });
}
