/**
 * tests/tenants.test.js
 * Vitest tests for controllers/tenants.js
 *
 * Covers:
 *   - getTenantStatus: returns completion_pct as number
 *   - getTenantStatus: 404 when tenant not found
 *   - getTenantStatus: step flags match DB state
 *
 * registerTenant's tests were removed 2026-08-18 alongside the controller
 * itself (Phase B item B3) — see controllers/tenants.js's header comment.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Supabase mock ────────────────────────────────────────────────────────────
// We mock the module before importing the controller.

let _mockChain = {};

vi.mock('../lib/supabase.js', () => {
  const buildChain = () => {
    const chain = {
      _table: '',
      _data: null,
      _error: null,
      _single: false,
      from(table) { this._table = table; return this; },
      select() { return this; },
      insert(data) { this._inserted = data; return this; },
      eq() { return this; },
      maybeSingle() {
        return Promise.resolve({ data: this._data, error: this._error });
      },
      single() {
        return Promise.resolve({ data: this._data, error: this._error });
      },
    };
    return chain;
  };

  return {
    supabase: new Proxy({}, {
      get(_, prop) {
        if (prop === 'from') {
          return (table) => {
            // Return whatever _mockChain has been configured for this call
            return _mockChain[table] || buildChain();
          };
        }
        return () => {};
      },
    }),
  };
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function mockRes() {
  const res = {
    _status: 200,
    _body: null,
    status(code) { this._status = code; return this; },
    json(body) { this._body = body; return this; },
  };
  return res;
}

// Build a supabase chain that returns specific data/error
function makeChain({ data = null, error = null } = {}) {
  return {
    _data: data,
    _error: error,
    from(table) { this._table = table; return this; },
    select() { return this; },
    insert(d) { this._inserted = d; return this; },
    eq() { return this; },
    maybeSingle() { return Promise.resolve({ data: this._data, error: this._error }); },
    single() { return Promise.resolve({ data: this._data, error: this._error }); },
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('getTenantStatus', () => {
  beforeEach(() => {
    _mockChain = {};
    vi.resetModules();
  });

  it('returns completion_pct as a number between 0 and 100', async () => {
    const tenant = { id: 'uuid-1', name: 'Test Co', subscription_tier: 'trial' };

    // Set up mocks per table
    let tenantCalls = 0;
    let brandCalls = 0;
    let waCalls = 0;

    _mockChain = {
      tenants: {
        from() { return this; },
        select() { return this; },
        eq() { return this; },
        maybeSingle() {
          return Promise.resolve({ data: tenant, error: null });
        },
      },
      brand_dna: {
        from() { return this; },
        select() { return this; },
        eq() { return this; },
        maybeSingle() {
          return Promise.resolve({ data: null, error: null }); // not complete
        },
      },
      whatsapp_sessions: {
        from() { return this; },
        select() { return this; },
        eq() { return this; },
        maybeSingle() {
          return Promise.resolve({ data: null, error: null }); // not connected
        },
      },
    };

    const { getTenantStatus } = await import('../controllers/tenants.js');
    const req = { params: { id: 'uuid-1' } };
    const res = mockRes();

    await getTenantStatus(req, res);

    expect(res._status).toBe(200);
    expect(res._body.success).toBe(true);
    expect(typeof res._body.completion_pct).toBe('number');
    expect(res._body.completion_pct).toBeGreaterThanOrEqual(0);
    expect(res._body.completion_pct).toBeLessThanOrEqual(100);
  });

  it('returns 33 completion_pct when only registered (brand_dna + whatsapp incomplete)', async () => {
    const tenant = { id: 'uuid-2', name: 'Solo Co', subscription_tier: 'trial' };

    _mockChain = {
      tenants: {
        from() { return this; },
        select() { return this; },
        eq() { return this; },
        maybeSingle() { return Promise.resolve({ data: tenant, error: null }); },
      },
      brand_dna: {
        from() { return this; },
        select() { return this; },
        eq() { return this; },
        maybeSingle() { return Promise.resolve({ data: null, error: null }); },
      },
      whatsapp_sessions: {
        from() { return this; },
        select() { return this; },
        eq() { return this; },
        maybeSingle() { return Promise.resolve({ data: null, error: null }); },
      },
    };

    const { getTenantStatus } = await import('../controllers/tenants.js');
    const req = { params: { id: 'uuid-2' } };
    const res = mockRes();

    await getTenantStatus(req, res);

    // 1/3 steps complete → 33%
    expect(res._body.completion_pct).toBe(33);
    expect(res._body.steps.registered).toBe(true);
    expect(res._body.steps.brand_dna_complete).toBe(false);
    expect(res._body.steps.whatsapp_connected).toBe(false);
  });

  it('returns 100 completion_pct when all steps complete', async () => {
    const tenant = { id: 'uuid-3', name: 'Full Co', subscription_tier: 'trial' };

    _mockChain = {
      tenants: {
        from() { return this; },
        select() { return this; },
        eq() { return this; },
        maybeSingle() { return Promise.resolve({ data: tenant, error: null }); },
      },
      brand_dna: {
        from() { return this; },
        select() { return this; },
        eq() { return this; },
        maybeSingle() { return Promise.resolve({ data: { id: 'bd-1' }, error: null }); },
      },
      whatsapp_sessions: {
        from() { return this; },
        select() { return this; },
        eq() { return this; },
        maybeSingle() { return Promise.resolve({ data: { status: 'ready' }, error: null }); },
      },
    };

    const { getTenantStatus } = await import('../controllers/tenants.js');
    const req = { params: { id: 'uuid-3' } };
    const res = mockRes();

    await getTenantStatus(req, res);

    expect(res._body.completion_pct).toBe(100);
    expect(res._body.steps.registered).toBe(true);
    expect(res._body.steps.brand_dna_complete).toBe(true);
    expect(res._body.steps.whatsapp_connected).toBe(true);
  });

  it('returns 404 when tenant is not found', async () => {
    _mockChain = {
      tenants: {
        from() { return this; },
        select() { return this; },
        eq() { return this; },
        maybeSingle() { return Promise.resolve({ data: null, error: null }); },
      },
    };

    const { getTenantStatus } = await import('../controllers/tenants.js');
    const req = { params: { id: 'nonexistent-uuid' } };
    const res = mockRes();

    await getTenantStatus(req, res);

    expect(res._status).toBe(404);
    expect(res._body.success).toBe(false);
    expect(res._body.error).toMatch(/not found/i);
  });

  it('returns 400 when tenant id is missing', async () => {
    const { getTenantStatus } = await import('../controllers/tenants.js');
    const req = { params: {} };
    const res = mockRes();

    await getTenantStatus(req, res);

    expect(res._status).toBe(400);
    expect(res._body.success).toBe(false);
  });
});
