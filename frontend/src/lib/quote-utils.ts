/**
 * quote-utils.ts — Pure calculation helpers for the Quote Builder.
 * Extracted so they can be imported by both the UI and the test suite.
 */

export interface LineItem {
  description: string;
  qty: number;
  unit_price: number;
  amount: number;
}

export interface QuoteTotals {
  subtotal: number;
  tax_amount: number;
  total: number;
}

/**
 * calculateQuoteTotals
 * Derives subtotal, tax_amount, and total from an array of line items and a tax rate.
 *
 * @param lineItems  Array of line item objects. `amount` on each item is re-computed
 *                   as qty * unit_price so the function is the single source of truth.
 * @param taxRate    Decimal rate, e.g. 0.20 for 20 %.
 */
export function calculateQuoteTotals(
  lineItems: LineItem[],
  taxRate: number
): QuoteTotals {
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

/** Round to 2 decimal places (avoids floating-point drift in display). */
export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Auto-compute the `amount` field on a single line item. */
export function computeLineItemAmount(item: LineItem): LineItem {
  return { ...item, amount: round2(Number(item.qty) * Number(item.unit_price)) };
}

/** Generate a human-readable quote number from a UUID or timestamp. */
export function formatQuoteNumber(n: string | null | undefined): string {
  return n ?? "—";
}

/** Map a quote status to its Tailwind badge colour classes. */
export function statusBadgeClass(status: string): string {
  switch (status) {
    case "draft":
      return "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400";
    case "sent":
      return "bg-blue-50 text-blue-700 dark:bg-blue-950/30 dark:text-blue-400";
    case "accepted":
      return "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400";
    case "rejected":
      return "bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-400";
    case "expired":
      return "bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400";
    default:
      return "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400";
  }
}
