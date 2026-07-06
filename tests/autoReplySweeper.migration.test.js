/**
 * tests/autoReplySweeper.migration.test.js
 *
 * Real-Postgres contract test for the sweeper claim-lock (Block 0.3 —
 * supabase/migrations/phase2_sweeper_claim_lock.sql — DRAFT, not yet
 * applied). Proves the atomic claim UPDATE genuinely serializes concurrent
 * callers against real Postgres, the same way
 * tests/stockMovement.migration.test.js proved it for adjust_product_stock().
 *
 * WHY THIS FILE DOES NOT FOLLOW THE REPO'S USUAL MOCKED-SUPABASE PATTERN:
 * the whole point of the claim-lock is that a single conditional UPDATE
 * statement is atomic per-row under real concurrent load — a mocked client
 * cannot prove that. These tests use the REAL Supabase client (anon key,
 * same as the app).
 *
 * WHY THIS FILE IS SKIPPED BY DEFAULT:
 * - The migration has not been applied yet — `smart_leads.claimed_at`
 *   doesn't exist.
 * - Even once applied, these tests make real network calls against the
 *   real Supabase project and should not run as part of every `npm test`.
 *
 * HOW TO RUN, MANUALLY, AFTER THE MIGRATION IS APPLIED:
 *   RUN_DB_INTEGRATION_TESTS=true npx vitest run tests/autoReplySweeper.migration.test.js
 *
 * Test leads are tagged with a distinct company_name prefix and DELETEd in
 * afterEach — smart_leads RLS grants tenant-scoped DELETE (dev-fallback
 * tenant). No real dispatch ever fires in these tests — `dispatch` is
 * always an injected vi.fn(), never the real outbox — only the DB-level
 * claim behaviour is under test.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { sweepScheduledReplies } from '../lib/autoReplySweeper.js';

const RUN_INTEGRATION = process.env.RUN_DB_INTEGRATION_TESTS === 'true';
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
const canRun = RUN_INTEGRATION && Boolean(supabaseUrl) && Boolean(supabaseAnonKey);

const maybeDescribe = canRun ? describe : describe.skip;
const anon = canRun ? createClient(supabaseUrl, supabaseAnonKey) : null;

const DEV_TENANT_ID = '00000000-0000-0000-0000-000000000001'; // verified to exist, 2026-07-02
const COMPANY_PREFIX = '__integration_test__sweeper_claim_lock__';

let createdLeadIds = [];

async function makeDueLead(overrides = {}) {
  const { data, error } = await anon
    .from('smart_leads')
    .insert({
      tenant_id: DEV_TENANT_ID,
      customer_name: 'Integration Test Lead',
      company_name: COMPANY_PREFIX,
      phone_number: '+447900000999',
      auto_reply_status: 'scheduled',
      scheduled_dispatch_at: new Date(Date.now() - 60_000).toISOString(), // 1 min ago — due
      claimed_at: null,
      ...overrides,
    })
    .select('*')
    .single();
  if (error) throw error;
  createdLeadIds.push(data.id);
  return data;
}

async function makeDraftFor(leadId, message = 'Integration test draft — safe to ignore/purge.') {
  const { error } = await anon.from('smart_interactions').insert({
    tenant_id: DEV_TENANT_ID,
    lead_id: leadId,
    direction: 'outbound_draft',
    message_content: message,
    channel: 'whatsapp',
  });
  if (error) throw error;
}

maybeDescribe('sweeper claim-lock — real Postgres contract (run manually post-migration)', () => {
  afterEach(async () => {
    if (createdLeadIds.length === 0) return;
    const ids = createdLeadIds;
    createdLeadIds = [];
    // smart_interactions.lead_id -> smart_leads has no ON DELETE CASCADE
    // (unlike stock_movements -> products), so drafts must be removed first.
    const { error: draftErr } = await anon.from('smart_interactions').delete().in('lead_id', ids);
    if (draftErr) throw draftErr;
    const { error } = await anon.from('smart_leads').delete().in('id', ids);
    if (error) throw error;
  });

  it('claims and dispatches a due lead normally', async () => {
    const lead = await makeDueLead();
    await makeDraftFor(lead.id);
    const dispatch = vi.fn().mockResolvedValue({ dispatched: true, channel: 'whatsapp' });

    const summary = await sweepScheduledReplies(anon, { now: new Date(), dispatch });

    expect(dispatch).toHaveBeenCalledOnce();
    expect(summary.dispatched).toBeGreaterThanOrEqual(1);

    const { data: row, error } = await anon.from('smart_leads').select('auto_reply_status, claimed_at').eq('id', lead.id).single();
    expect(error).toBeNull();
    expect(row.auto_reply_status).toBe('sent');
  });

  it('30 concurrent sweep passes on the same due lead: exactly one dispatch fires, no lost/duplicate claims', async () => {
    const lead = await makeDueLead();
    await makeDraftFor(lead.id);
    const dispatch = vi.fn().mockResolvedValue({ dispatched: true, channel: 'whatsapp' });
    const CONCURRENCY = 30;

    const summaries = await Promise.all(
      Array.from({ length: CONCURRENCY }, () => sweepScheduledReplies(anon, { now: new Date(), dispatch }))
    );

    // The real customer-facing send path (the injected dispatch fn standing
    // in for it) fired exactly once across every concurrent sweep pass.
    expect(dispatch).toHaveBeenCalledOnce();

    const totalDispatched = summaries.reduce((sum, s) => sum + s.dispatched, 0);
    const totalClaimLost = summaries.reduce((sum, s) => sum + s.claimLost, 0);
    expect(totalDispatched).toBe(1);
    expect(totalClaimLost).toBe(CONCURRENCY - 1);

    const { data: row, error } = await anon.from('smart_leads').select('auto_reply_status').eq('id', lead.id).single();
    expect(error).toBeNull();
    expect(row.auto_reply_status).toBe('sent');
  });

  it('a stale claim (older than the staleness window) is recovered by the next run', async () => {
    const staleClaimedAt = new Date(Date.now() - 10 * 60 * 1000).toISOString(); // 10 min ago
    const lead = await makeDueLead({ claimed_at: staleClaimedAt });
    await makeDraftFor(lead.id);
    const dispatch = vi.fn().mockResolvedValue({ dispatched: true, channel: 'whatsapp' });

    const summary = await sweepScheduledReplies(anon, { now: new Date(), dispatch, claimStaleMs: 5 * 60 * 1000 });

    expect(dispatch).toHaveBeenCalledOnce();
    expect(summary.dispatched).toBe(1);
  });

  it('a fresh claim (within the staleness window) is left alone — not re-claimed', async () => {
    const freshClaimedAt = new Date(Date.now() - 10_000).toISOString(); // 10s ago
    const lead = await makeDueLead({ claimed_at: freshClaimedAt });
    await makeDraftFor(lead.id);
    const dispatch = vi.fn();

    const summary = await sweepScheduledReplies(anon, { now: new Date(), dispatch, claimStaleMs: 5 * 60 * 1000 });

    expect(dispatch).not.toHaveBeenCalled();
    expect(summary.claimLost).toBe(1);

    const { data: row, error } = await anon.from('smart_leads').select('auto_reply_status, claimed_at').eq('id', lead.id).single();
    expect(error).toBeNull();
    expect(row.auto_reply_status).toBe('scheduled'); // untouched
    // Compare as instants, not raw strings — Postgres round-trips
    // timestamptz as e.g. "...772+00:00" where JS produced "...772Z";
    // same instant, different string representation.
    expect(new Date(row.claimed_at).getTime()).toBe(new Date(freshClaimedAt).getTime()); // untouched
  });

  it('a failed dispatch releases the claim so an immediate follow-up run can retry', async () => {
    const lead = await makeDueLead();
    await makeDraftFor(lead.id);
    const failingDispatch = vi.fn().mockResolvedValue({ dispatched: false, error: 'simulated send failure' });

    const firstRun = await sweepScheduledReplies(anon, { now: new Date(), dispatch: failingDispatch });
    expect(firstRun.failed).toBe(1);

    const { data: afterFailure, error: readErr } = await anon
      .from('smart_leads')
      .select('auto_reply_status, claimed_at')
      .eq('id', lead.id)
      .single();
    expect(readErr).toBeNull();
    expect(afterFailure.auto_reply_status).toBe('scheduled');
    expect(afterFailure.claimed_at).toBeNull(); // released, not left stuck for the staleness window

    const succeedingDispatch = vi.fn().mockResolvedValue({ dispatched: true, channel: 'whatsapp' });
    const secondRun = await sweepScheduledReplies(anon, { now: new Date(), dispatch: succeedingDispatch });
    expect(secondRun.dispatched).toBe(1);
  });
});

if (!canRun) {
  describe('sweeper claim-lock — real Postgres contract', () => {
    it.skip('SKIPPED: set RUN_DB_INTEGRATION_TESTS=true after applying the migration to run these', () => {});
  });
}
