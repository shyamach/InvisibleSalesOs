/**
 * tests/autoReplySweeper.test.js
 * Rule #1 coverage for the auto-reply approval-window sweeper.
 * Uses a chainable Supabase mock + an injected dispatch fn — no network.
 */
import { describe, it, expect, vi } from 'vitest';

// sweepScheduledReplies' error path calls logSystemEvent() (Phase F), which
// reaches the real Supabase client if unmocked. Never let a unit test make
// a real network call / write real rows to the live system_logs table.
vi.mock('../lib/systemLog.js', () => ({ logSystemEvent: vi.fn() }));

import { isDue, sweepScheduledReplies, isLidAddress, makeDispatch, getSweeperStatus } from '../lib/autoReplySweeper.js';

const NOW = new Date('2026-06-28T12:30:00.000Z');
const PAST = '2026-06-28T12:00:00.000Z';   // window already elapsed
const FUTURE = '2026-06-28T13:00:00.000Z'; // window not yet up

/**
 * Minimal chainable Supabase mock.
 * - smart_leads list query (terminates on .limit) → returns `dueLeads`
 * - smart_interactions .maybeSingle() → returns draftByLead[lead_id]
 * - smart_leads claim update (.update({claimed_at}).../.or()/.select()/.maybeSingle())
 *   → resolved via injectable `claimResult(id)`, default always succeeds
 * - smart_leads mark-sent/release update (.update(...).eq().eq(), awaited via .then)
 *   → records into `updates`
 *
 * The presence of `.or(...)` in the chain is what distinguishes the claim
 * update from the mark-sent/release updates — matches the real code, where
 * only the claim step calls `.or()` + `.select().maybeSingle()`.
 */
function makeDb({ dueLeads = [], draftByLead = {}, updates = [], leadsError = null, claimResult = () => ({ data: { id: 'claimed' }, error: null }) }) {
  return {
    from(table) {
      const ctx = { table, eq: {}, update: null, isClaim: false };
      const builder = {
        select() { return builder; },
        eq(col, val) { ctx.eq[col] = val; return builder; },
        lte() { return builder; },
        is() { return builder; },
        order() { return builder; },
        or() { ctx.isClaim = true; return builder; },
        update(obj) { ctx.update = obj; return builder; },
        limit() { return builder; },
        maybeSingle() {
          if (table === 'smart_interactions') {
            return Promise.resolve({ data: draftByLead[ctx.eq.lead_id] || null, error: null });
          }
          if (table === 'smart_leads' && ctx.isClaim) {
            const result = claimResult(ctx.eq.id);
            updates.push({ id: ctx.eq.id, kind: 'claim', update: ctx.update, result });
            return Promise.resolve(result);
          }
          return Promise.resolve({ data: null, error: null });
        },
        then(resolve) {
          if (ctx.update) {
            const kind = ctx.update.claimed_at === null ? 'release' : 'mark_sent';
            updates.push({ id: ctx.eq.id, kind, guard: ctx.eq.auto_reply_status, update: ctx.update });
            return resolve({ data: [{}], error: null });
          }
          if (table === 'smart_leads') return resolve({ data: dueLeads, error: leadsError });
          return resolve({ data: [], error: null });
        },
      };
      return builder;
    },
  };
}

/**
 * A single-row, stateful fake that faithfully models the real claim
 * UPDATE's WHERE clause (auto_reply_status = 'scheduled' AND (claimed_at IS
 * NULL OR claimed_at < staleBefore)) as an atomic check-then-set — the same
 * guarantee a single real Postgres UPDATE statement provides. Two
 * "concurrent" callers sharing the same `row` object can prove mutual
 * exclusion the same way two real overlapping sweeper runs would, since the
 * check-then-set here never yields to another microtask mid-operation,
 * exactly like a single SQL UPDATE never yields mid-statement.
 */
function makeSharedRowDb({ row, draft }) {
  return {
    from(table) {
      const ctx = { table, eq: {}, update: null, isClaim: false, staleBefore: null };
      const builder = {
        select() { return builder; },
        eq(col, val) { ctx.eq[col] = val; return builder; },
        lte() { return builder; },
        is() { return builder; },
        order() { return builder; },
        or(filterStr) {
          ctx.isClaim = true;
          const m = /claimed_at\.lt\.([^,]+)/.exec(filterStr);
          ctx.staleBefore = m ? m[1] : null;
          return builder;
        },
        update(obj) { ctx.update = obj; return builder; },
        limit() { return builder; },
        maybeSingle() {
          if (table === 'smart_interactions') {
            return Promise.resolve({ data: draft || null, error: null });
          }
          if (table === 'smart_leads' && ctx.isClaim) {
            const statusOk = row.auto_reply_status === ctx.eq.auto_reply_status;
            const claimFree = row.claimed_at === null || row.claimed_at < ctx.staleBefore;
            if (statusOk && claimFree) {
              row.claimed_at = ctx.update.claimed_at;
              return Promise.resolve({ data: { id: row.id }, error: null });
            }
            return Promise.resolve({ data: null, error: null });
          }
          return Promise.resolve({ data: null, error: null });
        },
        then(resolve) {
          if (ctx.update) {
            if (row.auto_reply_status === ctx.eq.auto_reply_status) {
              Object.assign(row, ctx.update);
            }
            return resolve({ data: [{}], error: null });
          }
          if (table === 'smart_leads') return resolve({ data: [{ ...row }], error: null });
          return resolve({ data: [], error: null });
        },
      };
      return builder;
    },
  };
}

describe('isDue', () => {
  it('true when scheduled and window elapsed', () => {
    expect(isDue({ auto_reply_status: 'scheduled', scheduled_dispatch_at: PAST }, NOW)).toBe(true);
  });
  it('false when window not yet up', () => {
    expect(isDue({ auto_reply_status: 'scheduled', scheduled_dispatch_at: FUTURE }, NOW)).toBe(false);
  });
  it('false when not in scheduled status (e.g. rejected)', () => {
    expect(isDue({ auto_reply_status: 'rejected', scheduled_dispatch_at: PAST }, NOW)).toBe(false);
  });
  it('false on missing timestamp or null lead', () => {
    expect(isDue({ auto_reply_status: 'scheduled', scheduled_dispatch_at: null }, NOW)).toBe(false);
    expect(isDue(null, NOW)).toBe(false);
  });
});

describe('sweepScheduledReplies', () => {
  it('dispatches a due draft and marks it sent (guarded on scheduled)', async () => {
    const updates = [];
    const db = makeDb({
      dueLeads: [{ id: 'lead-1', phone_number: '+447900000000', scheduled_dispatch_at: PAST, auto_reply_status: 'scheduled' }],
      draftByLead: { 'lead-1': { id: 'd1', message_content: 'Hi, following up on your order.' } },
      updates,
    });
    const dispatch = vi.fn().mockResolvedValue({ dispatched: true, channel: 'whatsapp', status: 'delivered' });

    const summary = await sweepScheduledReplies(db, { now: NOW, dispatch });

    expect(dispatch).toHaveBeenCalledOnce();
    expect(dispatch.mock.calls[0][1]).toBe('Hi, following up on your order.');
    expect(summary).toMatchObject({ scanned: 1, dispatched: 1, failed: 0, skipped: 0, claimLost: 0 });
    expect(updates.find((u) => u.kind === 'claim')).toMatchObject({ id: 'lead-1' });
    expect(updates.find((u) => u.kind === 'mark_sent')).toMatchObject({
      id: 'lead-1',
      guard: 'scheduled',
      update: { auto_reply_status: 'sent' },
    });
  });

  it('skips a lead with no draft and does not dispatch', async () => {
    const updates = [];
    const db = makeDb({
      dueLeads: [{ id: 'lead-2', phone_number: '+447900000001', scheduled_dispatch_at: PAST, auto_reply_status: 'scheduled' }],
      draftByLead: {}, // no draft
      updates,
    });
    const dispatch = vi.fn();

    const summary = await sweepScheduledReplies(db, { now: NOW, dispatch });

    expect(dispatch).not.toHaveBeenCalled();
    expect(summary).toMatchObject({ scanned: 1, dispatched: 0, skipped: 1 });
    expect(updates.some((u) => u.kind === 'mark_sent')).toBe(false);
  });

  it('counts a failed dispatch, leaves status scheduled, and releases the claim for immediate retry', async () => {
    const updates = [];
    const db = makeDb({
      dueLeads: [{ id: 'lead-3', phone_number: '+447900000002', scheduled_dispatch_at: PAST, auto_reply_status: 'scheduled' }],
      draftByLead: { 'lead-3': { id: 'd3', message_content: 'Hello again.' } },
      updates,
    });
    const dispatch = vi.fn().mockResolvedValue({ dispatched: false, status: 'failed' });

    const summary = await sweepScheduledReplies(db, { now: NOW, dispatch });

    expect(summary).toMatchObject({ scanned: 1, dispatched: 0, failed: 1 });
    expect(updates.some((u) => u.kind === 'mark_sent')).toBe(false); // not marked sent
    expect(updates.find((u) => u.kind === 'release')).toMatchObject({
      id: 'lead-3',
      guard: 'scheduled',
      update: { claimed_at: null },
    });
  });

  it('does not dispatch when another sweeper already holds a fresh claim on the row', async () => {
    const updates = [];
    const db = makeDb({
      dueLeads: [{ id: 'lead-claimed', phone_number: '+447900000009', scheduled_dispatch_at: PAST, auto_reply_status: 'scheduled' }],
      draftByLead: { 'lead-claimed': { id: 'd9', message_content: 'Should never be sent by us.' } },
      updates,
      claimResult: () => ({ data: null, error: null }), // simulates a concurrent sweeper already owning this row
    });
    const dispatch = vi.fn();

    const summary = await sweepScheduledReplies(db, { now: NOW, dispatch });

    expect(dispatch).not.toHaveBeenCalled();
    expect(summary).toMatchObject({ scanned: 1, dispatched: 0, claimLost: 1 });
  });

  it('two concurrent sweep runs on the same due lead: only one claims and dispatches, the other is skipped', async () => {
    const row = { id: 'lead-race', auto_reply_status: 'scheduled', claimed_at: null, phone_number: '+447900000010', scheduled_dispatch_at: PAST };
    const draft = { id: 'd-race', message_content: 'Only one of us should send this.' };
    const sharedDb = makeSharedRowDb({ row, draft });
    const dispatch = vi.fn().mockResolvedValue({ dispatched: true, channel: 'whatsapp' });

    const [summaryA, summaryB] = await Promise.all([
      sweepScheduledReplies(sharedDb, { now: NOW, dispatch }),
      sweepScheduledReplies(sharedDb, { now: NOW, dispatch }),
    ]);

    // The customer-facing send fired exactly once across both "concurrent" runs.
    expect(dispatch).toHaveBeenCalledOnce();

    const dispatchedCount = summaryA.dispatched + summaryB.dispatched;
    const claimLostCount = summaryA.claimLost + summaryB.claimLost;
    expect(dispatchedCount).toBe(1);
    expect(claimLostCount).toBe(1);
    expect(row.auto_reply_status).toBe('sent');
  });

  it('recovers a stale claim left behind by a crashed sweeper run and dispatches normally', async () => {
    const staleClaimTime = new Date(NOW.getTime() - 10 * 60 * 1000).toISOString(); // 10 min ago, older than the 5 min staleness window
    const row = { id: 'lead-stale', auto_reply_status: 'scheduled', claimed_at: staleClaimTime, phone_number: '+447900000011', scheduled_dispatch_at: PAST };
    const draft = { id: 'd-stale', message_content: 'Recovered after a crash.' };
    const sharedDb = makeSharedRowDb({ row, draft });
    const dispatch = vi.fn().mockResolvedValue({ dispatched: true, channel: 'whatsapp' });

    const summary = await sweepScheduledReplies(sharedDb, { now: NOW, dispatch });

    expect(dispatch).toHaveBeenCalledOnce();
    expect(summary).toMatchObject({ dispatched: 1, claimLost: 0 });
    expect(row.auto_reply_status).toBe('sent');
  });

  it('does NOT recover a fresh (not yet stale) claim — leaves it to the run that holds it', async () => {
    const freshClaimTime = new Date(NOW.getTime() - 30 * 1000).toISOString(); // 30s ago, well within the 5 min window
    const row = { id: 'lead-fresh', auto_reply_status: 'scheduled', claimed_at: freshClaimTime, phone_number: '+447900000012', scheduled_dispatch_at: PAST };
    const sharedDb = makeSharedRowDb({ row, draft: null });
    const dispatch = vi.fn();

    const summary = await sweepScheduledReplies(sharedDb, { now: NOW, dispatch });

    expect(dispatch).not.toHaveBeenCalled();
    expect(summary).toMatchObject({ dispatched: 0, claimLost: 1 });
  });

  it('returns gracefully when the lead query errors', async () => {
    const db = makeDb({ leadsError: { message: 'db down' } });
    const dispatch = vi.fn();

    const summary = await sweepScheduledReplies(db, { now: NOW, dispatch });

    expect(dispatch).not.toHaveBeenCalled();
    expect(summary.error).toBe('db down');
    expect(summary).toMatchObject({ scanned: 0, dispatched: 0 });
  });

  it('no-ops cleanly when nothing is due', async () => {
    const db = makeDb({ dueLeads: [] });
    const summary = await sweepScheduledReplies(db, { now: NOW, dispatch: vi.fn() });
    expect(summary).toMatchObject({ scanned: 0, dispatched: 0, failed: 0, skipped: 0 });
  });

  it('survives a dispatch that throws (counts as failed)', async () => {
    const db = makeDb({
      dueLeads: [{ id: 'lead-4', phone_number: '+447900000003', scheduled_dispatch_at: PAST, auto_reply_status: 'scheduled' }],
      draftByLead: { 'lead-4': { id: 'd4', message_content: 'Boom test.' } },
    });
    const dispatch = vi.fn().mockRejectedValue(new Error('meta timeout'));

    const summary = await sweepScheduledReplies(db, { now: NOW, dispatch });
    expect(summary).toMatchObject({ scanned: 1, failed: 1, dispatched: 0 });
  });
});

// ─── isLidAddress ─────────────────────────────────────────────────────────────

describe('isLidAddress', () => {
  it('returns true for a wwebjs @lid device identifier', () => {
    expect(isLidAddress('1234567890@lid')).toBe(true);
  });
  it('returns false for a normal E.164 phone number', () => {
    expect(isLidAddress('+447900000000')).toBe(false);
  });
  it('returns false for null / undefined (no crash)', () => {
    expect(isLidAddress(null)).toBe(false);
    expect(isLidAddress(undefined)).toBe(false);
  });
});

// ─── makeDispatch ─────────────────────────────────────────────────────────────

describe('makeDispatch', () => {
  it('routes @lid to whatsappSender and returns dispatched:true', async () => {
    const sender = vi.fn().mockResolvedValue();
    const standard = vi.fn();
    const dispatch = makeDispatch(sender, standard);

    const result = await dispatch({ phone: '9991234@lid' }, 'Hello from sweeper');

    expect(sender).toHaveBeenCalledWith('9991234@lid', 'Hello from sweeper');
    expect(standard).not.toHaveBeenCalled();
    expect(result).toMatchObject({ dispatched: true, channel: 'whatsapp', via: 'wwebjs' });
  });

  it('routes non-@lid phone to standard dispatch', async () => {
    const sender = vi.fn();
    const standard = vi.fn().mockResolvedValue({ dispatched: true, channel: 'whatsapp' });
    const dispatch = makeDispatch(sender, standard);

    await dispatch({ phone: '+447900000000' }, 'Hello');

    expect(sender).not.toHaveBeenCalled();
    expect(standard).toHaveBeenCalledOnce();
  });

  it('falls through to standard dispatch when whatsappSender is null, even for @lid', async () => {
    const standard = vi.fn().mockResolvedValue({ dispatched: false, status: 'no_address' });
    const dispatch = makeDispatch(null, standard);

    await dispatch({ phone: '9991234@lid' }, 'Hello');

    expect(standard).toHaveBeenCalledOnce();
  });

  it('returns dispatched:false when whatsappSender throws', async () => {
    const sender = vi.fn().mockRejectedValue(new Error('wwebjs offline'));
    const standard = vi.fn();
    const dispatch = makeDispatch(sender, standard);

    const result = await dispatch({ phone: '9991234@lid' }, 'Test');

    expect(result).toMatchObject({ dispatched: false, error: 'wwebjs offline' });
    expect(standard).not.toHaveBeenCalled();
  });

  it('end-to-end: sweepScheduledReplies with makeDispatch routes @lid lead through whatsappSender', async () => {
    const updates = [];
    const db = makeDb({
      dueLeads: [{ id: 'lead-lid', phone_number: '9991234@lid', scheduled_dispatch_at: PAST, auto_reply_status: 'scheduled' }],
      draftByLead: { 'lead-lid': { id: 'd-lid', message_content: 'Hey there.' } },
      updates,
    });
    const sender = vi.fn().mockResolvedValue();
    const standard = vi.fn();
    const dispatch = makeDispatch(sender, standard);

    const summary = await sweepScheduledReplies(db, { now: NOW, dispatch });

    expect(sender).toHaveBeenCalledWith('9991234@lid', 'Hey there.');
    expect(standard).not.toHaveBeenCalled();
    expect(summary).toMatchObject({ scanned: 1, dispatched: 1, failed: 0 });
    expect(updates.find((u) => u.kind === 'mark_sent')).toMatchObject({ id: 'lead-lid', update: { auto_reply_status: 'sent' } });
  });

  it('getSweeperStatus() reflects the most recent run (Phase E, item E3)', async () => {
    const db = makeDb({ dueLeads: [] });
    const before = Date.now();

    await sweepScheduledReplies(db, { now: NOW });

    const status = getSweeperStatus();
    expect(new Date(status.at).getTime()).toBeGreaterThanOrEqual(before);
    expect(status.summary).toMatchObject({ scanned: 0, dispatched: 0, failed: 0, skipped: 0, claimLost: 0 });
  });
});
