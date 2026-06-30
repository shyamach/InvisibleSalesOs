/**
 * lib/escalation.js — Sales-rep handoff domain logic (pure, testable).
 *
 * Decides WHEN a lead needs a human rep (out-of-stock or price negotiation),
 * enforces the outcome state machine, and aggregates per-rep attribution.
 * No I/O — the controller + engine supply data and persist results.
 */

export const ESCALATION_REASONS = ['out_of_stock', 'price_negotiation', 'manual', 'other'];
export const ESCALATION_STATUSES = ['pending', 'accepted', 'converted', 'rejected', 'stalled'];
export const TERMINAL_STATUSES = ['converted', 'rejected'];

// Allowed outcome transitions (current → permitted next states).
const TRANSITIONS = {
  pending: ['accepted', 'converted', 'rejected', 'stalled'],
  accepted: ['converted', 'rejected', 'stalled'],
  stalled: ['accepted', 'converted', 'rejected'],
  converted: [], // terminal
  rejected: [], // terminal
};

const PRICE_SIGNALS = [
  'discount', 'negotiat', 'best price', 'cheaper', 'lower price', 'price match',
  'bulk price', 'wholesale price', 'too expensive', 'reduce price', 'better price',
  'beat the price', 'special offer', 'haggl',
];

export function isTerminal(status) {
  return TERMINAL_STATUSES.includes(status);
}

/**
 * Validate an outcome transition.
 * @param {string} current
 * @param {string} next
 * @returns {{ ok: true } | { ok: false, error: string }}
 */
export function validateOutcomeTransition(current, next) {
  if (!ESCALATION_STATUSES.includes(next)) return { ok: false, error: `invalid status "${next}"` };
  if (current === next) return { ok: false, error: `already ${current}` };
  const allowed = TRANSITIONS[current] ?? [];
  if (!allowed.includes(next)) return { ok: false, error: `cannot move from ${current} to ${next}` };
  return { ok: true };
}

/**
 * Decide whether a lead should be escalated to a rep.
 *
 * @param {Object} args
 * @param {Object} [args.profile]          — structured lead profile (query/product_interest)
 * @param {Array<Object>} [args.catalogueMatches] — products matched to the enquiry
 * @returns {{ escalate: boolean, reason?: string, context?: string }}
 */
export function detectEscalation({ profile = {}, catalogueMatches = [] } = {}) {
  const text = `${profile.query || ''} ${profile.product_interest || ''}`.toLowerCase();

  // 1. Price negotiation — a human should own the discount conversation.
  if (text && PRICE_SIGNALS.some((sig) => text.includes(sig))) {
    return { escalate: true, reason: 'price_negotiation', context: 'Customer is negotiating on price' };
  }

  // 2. Out of stock — only when the enquiry matched products and none are available.
  if (Array.isArray(catalogueMatches) && catalogueMatches.length > 0) {
    const oos = catalogueMatches.filter((p) => Number(p.stock_quantity) <= 0);
    const inStock = catalogueMatches.filter((p) => Number(p.stock_quantity) > 0);
    if (oos.length > 0 && inStock.length === 0) {
      const names = oos.map((p) => p.name).filter(Boolean).join(', ');
      return { escalate: true, reason: 'out_of_stock', context: names ? `${names} out of stock` : 'Requested item out of stock' };
    }
  }

  return { escalate: false };
}

/**
 * Aggregate escalations into per-rep attribution.
 * @param {Array<Object>} escalations
 * @returns {Array<{ rep: string, total: number, converted: number, conversion_rate: number, value: number, by_status: Object }>}
 */
export function summarizeAttribution(escalations = []) {
  const byRep = new Map();

  for (const e of escalations) {
    const rep = e.assigned_to_name || 'Unassigned';
    if (!byRep.has(rep)) {
      byRep.set(rep, { rep, total: 0, converted: 0, value: 0, by_status: {} });
    }
    const row = byRep.get(rep);
    row.total += 1;
    row.by_status[e.status] = (row.by_status[e.status] || 0) + 1;
    if (e.status === 'converted') {
      row.converted += 1;
      row.value += Number(e.deal_value) || 0;
    }
  }

  return Array.from(byRep.values())
    .map((r) => ({ ...r, conversion_rate: r.total ? Math.round((r.converted / r.total) * 100) : 0 }))
    .sort((a, b) => b.value - a.value || b.converted - a.converted);
}
