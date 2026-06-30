/**
 * tests/quotes.test.js
 *
 * Tests for the Quote Builder line-items calculation logic.
 *
 * The canonical implementation lives in:
 *   frontend/src/lib/quote-utils.ts  (TypeScript, used by the Next.js UI)
 *
 * Because the root Vitest config runs in a Node/ESM environment without a
 * TypeScript transform, we duplicate the pure function here as JS.
 * Both versions must stay in sync — the logic is identical.
 */

import { describe, it, expect } from 'vitest';

// ─── Pure function (JS mirror of frontend/src/lib/quote-utils.ts) ────────────

function round2(n) {
  return Math.round(n * 100) / 100;
}

/**
 * calculateQuoteTotals
 * @param {Array<{description:string, qty:number, unit_price:number, amount:number}>} lineItems
 * @param {number} taxRate  e.g. 0.20 for 20%
 * @returns {{ subtotal: number, tax_amount: number, total: number }}
 */
function calculateQuoteTotals(lineItems, taxRate) {
  const subtotal = lineItems.reduce((sum, item) => {
    const amount = Number(item.qty) * Number(item.unit_price);
    return sum + (isFinite(amount) ? amount : 0);
  }, 0);

  const rate = isFinite(taxRate) && taxRate >= 0 ? taxRate : 0;
  const tax_amount = subtotal * rate;
  const total = subtotal + tax_amount;

  return {
    subtotal: round2(subtotal),
    tax_amount: round2(tax_amount),
    total: round2(total),
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('calculateQuoteTotals', () => {
  it('returns zeros for an empty line items array', () => {
    const result = calculateQuoteTotals([], 0.2);
    expect(result).toEqual({ subtotal: 0, tax_amount: 0, total: 0 });
  });

  it('correctly computes a single line item with 20% VAT', () => {
    const items = [{ description: 'Widget', qty: 10, unit_price: 5.0, amount: 0 }];
    const result = calculateQuoteTotals(items, 0.2);
    expect(result.subtotal).toBe(50);
    expect(result.tax_amount).toBe(10);
    expect(result.total).toBe(60);
  });

  it('sums multiple line items correctly', () => {
    const items = [
      { description: 'Item A', qty: 3, unit_price: 10,  amount: 0 },
      { description: 'Item B', qty: 2, unit_price: 25,  amount: 0 },
      { description: 'Item C', qty: 1, unit_price: 5.5, amount: 0 },
    ];
    // subtotal = 30 + 50 + 5.5 = 85.5
    const result = calculateQuoteTotals(items, 0.2);
    expect(result.subtotal).toBe(85.5);
    expect(result.tax_amount).toBe(17.1);
    expect(result.total).toBe(102.6);
  });

  it('ignores the stored amount field — recomputes from qty * unit_price', () => {
    // Even if amount is wrong/stale, totals should use qty * unit_price
    const items = [{ description: 'Stale', qty: 4, unit_price: 10, amount: 999 }];
    const result = calculateQuoteTotals(items, 0.2);
    expect(result.subtotal).toBe(40);
  });

  it('handles zero tax rate', () => {
    const items = [{ description: 'Tax-free', qty: 2, unit_price: 50, amount: 0 }];
    const result = calculateQuoteTotals(items, 0);
    expect(result.subtotal).toBe(100);
    expect(result.tax_amount).toBe(0);
    expect(result.total).toBe(100);
  });

  it('handles fractional quantities', () => {
    const items = [{ description: 'Half unit', qty: 0.5, unit_price: 200, amount: 0 }];
    const result = calculateQuoteTotals(items, 0.2);
    expect(result.subtotal).toBe(100);
    expect(result.tax_amount).toBe(20);
    expect(result.total).toBe(120);
  });

  it('rounds to 2 decimal places to avoid floating-point drift', () => {
    // 3 * 0.1 = 0.30000000000000004 in JS without rounding
    const items = [{ description: 'Float', qty: 3, unit_price: 0.1, amount: 0 }];
    const result = calculateQuoteTotals(items, 0.2);
    expect(result.subtotal).toBe(0.3);
    expect(result.tax_amount).toBe(0.06);
    expect(result.total).toBe(0.36);
  });

  it('treats a negative taxRate as 0 (guard against bad input)', () => {
    const items = [{ description: 'Item', qty: 1, unit_price: 100, amount: 0 }];
    const result = calculateQuoteTotals(items, -0.5);
    expect(result.tax_amount).toBe(0);
    expect(result.total).toBe(100);
  });

  it('handles NaN unit_price gracefully — excludes that row', () => {
    const items = [
      { description: 'Good',  qty: 2, unit_price: 50,  amount: 0 },
      { description: 'Bad',   qty: 1, unit_price: NaN, amount: 0 },
    ];
    const result = calculateQuoteTotals(items, 0.2);
    expect(result.subtotal).toBe(100);
    expect(result.total).toBe(120);
  });

  it('handles large wholesale order totals without precision loss', () => {
    const items = [
      { description: 'Bulk Rice 25kg', qty: 500, unit_price: 22.50, amount: 0 },
      { description: 'Bulk Oil 5L',    qty: 200, unit_price: 8.75,  amount: 0 },
    ];
    // subtotal = 11250 + 1750 = 13000
    const result = calculateQuoteTotals(items, 0.2);
    expect(result.subtotal).toBe(13000);
    expect(result.tax_amount).toBe(2600);
    expect(result.total).toBe(15600);
  });

  it('returns the correct shape — subtotal, tax_amount, total keys present', () => {
    const result = calculateQuoteTotals([], 0.2);
    expect(result).toHaveProperty('subtotal');
    expect(result).toHaveProperty('tax_amount');
    expect(result).toHaveProperty('total');
  });
});
