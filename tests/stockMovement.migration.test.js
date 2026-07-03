/**
 * tests/stockMovement.migration.test.js
 *
 * Real-Postgres contract test for the adjust_product_stock() RPC
 * (supabase/migrations/phase2_atomic_stock_movement_rpc.sql — DRAFT, not yet
 * applied).
 *
 * WHY THIS FILE DOES NOT FOLLOW THE REPO'S USUAL MOCKED-SUPABASE PATTERN:
 * the entire point of this RPC is a row lock (SELECT ... FOR UPDATE) and an
 * atomic read-check-write inside a single Postgres function call. A mocked
 * client cannot exercise real transaction/locking semantics — these tests use
 * the REAL Supabase client (anon key, same as the app) on purpose, following
 * the same approach as tests/failedIngestions.migration.test.js.
 *
 * WHY THIS FILE IS SKIPPED BY DEFAULT:
 * - The migration has not been applied yet — the function doesn't exist.
 * - Even once applied, these tests make real network calls against the real
 *   Supabase project and should not run as part of every `npm test` / CI
 *   invocation.
 *
 * HOW TO RUN, MANUALLY, AFTER THE MIGRATION IS APPLIED:
 *   RUN_DB_INTEGRATION_TESTS=true npx vitest run tests/stockMovement.migration.test.js
 *
 * Test products are tagged with a distinct SKU prefix and DELETEd in
 * afterEach — products RLS grants tenant-scoped DELETE. `stock_movements.
 * product_id` is ON DELETE CASCADE (verified live via pg_constraint,
 * confdeltype='c'), so deleting the test product cascades and removes its
 * stock_movements rows too — no separate ledger cleanup is needed, and this
 * works even though `anon` has no DELETE policy on stock_movements itself:
 * FK cascade deletes are enforced by the constraint trigger, not subject to
 * the deleting role's RLS policies on the child table.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { createClient } from '@supabase/supabase-js';

const RUN_INTEGRATION = process.env.RUN_DB_INTEGRATION_TESTS === 'true';
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
const canRun = RUN_INTEGRATION && Boolean(supabaseUrl) && Boolean(supabaseAnonKey);

const maybeDescribe = canRun ? describe : describe.skip;
const anon = canRun ? createClient(supabaseUrl, supabaseAnonKey) : null;

const DEV_TENANT_ID = '00000000-0000-0000-0000-000000000001'; // verified to exist, 2026-07-02
// Does not need to be a real tenant row: the not-found path this exercises
// raises before any write, so no FK is ever checked against it.
const OTHER_TENANT_ID = '11111111-1111-1111-1111-111111111111';
const SKU_PREFIX = '__integration_test__adjust_stock__';

let createdProductIds = [];

async function makeProduct(overrides = {}) {
  const { data, error } = await anon
    .from('products')
    .insert({
      tenant_id: DEV_TENANT_ID,
      sku: `${SKU_PREFIX}${Date.now()}_${Math.random().toString(36).slice(2)}`,
      name: 'Integration Test Product',
      stock_quantity: 10,
      status: 'active',
      ...overrides,
    })
    .select('*')
    .single();
  if (error) throw error;
  createdProductIds.push(data.id);
  return data;
}

maybeDescribe('adjust_product_stock() — real Postgres RPC contract (run manually post-migration)', () => {
  afterEach(async () => {
    if (createdProductIds.length === 0) return;
    const ids = createdProductIds;
    createdProductIds = [];
    const { error } = await anon.from('products').delete().in('id', ids);
    if (error) throw error;
  });

  it('happy path: applies a positive delta and returns the updated product + movement', async () => {
    const product = await makeProduct({ stock_quantity: 10 });

    const { data, error } = await anon.rpc('adjust_product_stock', {
      p_tenant_id: DEV_TENANT_ID,
      p_product_id: product.id,
      p_delta: 5,
      p_reason: 'restock',
      p_note: null,
      p_allow_negative: false,
    });

    expect(error).toBeNull();
    expect(data.product.stock_quantity).toBe(15);
    expect(data.movement.delta).toBe(5);
    expect(data.movement.balance_after).toBe(15);

    const { data: row, error: readErr } = await anon
      .from('products')
      .select('stock_quantity')
      .eq('id', product.id)
      .single();
    expect(readErr).toBeNull();
    expect(row.stock_quantity).toBe(15);
  });

  it('blocks an oversell when allow_negative is false', async () => {
    const product = await makeProduct({ stock_quantity: 2 });

    const { data, error } = await anon.rpc('adjust_product_stock', {
      p_tenant_id: DEV_TENANT_ID,
      p_product_id: product.id,
      p_delta: -5,
      p_reason: 'sale',
      p_note: null,
      p_allow_negative: false,
    });

    expect(data).toBeNull();
    expect(error).not.toBeNull();
    expect(error.code).toBe('ISTOK');
    expect(error.message).toMatch(/insufficient stock/);

    const { data: row, error: readErr } = await anon
      .from('products')
      .select('stock_quantity')
      .eq('id', product.id)
      .single();
    expect(readErr).toBeNull();
    expect(row.stock_quantity).toBe(2); // unchanged
  });

  it('allows driving stock negative when allow_negative is true', async () => {
    const product = await makeProduct({ stock_quantity: 2 });

    const { data, error } = await anon.rpc('adjust_product_stock', {
      p_tenant_id: DEV_TENANT_ID,
      p_product_id: product.id,
      p_delta: -5,
      p_reason: 'correction',
      p_note: null,
      p_allow_negative: true,
    });

    expect(error).toBeNull();
    expect(data.product.stock_quantity).toBe(-3);
    expect(data.product.status).toBe('out_of_stock');
  });

  it('returns a not-found error for a nonexistent product', async () => {
    const { data, error } = await anon.rpc('adjust_product_stock', {
      p_tenant_id: DEV_TENANT_ID,
      p_product_id: '00000000-0000-0000-0000-000000000099',
      p_delta: 1,
      p_reason: 'manual_adjustment',
      p_note: null,
      p_allow_negative: false,
    });

    expect(data).toBeNull();
    expect(error).not.toBeNull();
    expect(error.code).toBe('P0002');
  });

  it('does not adjust a real product when called with a mismatched tenant_id', async () => {
    // Note: this asserts the function's own explicit tenant_id equality
    // check, not RLS-enforced tenant isolation — RLS still uses the
    // pre-auth-mapping `tenant_id = dev-fallback` fallback (Block 1 gap),
    // so RLS alone would not have blocked this row.
    const product = await makeProduct({ stock_quantity: 10 });

    const { data, error } = await anon.rpc('adjust_product_stock', {
      p_tenant_id: OTHER_TENANT_ID,
      p_product_id: product.id,
      p_delta: 5,
      p_reason: 'restock',
      p_note: null,
      p_allow_negative: false,
    });

    expect(data).toBeNull();
    expect(error).not.toBeNull();
    expect(error.code).toBe('P0002');

    const { data: row, error: readErr } = await anon
      .from('products')
      .select('stock_quantity')
      .eq('id', product.id)
      .single();
    expect(readErr).toBeNull();
    expect(row.stock_quantity).toBe(10); // unchanged
  });

  it('20 concurrent +1 adjustments on the same product all land — no lost updates', async () => {
    // Every call applies the same delta (+1) so the resulting set of
    // balance_after values is fully order-independent: no matter what order
    // Postgres serializes the 20 row-locked transactions in, a correct
    // implementation must produce exactly the 20 consecutive integers
    // base+1..base+20, each exactly once. A lost update (the pre-fix
    // read-then-write race) would instead produce duplicate and/or missing
    // values in that set and a final stock_quantity below base+20.
    const base = 100;
    const product = await makeProduct({ stock_quantity: base });
    const CONCURRENCY = 20;

    const results = await Promise.all(
      Array.from({ length: CONCURRENCY }, () =>
        anon.rpc('adjust_product_stock', {
          p_tenant_id: DEV_TENANT_ID,
          p_product_id: product.id,
          p_delta: 1,
          p_reason: 'restock',
          p_note: null,
          p_allow_negative: false,
        })
      )
    );

    const errors = results.filter((r) => r.error).map((r) => r.error.message);
    expect(errors).toEqual([]);

    const { data: row, error: readErr } = await anon
      .from('products')
      .select('stock_quantity')
      .eq('id', product.id)
      .single();
    expect(readErr).toBeNull();
    expect(row.stock_quantity).toBe(base + CONCURRENCY);

    const { data: movements, error: movementsErr } = await anon
      .from('stock_movements')
      .select('balance_after')
      .eq('product_id', product.id);

    expect(movementsErr).toBeNull();
    expect(movements).toHaveLength(CONCURRENCY);
    const balances = movements.map((m) => m.balance_after).sort((a, b) => a - b);
    const expected = Array.from({ length: CONCURRENCY }, (_, i) => base + i + 1);
    expect(balances).toEqual(expected);
  });
});

if (!canRun) {
  describe('adjust_product_stock() — real Postgres RPC contract', () => {
    it.skip('SKIPPED: set RUN_DB_INTEGRATION_TESTS=true after applying the migration to run these', () => {});
  });
}
