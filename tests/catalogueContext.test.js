/**
 * tests/catalogueContext.test.js
 * Rule #1 coverage for AI catalogue context injection.
 */
import { describe, it, expect, vi } from 'vitest';
import { matchProducts, formatCatalogueContext, getCatalogueContext } from '../lib/catalogueContext.js';

const CATALOGUE = [
  { name: 'Basmati Rice 20kg', sku: 'RICE-20', category: 'grains', price: 24.5, currency: 'GBP', stock_quantity: 40, unit: 'bag' },
  { name: 'Chickpeas 10kg', sku: 'CHK-10', category: 'pulses', price: 12, currency: 'GBP', stock_quantity: 0, unit: 'bag' },
  { name: 'Sunflower Oil 5L', sku: 'OIL-5', category: 'oils', price: 8.75, currency: 'GBP', stock_quantity: 120, unit: 'bottle' },
];

describe('matchProducts', () => {
  it('ranks the most relevant product first', () => {
    const m = matchProducts('do you have basmati rice in bulk?', CATALOGUE);
    expect(m[0].sku).toBe('RICE-20');
  });

  it('matches on category words too', () => {
    const m = matchProducts('looking for pulses', CATALOGUE);
    expect(m[0].sku).toBe('CHK-10');
  });

  it('returns empty when nothing matches or query is empty', () => {
    expect(matchProducts('quantum widgets', CATALOGUE)).toEqual([]);
    expect(matchProducts('', CATALOGUE)).toEqual([]);
    expect(matchProducts('rice', null)).toEqual([]);
  });

  it('respects the limit', () => {
    const m = matchProducts('rice chickpeas oil', CATALOGUE, { limit: 2 });
    expect(m.length).toBe(2);
  });
});

describe('formatCatalogueContext', () => {
  it('formats price + stock and flags out-of-stock', () => {
    const ctx = formatCatalogueContext([CATALOGUE[0], CATALOGUE[1]]);
    expect(ctx).toContain('Basmati Rice 20kg (SKU RICE-20): GBP 24.50 per bag — 40 bag(s) in stock');
    expect(ctx).toContain('Chickpeas 10kg (SKU CHK-10): GBP 12.00 per bag — OUT OF STOCK');
    expect(ctx).toMatch(/never invent products/i);
  });

  it('returns null when there are no matches', () => {
    expect(formatCatalogueContext([])).toBeNull();
    expect(formatCatalogueContext(null)).toBeNull();
  });
});

describe('getCatalogueContext', () => {
  function mockSupabase(rows, error = null) {
    return {
      from: () => ({
        select: () => ({
          eq: () => ({
            is: () => ({ limit: vi.fn().mockResolvedValue({ data: rows, error }) }),
          }),
        }),
      }),
    };
  }

  it('fetches, matches, and formats context', async () => {
    const r = await getCatalogueContext(mockSupabase(CATALOGUE), 'tenant-1', 'need basmati rice');
    expect(r.matches[0].sku).toBe('RICE-20');
    expect(r.context).toContain('Basmati Rice');
  });

  it('short-circuits with no tenant or no query', async () => {
    expect(await getCatalogueContext(mockSupabase(CATALOGUE), null, 'rice')).toEqual({ matches: [], context: null });
    expect(await getCatalogueContext(mockSupabase(CATALOGUE), 'tenant-1', '')).toEqual({ matches: [], context: null });
  });

  it('degrades gracefully on a DB error', async () => {
    const r = await getCatalogueContext(mockSupabase(null, { message: 'boom' }), 'tenant-1', 'rice');
    expect(r).toEqual({ matches: [], context: null });
  });
});
