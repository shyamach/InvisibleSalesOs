/**
 * tests/escalation.test.js
 * Rule #1 coverage for sales-rep handoff: detection, outcome state machine,
 * attribution (pure) + the controller's transition-validated update (mocked DB).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  detectEscalation,
  validateOutcomeTransition,
  isTerminal,
  summarizeAttribution,
} from '../lib/escalation.js';

// ─── detectEscalation ─────────────────────────────────────────────────────────
describe('detectEscalation', () => {
  it('escalates on price-negotiation language', () => {
    const r = detectEscalation({ profile: { query: 'can you give me a discount on bulk order?' } });
    expect(r).toMatchObject({ escalate: true, reason: 'price_negotiation' });
  });

  it('escalates out_of_stock when all matched products are unavailable', () => {
    const r = detectEscalation({
      profile: { query: 'need basmati rice' },
      catalogueMatches: [{ name: 'Basmati Rice 20kg', stock_quantity: 0 }],
    });
    expect(r).toMatchObject({ escalate: true, reason: 'out_of_stock' });
    expect(r.context).toMatch(/Basmati Rice 20kg/);
  });

  it('does NOT escalate when an in-stock match exists', () => {
    const r = detectEscalation({
      profile: { query: 'need rice' },
      catalogueMatches: [
        { name: 'Basmati 20kg', stock_quantity: 0 },
        { name: 'Basmati 10kg', stock_quantity: 30 },
      ],
    });
    expect(r.escalate).toBe(false);
  });

  it('does not escalate an ordinary enquiry', () => {
    expect(detectEscalation({ profile: { query: 'do you deliver to London?' } }).escalate).toBe(false);
    expect(detectEscalation({}).escalate).toBe(false);
  });

  it('prioritises price negotiation even when stock is out', () => {
    const r = detectEscalation({
      profile: { query: 'whats your best price' },
      catalogueMatches: [{ name: 'X', stock_quantity: 0 }],
    });
    expect(r.reason).toBe('price_negotiation');
  });
});

// ─── outcome state machine ──────────────────────────────────────────────────────
describe('validateOutcomeTransition', () => {
  it('allows valid moves', () => {
    expect(validateOutcomeTransition('pending', 'accepted').ok).toBe(true);
    expect(validateOutcomeTransition('accepted', 'converted').ok).toBe(true);
    expect(validateOutcomeTransition('stalled', 'rejected').ok).toBe(true);
  });
  it('blocks moves out of terminal states', () => {
    expect(validateOutcomeTransition('converted', 'rejected').ok).toBe(false);
    expect(validateOutcomeTransition('rejected', 'accepted').ok).toBe(false);
  });
  it('blocks no-op and invalid statuses', () => {
    expect(validateOutcomeTransition('pending', 'pending').ok).toBe(false);
    expect(validateOutcomeTransition('pending', 'banana').ok).toBe(false);
  });
  it('isTerminal flags converted/rejected only', () => {
    expect(isTerminal('converted')).toBe(true);
    expect(isTerminal('rejected')).toBe(true);
    expect(isTerminal('pending')).toBe(false);
  });
});

// ─── attribution ────────────────────────────────────────────────────────────────
describe('summarizeAttribution', () => {
  it('aggregates per rep with conversion rate and won value', () => {
    const rows = [
      { assigned_to_name: 'Sara', status: 'converted', deal_value: 1000 },
      { assigned_to_name: 'Sara', status: 'rejected', deal_value: null },
      { assigned_to_name: 'Omar', status: 'converted', deal_value: 500 },
      { assigned_to_name: null, status: 'pending', deal_value: null },
    ];
    const out = summarizeAttribution(rows);
    const sara = out.find((r) => r.rep === 'Sara');
    expect(sara).toMatchObject({ total: 2, converted: 1, value: 1000, conversion_rate: 50 });
    expect(out.find((r) => r.rep === 'Unassigned').total).toBe(1);
    // sorted by value desc → Sara first
    expect(out[0].rep).toBe('Sara');
  });

  it('handles an empty list', () => {
    expect(summarizeAttribution([])).toEqual([]);
  });
});

// ─── controller: updateEscalation transition guard (mocked Supabase) ─────────────
const mockFrom = vi.hoisted(() => vi.fn());
vi.mock('../lib/supabase.js', () => ({ supabase: { from: mockFrom } }));
import { updateEscalation } from '../controllers/escalations.js';

function mockRes() {
  return { _status: 200, _body: null, status(c) { this._status = c; return this; }, json(b) { this._body = b; return this; } };
}
beforeEach(() => vi.clearAllMocks());

describe('updateEscalation', () => {
  it('rejects an illegal transition with 400', async () => {
    // fetch current → converted (terminal)
    mockFrom.mockReturnValue({
      select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: vi.fn().mockResolvedValue({ data: { id: 'e1', status: 'converted', lead_id: 'l1' }, error: null }) }) }) }),
    });
    const res = mockRes();
    await updateEscalation({ headers: {}, params: { id: 'e1' }, body: { status: 'rejected' } }, res);
    expect(res._status).toBe(400);
    expect(res._body.error).toMatch(/cannot move/);
  });

  it('404s when the escalation is missing', async () => {
    mockFrom.mockReturnValue({
      select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }) }) }) }),
    });
    const res = mockRes();
    await updateEscalation({ headers: {}, params: { id: 'nope' }, body: { status: 'accepted' } }, res);
    expect(res._status).toBe(404);
  });
});
