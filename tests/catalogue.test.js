/**
 * tests/catalogue.test.js
 * Rule #1 coverage for catalogue domain logic + the parts of the products
 * controller that contain real logic (create validation, stock adjustment).
 * Supabase is mocked for the controller tests.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  productSchema,
  productUpdateSchema,
  stockAdjustmentSchema,
  validate,
  computeStockChange,
  deriveStatusFromStock,
} from '../lib/catalogue.js';

// ─── Pure domain logic ──────────────────────────────────────────────────────────

describe('productSchema', () => {
  it('accepts a minimal valid product and applies defaults', () => {
    const v = validate(productSchema, { name: 'Basmati Rice 20kg' });
    expect(v.ok).toBe(true);
    expect(v.data).toMatchObject({ price: 0, currency: 'GBP', stock_quantity: 0, unit: 'unit', status: 'active' });
  });

  it('coerces numeric strings and uppercases currency', () => {
    const v = validate(productSchema, { name: 'X', price: '12.50', stock_quantity: '40', currency: 'gbp' });
    expect(v.ok).toBe(true);
    expect(v.data.price).toBe(12.5);
    expect(v.data.stock_quantity).toBe(40);
    expect(v.data.currency).toBe('GBP');
  });

  it('rejects missing name, negative price, and non-integer stock', () => {
    expect(validate(productSchema, { price: 5 }).ok).toBe(false);
    expect(validate(productSchema, { name: 'X', price: -1 }).ok).toBe(false);
    expect(validate(productSchema, { name: 'X', stock_quantity: 1.5 }).ok).toBe(false);
  });
});

describe('productUpdateSchema', () => {
  it('rejects stock_quantity — stock must go through POST /api/products/:id/stock', () => {
    const v = validate(productUpdateSchema, { stock_quantity: 50 });
    expect(v.ok).toBe(false);
    expect(v.issues.some((i) => i.message.toLowerCase().includes('stock_quantity'))).toBe(true);
  });

  it('rejects status — status must be derived by adjust_product_stock(), not set directly', () => {
    const v = validate(productUpdateSchema, { status: 'archived' });
    expect(v.ok).toBe(false);
    expect(v.issues.some((i) => i.message.toLowerCase().includes('status'))).toBe(true);
  });

  it('rejects a mix of an allowed field and stock_quantity in the same payload', () => {
    const v = validate(productUpdateSchema, { name: 'Renamed', stock_quantity: 12 });
    expect(v.ok).toBe(false);
  });

  it('accepts normal metadata fields with no stock_quantity/status present', () => {
    const v = validate(productUpdateSchema, { name: 'Renamed Rice', price: 6.5, category: 'Grains' });
    expect(v.ok).toBe(true);
    expect(v.data).toEqual({ name: 'Renamed Rice', price: 6.5, category: 'Grains' });
  });

  it('accepts an empty payload (all fields optional)', () => {
    expect(validate(productUpdateSchema, {}).ok).toBe(true);
  });
});

describe('stockAdjustmentSchema', () => {
  it('requires a non-zero integer delta and defaults reason', () => {
    const v = validate(stockAdjustmentSchema, { delta: -3 });
    expect(v.ok).toBe(true);
    expect(v.data.reason).toBe('manual_adjustment');
  });
  it('rejects a zero delta and an invalid reason', () => {
    expect(validate(stockAdjustmentSchema, { delta: 0 }).ok).toBe(false);
    expect(validate(stockAdjustmentSchema, { delta: 1, reason: 'magic' }).ok).toBe(false);
  });
});

describe('computeStockChange', () => {
  it('adds and subtracts correctly', () => {
    expect(computeStockChange({ current: 10, delta: 5 })).toEqual({ ok: true, balance_after: 15 });
    expect(computeStockChange({ current: 10, delta: -4 })).toEqual({ ok: true, balance_after: 6 });
  });
  it('blocks driving stock negative unless allowed', () => {
    const blocked = computeStockChange({ current: 3, delta: -5 });
    expect(blocked.ok).toBe(false);
    expect(blocked.balance_after).toBe(-2);
    const allowed = computeStockChange({ current: 3, delta: -5, allowNegative: true });
    expect(allowed).toEqual({ ok: true, balance_after: -2 });
  });
  it('rejects zero / non-integer deltas', () => {
    expect(computeStockChange({ current: 1, delta: 0 }).ok).toBe(false);
    expect(computeStockChange({ current: 1, delta: 1.5 }).ok).toBe(false);
  });
});

describe('deriveStatusFromStock', () => {
  it('flips active ↔ out_of_stock by balance', () => {
    expect(deriveStatusFromStock(0, 'active')).toBe('out_of_stock');
    expect(deriveStatusFromStock(5, 'out_of_stock')).toBe('active');
  });
  it('never disturbs an archived product', () => {
    expect(deriveStatusFromStock(0, 'archived')).toBe('archived');
  });
});

// ─── Controller logic (mocked req.supabase) ─────────────────────────────────────
// Tenant identity now comes from req.tenantId (set by requireAuth from a
// verified JWT — see lib/authMiddleware.js) and queries run on req.supabase
// (the per-request client), not the shared lib/supabase.js client. Tests
// build a mock req directly instead of module-mocking lib/supabase.js.

import { createProduct, updateProduct, adjustStock, listProducts, getProduct, deleteProduct, listStockMovements } from '../controllers/products.js';

const mockFrom = vi.hoisted(() => vi.fn());
const mockRpc = vi.hoisted(() => vi.fn());

const TENANT_A = 'tenant-uuid-1';
const SPOOFED_TENANT_B = 'tenant-uuid-spoofed';

function mockRes() {
  return {
    _status: 200,
    _body: null,
    status(c) { this._status = c; return this; },
    json(b) { this._body = b; return this; },
  };
}

// Builds a request carrying a mock req.supabase — mirrors what requireAuth
// attaches on a real request. `tenantId` defaults to TENANT_A; pass
// `tenantId: null` to exercise the no-tenant guard.
function mockReq(overrides = {}) {
  return {
    tenantId: TENANT_A,
    supabase: { from: mockFrom, rpc: mockRpc },
    headers: {},
    query: {},
    ...overrides,
  };
}

beforeEach(() => vi.clearAllMocks());

describe('tenant guard — applies across all product handlers', () => {
  it('listProducts returns 403 and never touches the DB when req.tenantId is null', async () => {
    const res = mockRes();
    await listProducts(mockReq({ tenantId: null }), res);
    expect(res._status).toBe(403);
    expect(res._body).toMatchObject({ success: false });
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('adjustStock returns 403 and never calls the RPC when req.tenantId is null', async () => {
    const res = mockRes();
    await adjustStock(mockReq({ tenantId: null, params: { id: 'p1' }, body: { delta: 1 } }), res);
    expect(res._status).toBe(403);
    expect(mockRpc).not.toHaveBeenCalled();
  });
});

describe('listProducts', () => {
  it('filters by req.tenantId, ignoring any x-tenant-id header', async () => {
    const order = vi.fn().mockResolvedValue({ data: [{ id: 'p1' }], error: null });
    const is = vi.fn(() => ({ order }));
    const eq = vi.fn(() => ({ is }));
    const select = vi.fn(() => ({ eq }));
    mockFrom.mockReturnValue({ select });

    const res = mockRes();
    await listProducts(mockReq({ headers: { 'x-tenant-id': SPOOFED_TENANT_B } }), res);

    expect(eq).toHaveBeenCalledWith('tenant_id', TENANT_A);
    expect(res._status).toBe(200);
    expect(res._body).toMatchObject({ success: true, products: [{ id: 'p1' }] });
  });

  it('applies an ilike .or() filter on name/sku when ?search= is passed', async () => {
    const or = vi.fn().mockResolvedValue({ data: [{ id: 'p1', name: 'Basmati Rice' }], error: null });
    const order = vi.fn(() => ({ or }));
    const is = vi.fn(() => ({ order }));
    const eq = vi.fn(() => ({ is }));
    const select = vi.fn(() => ({ eq }));
    mockFrom.mockReturnValue({ select });

    const res = mockRes();
    await listProducts(mockReq({ query: { search: 'rice' } }), res);

    expect(or).toHaveBeenCalledWith('name.ilike.%rice%,sku.ilike.%rice%');
    expect(res._body).toMatchObject({ success: true, products: [{ id: 'p1', name: 'Basmati Rice' }] });
  });

  it('strips %/, from the search term before building the ilike filter', async () => {
    const or = vi.fn().mockResolvedValue({ data: [], error: null });
    const order = vi.fn(() => ({ or }));
    const is = vi.fn(() => ({ order }));
    const eq = vi.fn(() => ({ is }));
    const select = vi.fn(() => ({ eq }));
    mockFrom.mockReturnValue({ select });

    const res = mockRes();
    await listProducts(mockReq({ query: { search: '%evil%,injection' } }), res);

    expect(or).toHaveBeenCalledWith('name.ilike.%evil  injection%,sku.ilike.%evil  injection%');
  });

  it('applies .limit() only when ?limit= is passed, capped at 500', async () => {
    const limit = vi.fn().mockResolvedValue({ data: [], error: null });
    const order = vi.fn(() => ({ limit }));
    const is = vi.fn(() => ({ order }));
    const eq = vi.fn(() => ({ is }));
    const select = vi.fn(() => ({ eq }));
    mockFrom.mockReturnValue({ select });

    const res = mockRes();
    await listProducts(mockReq({ query: { limit: '9999' } }), res);

    expect(limit).toHaveBeenCalledWith(500);
    expect(res._status).toBe(200);
  });
});

describe('getProduct', () => {
  it('filters by req.tenantId and returns 404 when not found', async () => {
    const maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
    const is = vi.fn(() => ({ maybeSingle }));
    const eq2 = vi.fn(() => ({ is }));
    const eq1 = vi.fn(() => ({ eq: eq2 }));
    const select = vi.fn(() => ({ eq: eq1 }));
    mockFrom.mockReturnValue({ select });

    const res = mockRes();
    await getProduct(mockReq({ params: { id: 'nope' } }), res);

    expect(eq1).toHaveBeenCalledWith('tenant_id', TENANT_A);
    expect(res._status).toBe(404);
  });
});

describe('deleteProduct', () => {
  it('soft-deletes scoped by req.tenantId', async () => {
    const maybeSingle = vi.fn().mockResolvedValue({ data: { id: 'p1' }, error: null });
    const select = vi.fn(() => ({ maybeSingle }));
    const is = vi.fn(() => ({ select }));
    const eq2 = vi.fn(() => ({ is }));
    const eq1 = vi.fn(() => ({ eq: eq2 }));
    const update = vi.fn(() => ({ eq: eq1 }));
    mockFrom.mockReturnValue({ update });

    const res = mockRes();
    await deleteProduct(mockReq({ params: { id: 'p1' } }), res);

    expect(eq1).toHaveBeenCalledWith('tenant_id', TENANT_A);
    expect(res._status).toBe(200);
    expect(res._body).toMatchObject({ success: true, deleted: 'p1' });
  });
});

describe('listStockMovements', () => {
  it('filters by req.tenantId, ignoring any x-tenant-id header', async () => {
    const limit = vi.fn().mockResolvedValue({ data: [{ id: 'm1' }], error: null });
    const order = vi.fn(() => ({ limit }));
    const eq2 = vi.fn(() => ({ order }));
    const eq1 = vi.fn(() => ({ eq: eq2 }));
    const select = vi.fn(() => ({ eq: eq1 }));
    mockFrom.mockReturnValue({ select });

    const res = mockRes();
    await listStockMovements(mockReq({ params: { id: 'p1' }, headers: { 'x-tenant-id': SPOOFED_TENANT_B } }), res);

    expect(eq1).toHaveBeenCalledWith('tenant_id', TENANT_A);
    expect(res._status).toBe(200);
    expect(res._body).toMatchObject({ success: true, movements: [{ id: 'm1' }] });
  });
});

describe('createProduct', () => {
  it('returns 400 on invalid body without hitting the DB', async () => {
    const res = mockRes();
    await createProduct(mockReq({ body: { price: 5 } }), res); // missing name
    expect(res._status).toBe(400);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('inserts and returns 201 on a valid product, stamping tenant_id from req.tenantId', async () => {
    const single = vi.fn().mockResolvedValue({ data: { id: 'p1', name: 'Rice' }, error: null });
    const select = vi.fn(() => ({ single }));
    const insert = vi.fn(() => ({ select }));
    mockFrom.mockReturnValue({ insert });

    const res = mockRes();
    await createProduct(mockReq({ body: { name: 'Rice', price: 9.99 } }), res);

    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ name: 'Rice', tenant_id: TENANT_A }));
    expect(res._status).toBe(201);
    expect(res._body).toMatchObject({ success: true, product: { id: 'p1' } });
  });

  it('a spoofed x-tenant-id header never reaches the insert — tenant_id always comes from req.tenantId', async () => {
    const single = vi.fn().mockResolvedValue({ data: { id: 'p1', name: 'Rice' }, error: null });
    const select = vi.fn(() => ({ single }));
    const insert = vi.fn(() => ({ select }));
    mockFrom.mockReturnValue({ insert });

    const res = mockRes();
    await createProduct(mockReq({ body: { name: 'Rice' }, headers: { 'x-tenant-id': SPOOFED_TENANT_B } }), res);

    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ tenant_id: TENANT_A }));
  });

  it('maps a unique-violation to 409', async () => {
    const single = vi.fn().mockResolvedValue({ data: null, error: { code: '23505', message: 'dup' } });
    mockFrom.mockReturnValue({ insert: () => ({ select: () => ({ single }) }) });

    const res = mockRes();
    await createProduct(mockReq({ body: { name: 'Rice', sku: 'DUP' } }), res);
    expect(res._status).toBe(409);
  });
});

describe('updateProduct', () => {
  // Regression coverage for the database/security review finding: a generic
  // PATCH must not be able to move stock_quantity or status outside of
  // adjust_product_stock() — see productUpdateSchema in lib/catalogue.js.
  // Untouched by the Block 1.1b tenant-identity change.

  it('rejects a body containing stock_quantity with 400, without touching the DB', async () => {
    const res = mockRes();
    await updateProduct(mockReq({ params: { id: 'p1' }, body: { stock_quantity: 50 } }), res);
    expect(res._status).toBe(400);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('rejects a body containing status with 400, without touching the DB', async () => {
    const res = mockRes();
    await updateProduct(mockReq({ params: { id: 'p1' }, body: { status: 'archived' } }), res);
    expect(res._status).toBe(400);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('allows normal metadata fields through and updates only those, scoped by req.tenantId', async () => {
    const maybeSingle = vi.fn().mockResolvedValue({ data: { id: 'p1', name: 'Renamed Rice', price: 6.5 }, error: null });
    const select = vi.fn(() => ({ maybeSingle }));
    const eq2 = vi.fn(() => ({ is: () => ({ select }) }));
    const eq1 = vi.fn(() => ({ eq: eq2 }));
    const update = vi.fn(() => ({ eq: eq1 }));
    mockFrom.mockReturnValue({ update });

    const res = mockRes();
    await updateProduct(mockReq({ params: { id: 'p1' }, body: { name: 'Renamed Rice', price: 6.5 } }), res);

    expect(update).toHaveBeenCalledWith({ name: 'Renamed Rice', price: 6.5 });
    expect(eq1).toHaveBeenCalledWith('tenant_id', TENANT_A);
    expect(res._status).toBe(200);
    expect(res._body).toMatchObject({ success: true, product: { name: 'Renamed Rice' } });
  });
});

describe('adjustStock', () => {
  // adjustStock now delegates the read-check-write entirely to the
  // adjust_product_stock() RPC (supabase/migrations/
  // phase2_atomic_stock_movement_rpc.sql) — no more separate fetch/update/
  // insert calls to mock, just the single rpc() call and its {product,
  // movement} jsonb payload or a PostgREST-shaped error.

  it('applies a positive delta, updates stock + records a movement, using req.tenantId', async () => {
    mockRpc.mockResolvedValue({
      data: {
        product: { id: 'p1', stock_quantity: 15, status: 'active' },
        movement: { id: 'm1', delta: 5, balance_after: 15 },
      },
      error: null,
    });

    const res = mockRes();
    await adjustStock(mockReq({ params: { id: 'p1' }, body: { delta: 5, reason: 'restock' } }), res);

    expect(mockRpc).toHaveBeenCalledWith('adjust_product_stock', {
      p_tenant_id: TENANT_A,
      p_product_id: 'p1',
      p_delta: 5,
      p_reason: 'restock',
      p_note: null,
      p_allow_negative: false,
    });
    expect(res._status).toBe(200);
    expect(res._body).toMatchObject({ success: true, product: { stock_quantity: 15 }, movement: { id: 'm1' } });
  });

  it('a spoofed x-tenant-id header never reaches the RPC — p_tenant_id always comes from req.tenantId', async () => {
    mockRpc.mockResolvedValue({
      data: { product: { id: 'p1' }, movement: { id: 'm1' } },
      error: null,
    });

    const res = mockRes();
    await adjustStock(mockReq({ params: { id: 'p1' }, body: { delta: 5 }, headers: { 'x-tenant-id': SPOOFED_TENANT_B } }), res);

    expect(mockRpc).toHaveBeenCalledWith('adjust_product_stock', expect.objectContaining({ p_tenant_id: TENANT_A }));
  });

  it('blocks an oversell with 400 and does not update', async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { code: 'ISTOK', message: 'insufficient stock: 2 on hand, cannot apply -5' },
    });

    const res = mockRes();
    await adjustStock(mockReq({ params: { id: 'p1' }, body: { delta: -5 } }), res);
    expect(res._status).toBe(400);
    expect(res._body.error).toMatch(/insufficient stock/);
  });

  it('returns 404 when the product does not exist', async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { code: 'P0002', message: 'product nope not found for tenant ...' },
    });

    const res = mockRes();
    await adjustStock(mockReq({ params: { id: 'nope' }, body: { delta: 1 } }), res);
    expect(res._status).toBe(404);
  });

  it('returns 500 on an unrecognised RPC error', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { code: '08006', message: 'connection failure' } });

    const res = mockRes();
    await adjustStock(mockReq({ params: { id: 'p1' }, body: { delta: 1 } }), res);
    expect(res._status).toBe(500);
    expect(res._body.error).toBe('connection failure');
  });
});
