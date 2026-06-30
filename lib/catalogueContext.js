/**
 * lib/catalogueContext.js — Inject live catalogue context into AI generation.
 *
 * Phase 1 uses lightweight keyword matching against the manually-imported
 * catalogue (pgvector semantic match is a Phase 2 upgrade — same interface).
 * Given a lead's enquiry text, finds the most relevant products and formats
 * their REAL price/stock so the writer can answer with accurate availability
 * instead of hallucinating.
 *
 * Pure matching/formatting (testable) + a thin Supabase fetch helper.
 */

const STOPWORDS = new Set(['the', 'a', 'an', 'of', 'for', 'and', 'to', 'in', 'on', 'with', 'some', 'need', 'want', 'buy', 'order', 'looking', 'interested', 'please', 'you', 'your', 'we', 'i', 'is', 'are']);

function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 2 && !STOPWORDS.has(t));
}

/**
 * Rank products by keyword overlap with the enquiry text.
 * @param {string} query
 * @param {Array<Object>} products
 * @param {Object} [opts]
 * @param {number} [opts.limit]
 * @returns {Array<Object>} best-matching product rows (highest score first)
 */
export function matchProducts(query, products, { limit = 3 } = {}) {
  const terms = tokenize(query);
  if (terms.length === 0 || !Array.isArray(products)) return [];

  const scored = products
    .map((p) => {
      const hay = tokenize([p.name, p.category, p.description].filter(Boolean).join(' '));
      const haySet = new Set(hay);
      let score = 0;
      for (const t of terms) {
        if (haySet.has(t)) score += 2; // exact token hit
        else if (hay.some((h) => h.includes(t) || t.includes(h))) score += 1; // partial
      }
      return { product: p, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  return scored.map((s) => s.product);
}

/**
 * Format matched products as a grounded context block for the writer prompt.
 * Returns null when there is nothing to inject.
 * @param {Array<Object>} matches
 * @returns {string|null}
 */
export function formatCatalogueContext(matches) {
  if (!Array.isArray(matches) || matches.length === 0) return null;

  const lines = matches.map((p) => {
    const unit = p.unit || 'unit';
    const price = `${p.currency || 'GBP'} ${Number(p.price || 0).toFixed(2)}`;
    const stock =
      Number(p.stock_quantity) > 0 ? `${p.stock_quantity} ${unit}(s) in stock` : 'OUT OF STOCK';
    const sku = p.sku ? ` (SKU ${p.sku})` : '';
    return `- ${p.name}${sku}: ${price} per ${unit} — ${stock}`;
  });

  return (
    'Relevant catalogue items — use ONLY this real pricing/stock data; ' +
    'never invent products, prices, or availability. If an item is OUT OF STOCK, ' +
    'do not promise it:\n' +
    lines.join('\n')
  );
}

/**
 * Fetch the tenant's catalogue and return matched context for an enquiry.
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string} tenantId
 * @param {string} query
 * @param {Object} [opts]
 * @param {number} [opts.limit]
 * @returns {Promise<{ matches: Array<Object>, context: string|null }>}
 */
export async function getCatalogueContext(supabase, tenantId, query, { limit = 3 } = {}) {
  if (!tenantId || !query) return { matches: [], context: null };

  const { data, error } = await supabase
    .from('products')
    .select('name, sku, description, category, price, currency, stock_quantity, unit, status')
    .eq('tenant_id', tenantId)
    .is('deleted_at', null)
    .limit(200);

  if (error) {
    console.warn('⚠️ [CatalogueContext]: product fetch failed —', error.message);
    return { matches: [], context: null };
  }

  const matches = matchProducts(query, data || [], { limit });
  return { matches, context: formatCatalogueContext(matches) };
}
