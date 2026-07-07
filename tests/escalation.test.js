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

// ─── controller (mocked req.supabase) ────────────────────────────────────────────
// Tenant identity comes from req.tenantId (set by requireAuth from a verified
// JWT — see lib/authMiddleware.js) and queries run on req.supabase (the
// per-request client), not the shared lib/supabase.js client. Tests build a
// mock req directly instead of module-mocking lib/supabase.js.

const mockFrom = vi.hoisted(() => vi.fn());
import { createEscalation, listEscalations, updateEscalation, getAttribution } from '../controllers/escalations.js';

const TENANT_A = 'tenant-uuid-1';
const SPOOFED_TENANT_B = 'tenant-uuid-spoofed';

function mockRes() {
  return { _status: 200, _body: null, status(c) { this._status = c; return this; }, json(b) { this._body = b; return this; } };
}

// Builds a request carrying a mock req.supabase — mirrors what requireAuth
// attaches on a real request. `tenantId` defaults to TENANT_A; pass
// `tenantId: null` to exercise the no-tenant guard.
function mockReq(overrides = {}) {
  return {
    tenantId: TENANT_A,
    supabase: { from: mockFrom },
    headers: {},
    ...overrides,
  };
}

beforeEach(() => vi.clearAllMocks());

describe('tenant guard — applies across all escalation handlers', () => {
  it('listEscalations returns 403 and never touches the DB when req.tenantId is null', async () => {
    const res = mockRes();
    await listEscalations(mockReq({ tenantId: null, query: {} }), res);
    expect(res._status).toBe(403);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('createEscalation returns 403 and never touches the DB when req.tenantId is null', async () => {
    const res = mockRes();
    await createEscalation(mockReq({ tenantId: null, body: { lead_id: 'l1' } }), res);
    expect(res._status).toBe(403);
    expect(mockFrom).not.toHaveBeenCalled();
  });
});

describe('createEscalation', () => {
  it('inserts scoped by req.tenantId and flags the lead, ignoring any x-tenant-id header', async () => {
    const single = vi.fn().mockResolvedValue({ data: { id: 'e1', lead_id: 'l1' }, error: null });
    const select = vi.fn(() => ({ single }));
    const insert = vi.fn(() => ({ select }));
    const leadEq2 = vi.fn().mockResolvedValue({ data: null, error: null });
    const leadEq1 = vi.fn(() => ({ eq: leadEq2 }));
    const leadUpdate = vi.fn(() => ({ eq: leadEq1 }));

    mockFrom.mockImplementation((table) => {
      if (table === 'escalations') return { insert };
      if (table === 'smart_leads') return { update: leadUpdate };
      throw new Error(`unexpected table ${table}`);
    });

    const res = mockRes();
    await createEscalation(mockReq({ body: { lead_id: 'l1', reason: 'manual' }, headers: { 'x-tenant-id': SPOOFED_TENANT_B } }), res);

    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ tenant_id: TENANT_A, lead_id: 'l1' }));
    expect(leadEq1).toHaveBeenCalledWith('tenant_id', TENANT_A);
    expect(res._status).toBe(201);
    expect(res._body).toMatchObject({ success: true, escalation: { id: 'e1' } });
  });

  it('rejects an invalid reason with 400 without touching the DB', async () => {
    const res = mockRes();
    await createEscalation(mockReq({ body: { lead_id: 'l1', reason: 'not-a-reason' } }), res);
    expect(res._status).toBe(400);
    expect(mockFrom).not.toHaveBeenCalled();
  });
});

describe('listEscalations', () => {
  it('filters by req.tenantId, ignoring any x-tenant-id header', async () => {
    const limit = vi.fn().mockResolvedValue({ data: [{ id: 'e1' }], error: null });
    const order = vi.fn(() => ({ limit }));
    const eq = vi.fn(() => ({ order }));
    const select = vi.fn(() => ({ eq }));
    mockFrom.mockReturnValue({ select });

    const res = mockRes();
    await listEscalations(mockReq({ query: {}, headers: { 'x-tenant-id': SPOOFED_TENANT_B } }), res);

    expect(eq).toHaveBeenCalledWith('tenant_id', TENANT_A);
    expect(res._status).toBe(200);
    expect(res._body).toMatchObject({ success: true, escalations: [{ id: 'e1' }] });
  });
});

describe('updateEscalation', () => {
  it('rejects an illegal transition with 400', async () => {
    // fetch current → converted (terminal)
    mockFrom.mockReturnValue({
      select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: vi.fn().mockResolvedValue({ data: { id: 'e1', status: 'converted', lead_id: 'l1' }, error: null }) }) }) }),
    });
    const res = mockRes();
    await updateEscalation(mockReq({ params: { id: 'e1' }, body: { status: 'rejected' } }), res);
    expect(res._status).toBe(400);
    expect(res._body.error).toMatch(/cannot move/);
  });

  it('404s when the escalation is missing', async () => {
    mockFrom.mockReturnValue({
      select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }) }) }) }),
    });
    const res = mockRes();
    await updateEscalation(mockReq({ params: { id: 'nope' }, body: { status: 'accepted' } }), res);
    expect(res._status).toBe(404);
  });

  it('scopes both the fetch and the terminal-status smart_leads mirror update by req.tenantId', async () => {
    const fetchEq2 = vi.fn().mockResolvedValue({ data: { id: 'e1', status: 'pending', lead_id: 'l1' }, error: null });
    const fetchEq1 = vi.fn(() => ({ eq: () => ({ maybeSingle: fetchEq2 }) }));
    const single = vi.fn().mockResolvedValue({ data: { id: 'e1', status: 'converted' }, error: null });
    const updateSelect = vi.fn(() => ({ single }));
    const updateEq2 = vi.fn(() => ({ select: updateSelect }));
    const updateEq1 = vi.fn(() => ({ eq: updateEq2 }));
    const update = vi.fn(() => ({ eq: updateEq1 }));
    const leadEq2 = vi.fn().mockResolvedValue({ data: null, error: null });
    const leadEq1 = vi.fn(() => ({ eq: leadEq2 }));
    const leadUpdate = vi.fn(() => ({ eq: leadEq1 }));

    mockFrom.mockImplementation((table) => {
      if (table === 'escalations') return { select: () => ({ eq: fetchEq1 }), update };
      if (table === 'smart_leads') return { update: leadUpdate };
      throw new Error(`unexpected table ${table}`);
    });

    const res = mockRes();
    await updateEscalation(mockReq({ params: { id: 'e1' }, body: { status: 'converted' } }), res);

    expect(fetchEq1).toHaveBeenCalledWith('tenant_id', TENANT_A);
    expect(updateEq1).toHaveBeenCalledWith('tenant_id', TENANT_A);
    expect(leadEq1).toHaveBeenCalledWith('tenant_id', TENANT_A);
    expect(res._status).toBe(200);
  });
});

describe('getAttribution', () => {
  it('filters by req.tenantId, ignoring any x-tenant-id header', async () => {
    const eq = vi.fn().mockResolvedValue({ data: [{ assigned_to_name: 'Sara', status: 'converted', deal_value: 1000 }], error: null });
    const select = vi.fn(() => ({ eq }));
    mockFrom.mockReturnValue({ select });

    const res = mockRes();
    await getAttribution(mockReq({ headers: { 'x-tenant-id': SPOOFED_TENANT_B } }), res);

    expect(eq).toHaveBeenCalledWith('tenant_id', TENANT_A);
    expect(res._status).toBe(200);
    expect(res._body.success).toBe(true);
    expect(res._body.attribution[0]).toMatchObject({ rep: 'Sara' });
  });
});
