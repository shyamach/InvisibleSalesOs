/**
 * tests/quotesController.test.js
 * Controller coverage for controllers/quotes.js (mocked req.supabase).
 *
 * Tenant identity comes from req.tenantId (set by requireAuth from a verified
 * JWT — see lib/authMiddleware.js) and queries run on req.supabase (the
 * per-request client), not a shared client — controllers/quotes.js never
 * instantiates its own.
 *
 * Kept separate from tests/quotes.test.js, which covers the pure
 * calculateQuoteTotals helper shared with the frontend Quote Builder.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
  listQuotes,
  getQuote,
  createQuote,
  updateQuote,
} from '../controllers/quotes.js';

const TENANT_A = 'tenant-uuid-1';
const SPOOFED_TENANT_B = 'tenant-uuid-spoofed';

function mockRes() {
  const res = {
    _status: 200,
    _body: null,
    status(c) { this._status = c; return this; },
    json(b) { this._body = b; return this; },
  };
  return res;
}

// A chainable, thenable Supabase query-builder mock: every method returns
// the same chain (so any call order works) and awaiting the chain itself
// resolves to `result` — covers both the `await query` (list) and the
// `.select().single()` (get/insert/update) call shapes.
function makeChain(result = { data: null, error: null }) {
  const chain = {};
  const passthrough = () => chain;
  chain.select = vi.fn(passthrough);
  chain.insert = vi.fn(passthrough);
  chain.update = vi.fn(passthrough);
  chain.eq = vi.fn(passthrough);
  chain.order = vi.fn(passthrough);
  chain.limit = vi.fn(passthrough);
  chain.single = vi.fn().mockResolvedValue(result);
  chain.then = (resolve) => resolve(result);
  return chain;
}

const mockFrom = vi.hoisted(() => vi.fn());

function mockReq(overrides = {}) {
  return {
    tenantId: TENANT_A,
    userRole: 'owner',
    supabase: { from: mockFrom },
    headers: {},
    query: {},
    body: {},
    params: {},
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('tenant guard — applies across all quote handlers', () => {
  it('listQuotes returns 403 and never touches the DB when req.tenantId is null', async () => {
    const res = mockRes();
    await listQuotes(mockReq({ tenantId: null }), res);
    expect(res._status).toBe(403);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('getQuote returns 403 and never touches the DB when req.tenantId is null', async () => {
    const res = mockRes();
    await getQuote(mockReq({ tenantId: null, params: { id: 'q1' } }), res);
    expect(res._status).toBe(403);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('createQuote returns 403 and never touches the DB when req.tenantId is null', async () => {
    const res = mockRes();
    await createQuote(mockReq({ tenantId: null, body: {} }), res);
    expect(res._status).toBe(403);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('updateQuote returns 403 and never touches the DB when req.tenantId is null', async () => {
    const res = mockRes();
    await updateQuote(mockReq({ tenantId: null, params: { id: 'q1' }, body: { status: 'sent' } }), res);
    expect(res._status).toBe(403);
    expect(mockFrom).not.toHaveBeenCalled();
  });
});

describe('role guard — owner/admin only on mutating routes', () => {
  it('createQuote: member role gets 403, never touches the DB', async () => {
    const res = mockRes();
    await createQuote(mockReq({ userRole: 'member', body: {} }), res);
    expect(res._status).toBe(403);
    expect(res._body.error).toMatch(/owners and admins/);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('updateQuote: member role gets 403, never touches the DB', async () => {
    const res = mockRes();
    await updateQuote(mockReq({ userRole: 'member', params: { id: 'q1' }, body: { status: 'sent' } }), res);
    expect(res._status).toBe(403);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('listQuotes: member role is NOT gated — list stays open to any tenant member', async () => {
    mockFrom.mockReturnValue(makeChain({ data: [], error: null }));
    const res = mockRes();
    await listQuotes(mockReq({ userRole: 'member' }), res);
    expect(res._status).toBe(200);
  });

  it('getQuote: member role is NOT gated — read stays open to any tenant member', async () => {
    mockFrom.mockReturnValue(makeChain({ data: { id: 'q1', tenant_id: TENANT_A }, error: null }));
    const res = mockRes();
    await getQuote(mockReq({ userRole: 'member', params: { id: 'q1' } }), res);
    expect(res._status).toBe(200);
  });
});

describe('listQuotes', () => {
  it('filters by req.tenantId', async () => {
    const chain = makeChain({ data: [{ id: 'q1' }], error: null });
    mockFrom.mockReturnValue(chain);

    const res = mockRes();
    await listQuotes(mockReq(), res);

    expect(chain.eq).toHaveBeenCalledWith('tenant_id', TENANT_A);
    expect(res._status).toBe(200);
    expect(res._body).toMatchObject({ quotes: [{ id: 'q1' }] });
  });

  it('applies an optional status filter', async () => {
    const chain = makeChain({ data: [], error: null });
    mockFrom.mockReturnValue(chain);

    const res = mockRes();
    await listQuotes(mockReq({ query: { status: 'sent' } }), res);

    expect(chain.eq).toHaveBeenCalledWith('status', 'sent');
    expect(res._status).toBe(200);
  });
});

describe('getQuote', () => {
  it('adds an id + tenant_id filter, ignoring any spoofed header tenant', async () => {
    const chain = makeChain({ data: { id: 'q1', tenant_id: TENANT_A }, error: null });
    mockFrom.mockReturnValue(chain);

    const res = mockRes();
    await getQuote(mockReq({ params: { id: 'q1' }, headers: { 'x-tenant-id': SPOOFED_TENANT_B } }), res);

    expect(chain.eq).toHaveBeenCalledWith('id', 'q1');
    expect(chain.eq).toHaveBeenCalledWith('tenant_id', TENANT_A);
    expect(res._status).toBe(200);
  });

  it('404s when not found (e.g. belongs to another tenant)', async () => {
    mockFrom.mockReturnValue(makeChain({ data: null, error: { message: 'no rows' } }));
    const res = mockRes();
    await getQuote(mockReq({ params: { id: 'q1' } }), res);
    expect(res._status).toBe(404);
  });
});

describe('createQuote', () => {
  it('stamps tenant_id from req.tenantId, ignoring any spoofed body tenant_id', async () => {
    const chain = makeChain({ data: { id: 'q1' }, error: null });
    mockFrom.mockReturnValue(chain);

    const res = mockRes();
    await createQuote(mockReq({ body: { tenant_id: SPOOFED_TENANT_B, subtotal: 10 } }), res);

    expect(chain.insert).toHaveBeenCalledWith(expect.objectContaining({ tenant_id: TENANT_A }));
    expect(res._status).toBe(201);
  });

  it('generates quote_number server-side, ignoring any client-supplied value', async () => {
    const countChain = makeChain({ count: 3, data: null, error: null });
    const insertChain = makeChain({ data: { id: 'q1' }, error: null });

    // nextQuoteNumber's count query and the insert both call req.supabase.from('quotes'),
    // in that order — first call gets the count chain, second gets the insert chain.
    let call = 0;
    mockFrom.mockImplementation(() => (call++ === 0 ? countChain : insertChain));

    const res = mockRes();
    await createQuote(mockReq({ body: { quote_number: 'SPOOFED-9999', subtotal: 10 } }), res);

    expect(insertChain.insert).toHaveBeenCalledWith(
      expect.objectContaining({ quote_number: 'QT-0004' })
    );
    expect(res._status).toBe(201);
  });

  it('never inserts tax_amount/total — both are DB GENERATED ALWAYS columns and Postgres rejects any explicit value for them', async () => {
    const chain = makeChain({ data: { id: 'q1' }, error: null });
    mockFrom.mockReturnValue(chain);

    const res = mockRes();
    await createQuote(mockReq({ body: { subtotal: 10, tax_rate: 0.2, tax_amount: 2, total: 12 } }), res);

    const insertPayload = chain.insert.mock.calls[0][0];
    expect(insertPayload).not.toHaveProperty('tax_amount');
    expect(insertPayload).not.toHaveProperty('total');
    expect(res._status).toBe(201);
  });
});

describe('updateQuote', () => {
  it('adds an id + tenant_id filter, ignoring any spoofed body tenant_id', async () => {
    const chain = makeChain({ data: { id: 'q1', status: 'sent' }, error: null });
    mockFrom.mockReturnValue(chain);

    const res = mockRes();
    await updateQuote(mockReq({ params: { id: 'q1' }, body: { status: 'sent', tenant_id: SPOOFED_TENANT_B } }), res);

    expect(chain.eq).toHaveBeenCalledWith('id', 'q1');
    expect(chain.eq).toHaveBeenCalledWith('tenant_id', TENANT_A);
    expect(res._status).toBe(200);
  });

  it('only applies allow-listed fields — tenant_id/id/created_at/updated_at/quote_number are never in the update payload', async () => {
    const chain = makeChain({ data: { id: 'q1' }, error: null });
    mockFrom.mockReturnValue(chain);

    const res = mockRes();
    await updateQuote(mockReq({
      params: { id: 'q1' },
      body: {
        status: 'accepted',
        tenant_id: SPOOFED_TENANT_B,
        id: 'other-id',
        created_at: '2000-01-01',
        updated_at: '2000-01-01',
        quote_number: 'SPOOFED-0001',
      },
    }), res);

    const updatePayload = chain.update.mock.calls[0][0];
    expect(updatePayload).toEqual({ status: 'accepted' });
    expect(updatePayload).not.toHaveProperty('tenant_id');
    expect(updatePayload).not.toHaveProperty('id');
    expect(updatePayload).not.toHaveProperty('created_at');
    expect(updatePayload).not.toHaveProperty('updated_at');
    expect(updatePayload).not.toHaveProperty('quote_number');
    expect(res._status).toBe(200);
  });

  it('404s when not found (e.g. belongs to another tenant)', async () => {
    mockFrom.mockReturnValue(makeChain({ data: null, error: { message: 'no rows' } }));
    const res = mockRes();
    await updateQuote(mockReq({ params: { id: 'q1' }, body: { status: 'sent' } }), res);
    expect(res._status).toBe(404);
  });

  it('400s when no valid fields are supplied', async () => {
    const res = mockRes();
    await updateQuote(mockReq({ params: { id: 'q1' }, body: { unknown_field: 'x' } }), res);
    expect(res._status).toBe(400);
    expect(mockFrom).not.toHaveBeenCalled();
  });
});
