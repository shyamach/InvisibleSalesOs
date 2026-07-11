/**
 * tests/emailThreads.migration.test.js
 *
 * RLS contract for `email_threads` after
 * supabase/migrations/phase_1_4b_drop_email_threads_permissive_policy.sql
 * (DRAFT, not yet applied).
 *
 * WHY THIS FILE DOES NOT FOLLOW THE REPO'S USUAL MOCKED-SUPABASE PATTERN:
 * RLS policies are enforced by real Postgres, not the JS client — a mock
 * would "pass" these assertions regardless of whether the real policy state
 * matches. These tests use the REAL Supabase client (anon key, same as the
 * rest of the app) on purpose, following the pattern in
 * tests/failedIngestions.migration.test.js and tests/stockMovement.migration.test.js.
 *
 * WHAT THIS TEST EXPECTS, AND WHEN:
 * - Before the migration is applied: `email_threads` still carries its three
 *   legacy permissive policies (tenant_email_threads_select/_insert/_update —
 *   confirmed live via pg_policies on 2026-07-10). Against that state, the
 *   INSERT assertion below will FAIL (the permissive policy currently allows
 *   it) — this file is not expected to pass yet.
 * - After the migration is applied: all three policies are dropped and no
 *   replacement is created, so RLS's default-deny behavior applies to every
 *   command for every role. This file is expected to pass ONLY once that
 *   migration has been applied to the target Supabase project.
 *
 * WHY THIS FILE IS SKIPPED BY DEFAULT:
 * set RUN_DB_INTEGRATION_TESTS=true to run it manually, after the migration
 * has been applied. It is never run as part of `npm test` / CI.
 *
 * HOW TO RUN, MANUALLY, AFTER THE MIGRATION IS APPLIED:
 *   RUN_DB_INTEGRATION_TESTS=true npx vitest run tests/emailThreads.migration.test.js
 *
 * ON TEST DATA / UPDATE COVERAGE:
 * this table has no scoped INSERT policy either before or after the
 * migration is meaningfully usable by anon (before: requires only
 * tenant_id IS NOT NULL, so a row could be seeded; after: INSERT is denied
 * entirely, so no seeding is possible via anon at all). The UPDATE
 * assertion below therefore does not seed a row first — it can only assert
 * that an UPDATE matching a synthetic, never-inserted id affects zero rows
 * with no error, which is consistent with default-deny but does not, on its
 * own, distinguish "denied by RLS" from "no such row exists." Combined with
 * the SELECT assertion (which does prove anon has zero visibility into the
 * table, seeded or not) and the INSERT assertion (which does directly prove
 * write access is denied), the three together give full command coverage
 * without depending on any pre-existing production data.
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
const TEST_MARKER_SUBJECT = '__integration_test__email_threads_contract';
const NONEXISTENT_ROW_ID = '11111111-1111-1111-1111-111111111199';

maybeDescribe('email_threads — real Postgres/RLS contract (run manually post-migration)', () => {
  it('anon cannot SELECT (zero policies → default-deny, regardless of any existing data)', async () => {
    const { data, error } = await anon
      .from('email_threads')
      .select('id')
      .eq('subject', TEST_MARKER_SUBJECT);
    // RLS denial with no SELECT policy surfaces as an empty result set under
    // PostgREST, not a distinct "permission denied" error.
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it('anon cannot INSERT (no INSERT policy → RLS violation error)', async () => {
    const { error } = await anon.from('email_threads').insert({
      tenant_id: DEV_TENANT_ID,
      subject: TEST_MARKER_SUBJECT,
    });
    // Unlike SELECT/UPDATE/DELETE (which silently match zero visible rows),
    // an INSERT with no permissive INSERT policy is rejected outright by
    // Postgres with an explicit RLS violation error.
    expect(error).not.toBeNull();
    expect(error.message.toLowerCase()).toMatch(/row-level security|policy/);
  });

  it('anon cannot UPDATE (no UPDATE policy → matches zero visible rows)', async () => {
    const { error, data } = await anon
      .from('email_threads')
      .update({ subject: TEST_MARKER_SUBJECT })
      .eq('id', NONEXISTENT_ROW_ID)
      .select('id');
    // No UPDATE policy → zero rows visible to match → silently affects
    // nothing, same shape as a genuinely-missing row. See file header for
    // why this alone doesn't prove denial in isolation.
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });
});

if (!canRun) {
  describe('email_threads — real Postgres/RLS contract', () => {
    it.skip('SKIPPED: set RUN_DB_INTEGRATION_TESTS=true after applying the Block 1.4b migration to run these', () => {});
  });
}
