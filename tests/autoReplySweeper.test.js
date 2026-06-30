/**
 * tests/autoReplySweeper.test.js
 * Rule #1 coverage for the auto-reply approval-window sweeper.
 * Uses a chainable Supabase mock + an injected dispatch fn — no network.
 */
import { describe, it, expect, vi } from 'vitest';
import { isDue, sweepScheduledReplies, isLidAddress, makeDispatch } from '../lib/autoReplySweeper.js';

const NOW = new Date('2026-06-28T12:30:00.000Z');
const PAST = '2026-06-28T12:00:00.000Z';   // window already elapsed
const FUTURE = '2026-06-28T13:00:00.000Z'; // window not yet up

/**
 * Minimal chainable Supabase mock.
 * - smart_leads list query (terminates on .limit) → returns `dueLeads`
 * - smart_interactions .maybeSingle() → returns draftByLead[lead_id]
 * - smart_leads .update(...).eq().eq() (awaited) → records into `updates`
 */
function makeDb({ dueLeads = [], draftByLead = {}, updates = [], leadsError = null }) {
  return {
    from(table) {
      const ctx = { table, eq: {}, update: null };
      const builder = {
        select() { return builder; },
        eq(col, val) { ctx.eq[col] = val; return builder; },
        lte() { return builder; },
        is() { return builder; },
        order() { return builder; },
        update(obj) { ctx.update = obj; return builder; },
        limit() { return builder; },
        maybeSingle() {
          if (table === 'smart_interactions') {
            return Promise.resolve({ data: draftByLead[ctx.eq.lead_id] || null, error: null });
          }
          return Promise.resolve({ data: null, error: null });
        },
        then(resolve) {
          if (ctx.update) {
            updates.push({ id: ctx.eq.id, guard: ctx.eq.auto_reply_status, update: ctx.update });
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
    expect(summary).toMatchObject({ scanned: 1, dispatched: 1, failed: 0, skipped: 0 });
    expect(updates[0]).toMatchObject({
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
    expect(updates).toHaveLength(0);
  });

  it('counts a failed dispatch and leaves status untouched for retry', async () => {
    const updates = [];
    const db = makeDb({
      dueLeads: [{ id: 'lead-3', phone_number: '+447900000002', scheduled_dispatch_at: PAST, auto_reply_status: 'scheduled' }],
      draftByLead: { 'lead-3': { id: 'd3', message_content: 'Hello again.' } },
      updates,
    });
    const dispatch = vi.fn().mockResolvedValue({ dispatched: false, status: 'failed' });

    const summary = await sweepScheduledReplies(db, { now: NOW, dispatch });

    expect(summary).toMatchObject({ scanned: 1, dispatched: 0, failed: 1 });
    expect(updates).toHaveLength(0); // not marked sent
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
    expect(updates[0]).toMatchObject({ id: 'lead-lid', update: { auto_reply_status: 'sent' } });
  });
});
