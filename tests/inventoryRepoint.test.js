/**
 * tests/inventoryRepoint.test.js
 * Verifies checkLiveInventory now reads the canonical `products` table
 * (legacy `inventory` retired) and maps to the legacy return shape.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockFrom = vi.hoisted(() => vi.fn());
vi.mock('../lib/supabase.js', () => ({ supabase: { from: mockFrom } }));

import { checkLiveInventory } from '../db.js';

beforeEach(() => vi.clearAllMocks());

function wire(result) {
  const maybeSingle = vi.fn().mockResolvedValue(result);
  const limit = vi.fn(() => ({ maybeSingle }));
  const ilike = vi.fn(() => ({ limit }));
  const is = vi.fn(() => ({ ilike }));
  const select = vi.fn(() => ({ is }));
  mockFrom.mockReturnValue({ select });
  return { select, is, ilike };
}

describe('checkLiveInventory (repointed to products)', () => {
  it('queries the products table and maps to the legacy shape', async () => {
    const { select } = wire({ data: { name: 'Basmati Rice 20kg', price: 24.5, stock_quantity: 40, status: 'active' }, error: null });

    const result = await checkLiveInventory('basmati');

    expect(mockFrom).toHaveBeenCalledWith('products');
    expect(select).toHaveBeenCalledWith('name, price, stock_quantity, status');
    expect(result).toEqual({ product_name: 'Basmati Rice 20kg', price: 24.5, stock_count: 40, status: 'active' });
  });

  it('returns null when nothing matches', async () => {
    wire({ data: null, error: null });
    expect(await checkLiveInventory('nope')).toBeNull();
  });

  it('returns null on error', async () => {
    wire({ data: null, error: { message: 'boom' } });
    expect(await checkLiveInventory('x')).toBeNull();
  });
});
