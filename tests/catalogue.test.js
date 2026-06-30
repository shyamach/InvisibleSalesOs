/**
 * tests/catalogue.test.js
 * Rule #1 coverage for catalogue domain logic + the parts of the products
 * controller that contain real logic (create validation, stock adjustment).
 * Supabase is mocked for the controller tests.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  productSchema,
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

// ─── Controller logic (mocked Supabase) ─────────────────────────────────────────

const mockFrom = vi.hoisted(() => vi.fn());
vi.mock('../lib/supabase.js', () => ({ supabase: { from: mockFrom } }));

import { createProduct, adjustStock } from '../controllers/products.js';

function mockRes() {
  return {
    _status: 200,
    _body: null,
    status(c) { this._status = c; return this; },
    json(b) { this._body = b; return this; },
  };
}

beforeEach(() => vi.clearAllMocks());

describe('createProduct', () => {
  it('returns 400 on invalid body without hitting the DB', async () => {
    const res = mockRes();
    await createProduct({ headers: {}, body: { price: 5 } }, res); // missing name
    expect(res._status).toBe(400);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('inserts and returns 201 on a valid product', async () => {
    const single = vi.fn().mockResolvedValue({ data: { id: 'p1', name: 'Rice' }, error: null });
    const select = vi.fn(() => ({ single }));
    const insert = vi.fn(() => ({ select }));
    mockFrom.mockReturnValue({ insert });

    const res = mockRes();
    await createProduct({ headers: {}, body: { name: 'Rice', price: 9.99 } }, res);

    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ name: 'Rice', tenant_id: expect.any(String) }));
    expect(res._status).toBe(201);
    expect(res._body).toMatchObject({ success: true, product: { id: 'p1' } });
  });

  it('maps a unique-violation to 409', async () => {
    const single = vi.fn().mockResolvedValue({ data: null, error: { code: '23505', message: 'dup' } });
    mockFrom.mockReturnValue({ insert: () => ({ select: () => ({ single }) }) });

    const res = mockRes();
    await createProduct({ headers: {}, body: { name: 'Rice', sku: 'DUP' } }, res);
    expect(res._status).toBe(409);
  });
});

describe('adjustStock', () => {
  // Helper: products fetch → product row; products update → updated row; movement insert → row
  function wireSupabase({ product, updated, movement }) {
    mockFrom.mockImplementation((table) => {
      if (table === 'products') {
        return {
          // fetch chain: select().eq().eq().is().maybeSingle()
          select: () => ({
            eq: () => ({
              eq: () => ({
                is: () => ({ maybeSingle: vi.fn().mockResolvedValue({ data: product, error: null }) }),
              }),
            }),
          }),
          // update chain: update().eq().eq().select().single()
          update: () => ({
            eq: () => ({ eq: () => ({ select: () => ({ single: vi.fn().mockResolvedValue({ data: updated, error: null }) }) }) }),
          }),
        };
      }
      // stock_movements insert().select().single()
      return { insert: () => ({ select: () => ({ single: vi.fn().mockResolvedValue({ data: movement, error: null }) }) }) };
    });
  }

  it('applies a positive delta, updates stock + records a movement', async () => {
    wireSupabase({
      product: { id: 'p1', stock_quantity: 10, status: 'active' },
      updated: { id: 'p1', stock_quantity: 15, status: 'active' },
      movement: { id: 'm1', delta: 5, balance_after: 15 },
    });
    const res = mockRes();
    await adjustStock({ headers: {}, params: { id: 'p1' }, body: { delta: 5, reason: 'restock' } }, res);
    expect(res._status).toBe(200);
    expect(res._body).toMatchObject({ success: true, product: { stock_quantity: 15 }, movement: { id: 'm1' } });
  });

  it('blocks an oversell with 400 and does not update', async () => {
    const updateSpy = vi.fn();
    mockFrom.mockImplementation((table) => {
      if (table === 'products') {
        return {
          select: () => ({ eq: () => ({ eq: () => ({ is: () => ({ maybeSingle: vi.fn().mockResolvedValue({ data: { id: 'p1', stock_quantity: 2, status: 'active' }, error: null }) }) }) }) }),
          update: updateSpy,
        };
      }
      return {};
    });
    const res = mockRes();
    await adjustStock({ headers: {}, params: { id: 'p1' }, body: { delta: -5 } }, res);
    expect(res._status).toBe(400);
    expect(res._body.error).toMatch(/insufficient stock/);
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it('returns 404 when the product does not exist', async () => {
    mockFrom.mockImplementation(() => ({
      select: () => ({ eq: () => ({ eq: () => ({ is: () => ({ maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }) }) }) }) }),
    }));
    const res = mockRes();
    await adjustStock({ headers: {}, params: { id: 'nope' }, body: { delta: 1 } }, res);
    expect(res._status).toBe(404);
  });
});
