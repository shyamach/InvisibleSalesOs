/**
 * tests/invoices.test.js
 * Controller coverage for controllers/invoices.js (mocked req.supabase).
 *
 * Tenant identity comes from req.tenantId (set by requireAuth from a verified
 * JWT — see lib/authMiddleware.js) and queries run on req.supabase (the
 * per-request client), not a shared client — controllers/invoices.js no
 * longer instantiates its own. Tests build a mock req directly.
 *
 * saveInboundInvoice (Lane B) is intentionally not covered here — it's
 * untouched by Block 1.1f and already takes its own client as a parameter.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../lib/invoicePdf.js', () => ({
  generateInvoicePdf: vi.fn().mockResolvedValue(Buffer.from('%PDF-fake')),
}));
vi.mock('../lib/invoiceParser.js', () => ({
  parseInvoicePdf: vi.fn().mockResolvedValue({ success: false, error: 'not exercised in these tests' }),
  extractFromText: vi.fn(),
}));

const mockCreateAndNotifyEscalation = vi.hoisted(() => vi.fn().mockResolvedValue({ created: true, escalationId: 'esc-1' }));
vi.mock('../lib/escalationService.js', () => ({
  createAndNotifyEscalation: mockCreateAndNotifyEscalation,
}));

import {
  listInvoices,
  getInvoice,
  createInvoice,
  convertQuoteToInvoice,
  updateInvoice,
  cancelInvoice,
  downloadInvoicePdf,
  uploadInvoice,
} from '../controllers/invoices.js';

const TENANT_A = 'tenant-uuid-1';
const SPOOFED_TENANT_B = 'tenant-uuid-spoofed';

function mockRes() {
  const res = {
    _status: 200,
    _body: null,
    _headers: {},
    status(c) { this._status = c; return this; },
    json(b) { this._body = b; return this; },
    setHeader(k, v) { this._headers[k] = v; },
    end(body) { this._body = body; },
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
  chain.maybeSingle = vi.fn().mockResolvedValue(result);
  chain.then = (resolve) => resolve(result);
  return chain;
}

const mockFrom = vi.hoisted(() => vi.fn());
const mockStorageUpload = vi.hoisted(() => vi.fn());
const mockStorageGetPublicUrl = vi.hoisted(() => vi.fn());
const mockRpc = vi.hoisted(() => vi.fn());

function mockReq(overrides = {}) {
  return {
    tenantId: TENANT_A,
    userId: 'user-1',
    userRole: 'owner',
    supabase: {
      from: mockFrom,
      rpc: mockRpc,
      storage: { from: () => ({ upload: mockStorageUpload, getPublicUrl: mockStorageGetPublicUrl }) },
    },
    headers: {},
    query: {},
    body: {},
    params: {},
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockStorageGetPublicUrl.mockReturnValue({ data: { publicUrl: 'https://storage.example/file.pdf' } });
});

describe('tenant guard — applies across all invoice handlers', () => {
  it('listInvoices returns 403 and never touches the DB when req.tenantId is null', async () => {
    const res = mockRes();
    await listInvoices(mockReq({ tenantId: null }), res);
    expect(res._status).toBe(403);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('createInvoice returns 403 and never touches the DB when req.tenantId is null', async () => {
    const res = mockRes();
    await createInvoice(mockReq({ tenantId: null, body: { line_items: [] } }), res);
    expect(res._status).toBe(403);
    expect(mockFrom).not.toHaveBeenCalled();
  });
});

describe('role guard — owner/admin only on mutating routes', () => {
  it('createInvoice: member role gets 403, never touches the DB', async () => {
    const res = mockRes();
    await createInvoice(mockReq({ userRole: 'member', body: {} }), res);
    expect(res._status).toBe(403);
    expect(res._body.error).toMatch(/owners and admins/);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('convertQuoteToInvoice: member role gets 403, never touches the DB', async () => {
    const res = mockRes();
    await convertQuoteToInvoice(mockReq({ userRole: 'member', params: { quoteId: 'q1' } }), res);
    expect(res._status).toBe(403);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('updateInvoice: member role gets 403, never touches the DB', async () => {
    const res = mockRes();
    await updateInvoice(mockReq({ userRole: 'member', params: { id: 'i1' }, body: { notes: 'x' } }), res);
    expect(res._status).toBe(403);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('cancelInvoice: member role gets 403, never touches the DB', async () => {
    const res = mockRes();
    await cancelInvoice(mockReq({ userRole: 'member', params: { id: 'i1' } }), res);
    expect(res._status).toBe(403);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('uploadInvoice: member role gets 403, never touches storage', async () => {
    const res = mockRes();
    await uploadInvoice(mockReq({ userRole: 'member', file: { buffer: Buffer.from('x'), originalname: 'i.pdf', mimetype: 'application/pdf' } }), res);
    expect(res._status).toBe(403);
    expect(mockStorageUpload).not.toHaveBeenCalled();
  });

  it('listInvoices: member role is NOT gated — list stays open to any tenant member', async () => {
    mockFrom.mockReturnValue(makeChain({ data: [], error: null }));
    const res = mockRes();
    await listInvoices(mockReq({ userRole: 'member' }), res);
    expect(res._status).toBe(200);
  });

  it('getInvoice: member role is NOT gated — read stays open to any tenant member', async () => {
    mockFrom.mockReturnValue(makeChain({ data: { id: 'i1', tenant_id: TENANT_A }, error: null }));
    const res = mockRes();
    await getInvoice(mockReq({ userRole: 'member', params: { id: 'i1' } }), res);
    expect(res._status).toBe(200);
  });
});

describe('listInvoices', () => {
  it('filters by req.tenantId, ignoring any spoofed query tenant_id', async () => {
    const chain = makeChain({ data: [{ id: 'i1' }], error: null });
    mockFrom.mockReturnValue(chain);

    const res = mockRes();
    await listInvoices(mockReq({ query: { tenant_id: SPOOFED_TENANT_B } }), res);

    expect(chain.eq).toHaveBeenCalledWith('tenant_id', TENANT_A);
    expect(res._status).toBe(200);
    expect(res._body).toMatchObject({ invoices: [{ id: 'i1' }] });
  });
});

describe('getInvoice', () => {
  it('adds an id + tenant_id filter (previously only filtered by id)', async () => {
    const chain = makeChain({ data: { id: 'i1', tenant_id: TENANT_A }, error: null });
    mockFrom.mockReturnValue(chain);

    const res = mockRes();
    await getInvoice(mockReq({ params: { id: 'i1' }, headers: { 'x-tenant-id': SPOOFED_TENANT_B } }), res);

    expect(chain.eq).toHaveBeenCalledWith('id', 'i1');
    expect(chain.eq).toHaveBeenCalledWith('tenant_id', TENANT_A);
    expect(res._status).toBe(200);
  });

  it('404s when not found (e.g. belongs to another tenant)', async () => {
    mockFrom.mockReturnValue(makeChain({ data: null, error: { message: 'no rows' } }));
    const res = mockRes();
    await getInvoice(mockReq({ params: { id: 'i1' } }), res);
    expect(res._status).toBe(404);
  });
});

describe('createInvoice', () => {
  it('stamps tenant_id from req.tenantId, ignoring any spoofed body tenant_id', async () => {
    const chain = makeChain({ data: { id: 'i1' }, error: null });
    mockFrom.mockReturnValue(chain);

    const res = mockRes();
    await createInvoice(mockReq({ body: { tenant_id: SPOOFED_TENANT_B, line_items: [{ total: 10 }] } }), res);

    expect(chain.insert).toHaveBeenCalledWith(expect.objectContaining({ tenant_id: TENANT_A }));
    expect(res._status).toBe(201);
  });
});

describe('createInvoice — stock deduction (2026-08-20 quote/invoice-stock semantics)', () => {
  it('deducts stock for a product_id line item on an outbound invoice', async () => {
    mockFrom.mockReturnValue(makeChain({ data: { id: 'i1', direction: 'outbound', lead_id: null }, error: null }));
    mockRpc.mockResolvedValue({
      data: { product: { name: 'Basmati Rice 20kg' }, movement: { balance_after: 40 } },
      error: null,
    });

    const res = mockRes();
    await createInvoice(mockReq({
      body: { direction: 'outbound', line_items: [{ product_id: 'prod-1', qty: 10, total: 100, description: 'Rice' }] },
    }), res);

    expect(mockRpc).toHaveBeenCalledWith('adjust_product_stock', expect.objectContaining({
      p_tenant_id: TENANT_A,
      p_product_id: 'prod-1',
      p_delta: -10,
      p_reason: 'sale',
      p_allow_negative: true,
      p_created_by: 'user-1',
    }));
    expect(res._status).toBe(201);
    expect(res._body.stock_backorder).toBe(false);
    expect(res._body.stock_warnings).toEqual([]);
  });

  it('does not touch stock for a freeform line item with no product_id', async () => {
    mockFrom.mockReturnValue(makeChain({ data: { id: 'i1', direction: 'outbound', lead_id: null }, error: null }));

    const res = mockRes();
    await createInvoice(mockReq({
      body: { direction: 'outbound', line_items: [{ description: 'Custom embroidery job', qty: 1, total: 50 }] },
    }), res);

    expect(mockRpc).not.toHaveBeenCalled();
    expect(res._status).toBe(201);
  });

  it('does not touch stock on an inbound (vendor) invoice even if a line item has product_id', async () => {
    mockFrom.mockReturnValue(makeChain({ data: { id: 'i1', direction: 'inbound', lead_id: null }, error: null }));

    const res = mockRes();
    await createInvoice(mockReq({
      body: { direction: 'inbound', line_items: [{ product_id: 'prod-1', qty: 10, total: 100 }] },
    }), res);

    expect(mockRpc).not.toHaveBeenCalled();
    expect(res._status).toBe(201);
  });

  it('escalates out_of_stock when a deduction takes a product to/below zero and the invoice has a lead_id', async () => {
    mockFrom.mockImplementation((table) => {
      if (table === 'invoices') return makeChain({ data: { id: 'i1', direction: 'outbound', lead_id: 'lead-1' }, error: null });
      if (table === 'tenants') return makeChain({ data: { owner_email: 'owner@test.com' }, error: null });
      throw new Error(`unexpected table ${table}`);
    });
    mockRpc.mockResolvedValue({
      data: { product: { name: 'Basmati Rice 20kg' }, movement: { balance_after: -3 } },
      error: null,
    });

    const res = mockRes();
    await createInvoice(mockReq({
      body: { direction: 'outbound', line_items: [{ product_id: 'prod-1', qty: 10, total: 100 }] },
    }), res);

    expect(res._body.stock_backorder).toBe(true);
    expect(mockCreateAndNotifyEscalation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ tenantId: TENANT_A, leadId: 'lead-1', reason: 'out_of_stock' })
    );
  });

  it('does not escalate a backorder when the invoice has no lead_id (createAndNotifyEscalation requires one)', async () => {
    mockFrom.mockReturnValue(makeChain({ data: { id: 'i1', direction: 'outbound', lead_id: null }, error: null }));
    mockRpc.mockResolvedValue({
      data: { product: { name: 'Basmati Rice 20kg' }, movement: { balance_after: -3 } },
      error: null,
    });

    const res = mockRes();
    await createInvoice(mockReq({
      body: { direction: 'outbound', line_items: [{ product_id: 'prod-1', qty: 10, total: 100 }] },
    }), res);

    expect(res._body.stock_backorder).toBe(true);
    expect(mockCreateAndNotifyEscalation).not.toHaveBeenCalled();
  });

  it('treats a deduction RPC error as non-fatal — invoice still succeeds, error surfaces in stock_warnings', async () => {
    mockFrom.mockReturnValue(makeChain({ data: { id: 'i1', direction: 'outbound', lead_id: null }, error: null }));
    mockRpc.mockResolvedValue({ data: null, error: { message: 'product prod-1 not found for tenant tenant-uuid-1' } });

    const res = mockRes();
    await createInvoice(mockReq({
      body: { direction: 'outbound', line_items: [{ product_id: 'prod-1', qty: 10, total: 100 }] },
    }), res);

    expect(res._status).toBe(201);
    expect(res._body.stock_warnings).toEqual([
      expect.objectContaining({ product_id: 'prod-1', error: expect.stringContaining('not found') }),
    ]);
  });
});

describe('convertQuoteToInvoice', () => {
  it('scopes the quote fetch and duplicate-check by req.tenantId', async () => {
    const quoteChain = makeChain({ data: { id: 'q1', line_items: [], tenant_id: TENANT_A }, error: null });
    const dupChain = makeChain({ data: null, error: null });
    const insertChain = makeChain({ data: { id: 'inv1', lead_id: null }, error: null });

    let invoicesCallCount = 0;
    mockFrom.mockImplementation((table) => {
      if (table === 'quotes') return quoteChain;
      if (table === 'invoices') return invoicesCallCount++ === 0 ? dupChain : insertChain;
      throw new Error(`unexpected table ${table}`);
    });

    const res = mockRes();
    await convertQuoteToInvoice(mockReq({ params: { quoteId: 'q1' }, body: {}, headers: { 'x-tenant-id': SPOOFED_TENANT_B } }), res);

    expect(quoteChain.eq).toHaveBeenCalledWith('id', 'q1');
    expect(quoteChain.eq).toHaveBeenCalledWith('tenant_id', TENANT_A);
    expect(dupChain.eq).toHaveBeenCalledWith('quote_id', 'q1');
    expect(dupChain.eq).toHaveBeenCalledWith('tenant_id', TENANT_A);
    expect(res._status).toBe(201);
  });

  it('404s when the quote does not exist for this tenant', async () => {
    mockFrom.mockReturnValue(makeChain({ data: null, error: { message: 'no rows' } }));
    const res = mockRes();
    await convertQuoteToInvoice(mockReq({ params: { quoteId: 'q1' }, body: {} }), res);
    expect(res._status).toBe(404);
  });

  it('carries product_id through from the quote line item and deducts stock', async () => {
    const quoteChain = makeChain({
      data: { id: 'q1', tenant_id: TENANT_A, lead_id: 'lead-1', line_items: [{ name: 'Rice', quantity: 5, unit_price: 10, total: 50, product_id: 'prod-1' }] },
      error: null,
    });
    const dupChain = makeChain({ data: null, error: null });
    const insertChain = makeChain({ data: { id: 'inv1', lead_id: 'lead-1' }, error: null });

    let invoicesCallCount = 0;
    mockFrom.mockImplementation((table) => {
      if (table === 'quotes') return quoteChain;
      if (table === 'invoices') return invoicesCallCount++ === 0 ? dupChain : insertChain;
      if (table === 'lead_activities') return makeChain({ data: null, error: null });
      throw new Error(`unexpected table ${table}`);
    });
    mockRpc.mockResolvedValue({ data: { product: { name: 'Rice' }, movement: { balance_after: 40 } }, error: null });

    const res = mockRes();
    await convertQuoteToInvoice(mockReq({ params: { quoteId: 'q1' }, body: {} }), res);

    expect(mockRpc).toHaveBeenCalledWith('adjust_product_stock', expect.objectContaining({
      p_product_id: 'prod-1',
      p_delta: -5,
    }));
    expect(res._status).toBe(201);
  });

  // Regression test for a live bug found during the 2026-08-23 pre-launch
  // dry-run: quotes/new's real LineItem shape uses `qty`/`amount` (not
  // `quantity`/`total`, which the test above uses and which no real quote
  // ever actually produces), and quotes.tax_rate is stored as a fraction
  // (0.2 = 20%) while invoices.tax_rate is stored as a whole percentage
  // (20 = 20%). Both mismatches together silently zeroed out every
  // quote->invoice conversion's subtotal/tax/total. This test uses the real
  // shapes so a regression here fails loudly instead of silently.
  it('correctly computes subtotal/tax/total from a real quote line-item shape (qty/amount) and quote-vs-invoice tax_rate units', async () => {
    const quoteChain = makeChain({
      data: {
        id: 'q1',
        tenant_id: TENANT_A,
        lead_id: null,
        tax_rate: 0.2, // fraction, as quotes.tax_rate is actually stored
        line_items: [
          { description: 'Cotton fabric rolls', qty: 1, amount: 450, unit_price: 450, product_id: null },
        ],
      },
      error: null,
    });
    const dupChain = makeChain({ data: null, error: null });
    let insertedPayload = null;
    const insertChain = {
      insert: vi.fn((payload) => { insertedPayload = payload; return insertChain; }),
      select: vi.fn(() => insertChain),
      single: vi.fn(() => Promise.resolve({ data: { id: 'inv1', lead_id: null, ...insertedPayload }, error: null })),
      eq: vi.fn(() => insertChain),
    };

    let invoicesCallCount = 0;
    mockFrom.mockImplementation((table) => {
      if (table === 'quotes') return quoteChain;
      if (table === 'invoices') return invoicesCallCount++ === 0 ? dupChain : insertChain;
      throw new Error(`unexpected table ${table}`);
    });

    const res = mockRes();
    await convertQuoteToInvoice(mockReq({ params: { quoteId: 'q1' }, body: {} }), res);

    expect(insertedPayload).toEqual(expect.objectContaining({
      subtotal: 450,
      tax_rate: 20, // converted from the quote's 0.2 fraction to invoices' percentage convention
      tax_amount: 90,
      total_amount: 540,
    }));
    expect(insertedPayload.line_items[0]).toEqual(expect.objectContaining({ qty: 1, unit_price: 450, total: 450 }));
    expect(res._status).toBe(201);
  });
});

describe('updateInvoice', () => {
  it('adds an id + tenant_id filter, ignoring any spoofed body tenant_id', async () => {
    const chain = makeChain({ data: { id: 'i1', status: 'paid' }, error: null });
    mockFrom.mockReturnValue(chain);

    const res = mockRes();
    await updateInvoice(mockReq({ params: { id: 'i1' }, body: { status: 'paid', tenant_id: SPOOFED_TENANT_B } }), res);

    expect(chain.eq).toHaveBeenCalledWith('id', 'i1');
    expect(chain.eq).toHaveBeenCalledWith('tenant_id', TENANT_A);
    expect(res._status).toBe(200);
  });
});

describe('cancelInvoice', () => {
  it('adds an id + tenant_id filter', async () => {
    const chain = makeChain({ data: { id: 'i1', status: 'cancelled' }, error: null });
    mockFrom.mockReturnValue(chain);

    const res = mockRes();
    await cancelInvoice(mockReq({ params: { id: 'i1' }, headers: { 'x-tenant-id': SPOOFED_TENANT_B } }), res);

    expect(chain.eq).toHaveBeenCalledWith('id', 'i1');
    expect(chain.eq).toHaveBeenCalledWith('tenant_id', TENANT_A);
    expect(res._status).toBe(200);
  });
});

describe('downloadInvoicePdf', () => {
  it('adds an id + tenant_id filter on the invoice fetch', async () => {
    const invoiceChain = makeChain({ data: { id: 'i1', tenant_id: TENANT_A, invoice_number: 'INV-0001' }, error: null });
    const brandChain = makeChain({ data: { company_name: 'Acme' }, error: null });

    mockFrom.mockImplementation((table) => {
      if (table === 'invoices') return invoiceChain;
      if (table === 'brand_dna') return brandChain;
      throw new Error(`unexpected table ${table}`);
    });

    const res = mockRes();
    await downloadInvoicePdf(mockReq({ params: { id: 'i1' }, headers: { 'x-tenant-id': SPOOFED_TENANT_B } }), res);

    expect(invoiceChain.eq).toHaveBeenCalledWith('id', 'i1');
    expect(invoiceChain.eq).toHaveBeenCalledWith('tenant_id', TENANT_A);
    expect(res._headers['Content-Type']).toBe('application/pdf');
  });

  it('404s when not found (e.g. belongs to another tenant)', async () => {
    mockFrom.mockReturnValue(makeChain({ data: null, error: { message: 'no rows' } }));
    const res = mockRes();
    await downloadInvoicePdf(mockReq({ params: { id: 'i1' } }), res);
    expect(res._status).toBe(404);
  });
});

describe('uploadInvoice', () => {
  it('uses req.tenantId for the storage path and the insert, ignoring any spoofed body tenant_id', async () => {
    mockStorageUpload.mockResolvedValue({ data: { path: 'x' }, error: null });
    const chain = makeChain({ data: { id: 'i1' }, error: null });
    mockFrom.mockReturnValue(chain);

    const res = mockRes();
    await uploadInvoice(mockReq({
      body: { tenant_id: SPOOFED_TENANT_B },
      file: { buffer: Buffer.from('fake pdf'), originalname: 'invoice.pdf', mimetype: 'application/pdf' },
    }), res);

    const [storagePath] = mockStorageUpload.mock.calls[0];
    expect(storagePath.startsWith(`${TENANT_A}/`)).toBe(true);
    expect(chain.insert).toHaveBeenCalledWith(expect.objectContaining({ tenant_id: TENANT_A }));
    expect(res._status).toBe(201);
  });

  it('returns 400 when no file is uploaded', async () => {
    const res = mockRes();
    await uploadInvoice(mockReq({ file: undefined }), res);
    expect(res._status).toBe(400);
    expect(mockStorageUpload).not.toHaveBeenCalled();
  });
});
