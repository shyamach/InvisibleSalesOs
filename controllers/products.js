/**
 * controllers/products.js — Catalogue CRUD + stock ledger.
 *
 * Routes (all behind requireInternalKey in server.js):
 *   GET    /api/products              — list active products
 *   GET    /api/products/:id          — fetch one
 *   POST   /api/products              — create
 *   PATCH  /api/products/:id          — update
 *   DELETE /api/products/:id          — soft delete
 *   POST   /api/products/:id/stock    — adjust stock (records a stock_movement)
 *   GET    /api/products/:id/movements — stock history
 *
 * Domain logic (validation + stock maths) lives in lib/catalogue.js.
 */
import { supabase } from '../lib/supabase.js';
import {
  productSchema,
  productUpdateSchema,
  stockAdjustmentSchema,
  validate,
} from '../lib/catalogue.js';

const DEFAULT_TENANT_ID = process.env.DEFAULT_TENANT_ID || '00000000-0000-0000-0000-000000000001';
const tenantOf = (req) => req.headers['x-tenant-id'] || DEFAULT_TENANT_ID;

// ─── List ─────────────────────────────────────────────────────────────────────
export async function listProducts(req, res) {
  const { data, error } = await supabase
    .from('products')
    .select('*')
    .eq('tenant_id', tenantOf(req))
    .is('deleted_at', null)
    .order('name', { ascending: true });

  if (error) return res.status(500).json({ success: false, error: error.message });
  return res.json({ success: true, products: data });
}

// ─── Get one ─────────────────────────────────────────────────────────────────
export async function getProduct(req, res) {
  const { data, error } = await supabase
    .from('products')
    .select('*')
    .eq('tenant_id', tenantOf(req))
    .eq('id', req.params.id)
    .is('deleted_at', null)
    .maybeSingle();

  if (error) return res.status(500).json({ success: false, error: error.message });
  if (!data) return res.status(404).json({ success: false, error: 'Product not found' });
  return res.json({ success: true, product: data });
}

// ─── Create ─────────────────────────────────────────────────────────────────────
export async function createProduct(req, res) {
  const v = validate(productSchema, req.body);
  if (!v.ok) return res.status(400).json({ success: false, error: 'Validation failed', issues: v.issues });

  const { data, error } = await supabase
    .from('products')
    .insert({ ...v.data, tenant_id: tenantOf(req) })
    .select('*')
    .single();

  if (error) {
    // 23505 = unique violation (duplicate SKU for tenant)
    if (error.code === '23505') return res.status(409).json({ success: false, error: 'A product with this SKU already exists' });
    return res.status(500).json({ success: false, error: error.message });
  }
  return res.status(201).json({ success: true, product: data });
}

// ─── Update ─────────────────────────────────────────────────────────────────────
export async function updateProduct(req, res) {
  const v = validate(productUpdateSchema, req.body);
  if (!v.ok) return res.status(400).json({ success: false, error: 'Validation failed', issues: v.issues });
  if (Object.keys(v.data).length === 0) return res.status(400).json({ success: false, error: 'No fields to update' });

  const { data, error } = await supabase
    .from('products')
    .update(v.data)
    .eq('tenant_id', tenantOf(req))
    .eq('id', req.params.id)
    .is('deleted_at', null)
    .select('*')
    .maybeSingle();

  if (error) return res.status(500).json({ success: false, error: error.message });
  if (!data) return res.status(404).json({ success: false, error: 'Product not found' });
  return res.json({ success: true, product: data });
}

// ─── Soft delete ──────────────────────────────────────────────────────────────
export async function deleteProduct(req, res) {
  const { data, error } = await supabase
    .from('products')
    .update({ deleted_at: new Date().toISOString() })
    .eq('tenant_id', tenantOf(req))
    .eq('id', req.params.id)
    .is('deleted_at', null)
    .select('id')
    .maybeSingle();

  if (error) return res.status(500).json({ success: false, error: error.message });
  if (!data) return res.status(404).json({ success: false, error: 'Product not found' });
  return res.json({ success: true, deleted: data.id });
}

// ─── Adjust stock (records a movement) ─────────────────────────────────────────
// The row lock, balance computation, product update, and ledger insert all
// happen atomically inside the adjust_product_stock() Postgres function —
// see supabase/migrations/phase2_atomic_stock_movement_rpc.sql. This
// controller no longer computes or applies balance_after itself.
export async function adjustStock(req, res) {
  const tenantId = tenantOf(req);
  const v = validate(stockAdjustmentSchema, req.body);
  if (!v.ok) return res.status(400).json({ success: false, error: 'Validation failed', issues: v.issues });

  const { data, error } = await supabase.rpc('adjust_product_stock', {
    p_tenant_id: tenantId,
    p_product_id: req.params.id,
    p_delta: v.data.delta,
    p_reason: v.data.reason,
    p_note: v.data.note || null,
    p_allow_negative: v.data.allow_negative,
  });

  if (error) {
    if (error.code === 'P0002') return res.status(404).json({ success: false, error: 'Product not found' });
    if (error.code === 'ISTOK') return res.status(400).json({ success: false, error: error.message });
    return res.status(500).json({ success: false, error: error.message });
  }

  return res.json({ success: true, product: data.product, movement: data.movement });
}

// ─── Stock history ──────────────────────────────────────────────────────────────
export async function listStockMovements(req, res) {
  const { data, error } = await supabase
    .from('stock_movements')
    .select('*')
    .eq('tenant_id', tenantOf(req))
    .eq('product_id', req.params.id)
    .order('created_at', { ascending: false })
    .limit(200);

  if (error) return res.status(500).json({ success: false, error: error.message });
  return res.json({ success: true, movements: data });
}
