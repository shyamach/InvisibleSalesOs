/**
 * lib/catalogue.js — Pure catalogue domain logic.
 *
 * Zod schemas + stock arithmetic, dependency-free so they unit-test cleanly.
 * The Supabase glue lives in controllers/products.js.
 */
import { z } from 'zod';

export const PRODUCT_STATUSES = ['active', 'archived', 'out_of_stock'];
export const STOCK_REASONS = ['manual_adjustment', 'sale', 'restock', 'correction', 'import', 'return'];

// ─── Schemas ──────────────────────────────────────────────────────────────────

export const productSchema = z.object({
  name: z.string().trim().min(1, 'name is required').max(200),
  sku: z.string().trim().max(64).optional(),
  description: z.string().trim().max(2000).optional(),
  category: z.string().trim().max(100).optional(),
  price: z.coerce.number().min(0, 'price cannot be negative').default(0),
  currency: z.string().trim().length(3).toUpperCase().default('GBP'),
  stock_quantity: z.coerce.number().int('stock must be a whole number').min(0).default(0),
  unit: z.string().trim().max(20).default('unit'),
  status: z.enum(PRODUCT_STATUSES).default('active'),
});

// All fields optional for PATCH; still rejects unknown/invalid values.
// stock_quantity and status are deliberately excluded and rejected (not
// silently stripped) — they must only change via the adjust_product_stock()
// RPC (POST /api/products/:id/stock), which keeps stock_movements and
// products.stock_quantity/status in sync. Letting a generic PATCH touch
// either field would silently desync the ledger from the live balance,
// which is exactly what Block 0.2's atomic stock-update RPC exists to
// prevent — found in database/security review, fixed before commit.
export const productUpdateSchema = productSchema.omit({ stock_quantity: true, status: true }).partial().strict();

export const stockAdjustmentSchema = z.object({
  delta: z.coerce.number().int('delta must be a whole number').refine((n) => n !== 0, 'delta must be non-zero'),
  reason: z.enum(STOCK_REASONS).default('manual_adjustment'),
  note: z.string().trim().max(500).optional(),
  allow_negative: z.boolean().optional().default(false),
});

/**
 * Validate a payload against a schema, returning a flat result.
 * @param {import('zod').ZodTypeAny} schema
 * @param {unknown} payload
 */
export function validate(schema, payload) {
  const r = schema.safeParse(payload);
  if (r.success) return { ok: true, data: r.data };
  return { ok: false, issues: r.error.issues.map((i) => ({ field: i.path.join('.') || '(root)', message: i.message })) };
}

// ─── Stock arithmetic ───────────────────────────────────────────────────────────

/**
 * Compute the new balance for a signed stock delta.
 * Refuses to drive stock negative unless explicitly allowed.
 *
 * @param {Object} args
 * @param {number} args.current
 * @param {number} args.delta
 * @param {boolean} [args.allowNegative]
 * @returns {{ ok: true, balance_after: number } | { ok: false, error: string, balance_after?: number }}
 */
export function computeStockChange({ current, delta, allowNegative = false } = {}) {
  const cur = Number(current);
  const d = Number(delta);

  if (!Number.isInteger(cur)) return { ok: false, error: 'current stock must be an integer' };
  if (!Number.isInteger(d)) return { ok: false, error: 'delta must be an integer' };
  if (d === 0) return { ok: false, error: 'delta must be non-zero' };

  const balance_after = cur + d;
  if (balance_after < 0 && !allowNegative) {
    return { ok: false, error: `insufficient stock: ${cur} on hand, cannot apply ${d}`, balance_after };
  }
  return { ok: true, balance_after };
}

/**
 * Derive the product status implied by a stock level.
 * (Only flips between active/out_of_stock; never touches an archived product.)
 * @param {number} balance
 * @param {string} currentStatus
 * @returns {string}
 */
export function deriveStatusFromStock(balance, currentStatus = 'active') {
  if (currentStatus === 'archived') return 'archived';
  return balance <= 0 ? 'out_of_stock' : 'active';
}
