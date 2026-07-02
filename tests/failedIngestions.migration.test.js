/**
 * tests/failedIngestions.migration.test.js
 *
 * RLS + constraint contract for the `failed_ingestions` table
 * (supabase/migrations/phase2_failed_ingestions_dead_letter.sql — DRAFT,
 * not yet applied).
 *
 * WHY THIS FILE DOES NOT FOLLOW THE REPO'S USUAL MOCKED-SUPABASE PATTERN:
 * every other test in this suite mocks `lib/supabase.js` — but RLS policies
 * and CHECK/FK constraints are enforced by real Postgres, not by the JS
 * client. A mock would happily "pass" these assertions regardless of
 * whether the real policy is correct or even exists. These tests use the
 * REAL Supabase client (anon key, same as engine.js) on purpose.
 *
 * WHY INSERT ASSERTIONS DO NOT USE .select():
 * the migration intentionally grants `anon` INSERT but denies `anon` SELECT.
 * Under PostgREST, `insert(...).select(...)` asks for the inserted row back,
 * which requires SELECT visibility — combined with an insert-only policy,
 * that would either fail or return an empty payload for reasons unrelated to
 * whether the insert itself actually succeeded. Insert success is asserted
 * via `error === null` alone, never by reading the row back.
 *
 * WHY THIS FILE IS SKIPPED BY DEFAULT:
 * - The migration has not been applied yet — the table doesn't exist.
 * - Even once applied, these tests should not run as part of every
 *   `npm test` / CI invocation: they make real network calls against the
 *   real Supabase project and (per the INSERT tests) leave real rows behind
 *   that the anon role cannot read or delete (RLS denies anon SELECT/DELETE
 *   by design — see the migration file). That's an accepted, documented
 *   trade-off for an append-only dead-letter table, not a bug in this test.
 *
 * HOW TO RUN, MANUALLY, AFTER THE MIGRATION IS APPLIED:
 *   RUN_DB_INTEGRATION_TESTS=true npx vitest run tests/failedIngestions.migration.test.js
 *
 * Test rows are tagged with a distinct channel value so they're identifiable
 * for manual, service-role-side purging later (see TEST_MARKER_CHANNEL) —
 * the anon client used here cannot read or delete its own rows by design.
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
const NONEXISTENT_TENANT_ID = '11111111-1111-1111-1111-111111111111';
const TEST_MARKER_CHANNEL = '__integration_test__failed_ingestions_contract';

function validRow(overrides = {}) {
  return {
    tenant_id: DEV_TENANT_ID,
    channel: TEST_MARKER_CHANNEL,
    stage: 'triage',
    raw_payload: 'integration test payload — safe to ignore/purge',
    ...overrides,
  };
}

maybeDescribe('failed_ingestions — real Postgres/RLS contract (run manually post-migration)', () => {
  it('a valid engine-shaped row inserts successfully', async () => {
    const { error } = await anon.from('failed_ingestions').insert(validRow());
    expect(error).toBeNull();
  });

  it('anon can INSERT', async () => {
    const { error } = await anon.from('failed_ingestions').insert(validRow());
    expect(error).toBeNull();
  });

  it('anon cannot SELECT', async () => {
    const { data, error } = await anon
      .from('failed_ingestions')
      .select('id')
      .eq('channel', TEST_MARKER_CHANNEL);
    // RLS denial with no SELECT policy surfaces as an empty result set under
    // PostgREST, not a distinct "permission denied" error — assert zero
    // visible rows, not error !== null. Rows inserted by the tests above are
    // known to exist server-side; this asserts they are not visible to anon.
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it('anon cannot UPDATE', async () => {
    const { error, data } = await anon
      .from('failed_ingestions')
      .update({ resolved_at: new Date().toISOString() })
      .eq('channel', TEST_MARKER_CHANNEL)
      .select('id');
    // No UPDATE policy → the update matches zero visible rows (denied silently).
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it('anon cannot DELETE', async () => {
    const { error, data } = await anon
      .from('failed_ingestions')
      .delete()
      .eq('channel', TEST_MARKER_CHANNEL)
      .select('id');
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it('a nonexistent tenant_id fails the foreign key constraint', async () => {
    const { error } = await anon.from('failed_ingestions').insert(validRow({ tenant_id: NONEXISTENT_TENANT_ID }));
    expect(error).not.toBeNull();
    expect(error.message.toLowerCase()).toMatch(/foreign key|violat/);
  });

  it('an oversized raw_payload fails the size CHECK constraint', async () => {
    const { error } = await anon.from('failed_ingestions').insert(validRow({ raw_payload: 'x'.repeat(20001) }));
    expect(error).not.toBeNull();
    expect(error.message.toLowerCase()).toMatch(/check constraint|violat/);
  });

  it('an oversized parsed_profile fails the size CHECK constraint', async () => {
    const { error } = await anon
      .from('failed_ingestions')
      .insert(validRow({ parsed_profile: { note: 'x'.repeat(20001) } }));
    expect(error).not.toBeNull();
    expect(error.message.toLowerCase()).toMatch(/check constraint|violat/);
  });
});

if (!canRun) {
  describe('failed_ingestions — real Postgres/RLS contract', () => {
    it.skip('SKIPPED: set RUN_DB_INTEGRATION_TESTS=true after applying the migration to run these', () => {});
  });
}
