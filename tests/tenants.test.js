/**
 * tests/tenants.test.js
 * Vitest tests for controllers/tenants.js
 *
 * Covers:
 *   - registerTenant: successful 201 response with tenant_id
 *   - registerTenant: missing fields returns 400
 *   - registerTenant: duplicate email returns 409
 *   - registerTenant: invalid email returns 400
 *   - getTenantStatus: returns completion_pct as number
 *   - getTenantStatus: 404 when tenant not found
 *   - getTenantStatus: step flags match DB state
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

describe('registerTenant', () => {
  beforeEach(() => {
    _mockChain = {};
    vi.resetModules();
  });

  it('returns 201 with tenant_id, slug, setup_token on success', async () => {
    // Mock: no duplicate exists (maybeSingle returns null data)
    // Mock: no slug conflict
    // Mock: insert returns a new tenant
    const newTenant = { id: 'uuid-1234', slug: 'ahmed-fabrics' };

    // Override supabase chain per table
    let callCount = 0;
    _mockChain = {
      tenants: {
        from() { return this; },
        select() { return this; },
        insert() { return this; },
        eq() { return this; },
        maybeSingle() {
          callCount++;
          // First 2 calls: duplicate + slug checks (return null = no match)
          if (callCount <= 2) return Promise.resolve({ data: null, error: null });
          return Promise.resolve({ data: newTenant, error: null });
        },
        single() {
          return Promise.resolve({ data: newTenant, error: null });
        },
      },
    };

    const { registerTenant } = await import('../controllers/tenants.js');
    const req = {
      body: {
        name: 'Ahmed Fabrics Ltd',
        owner_email: 'ahmed@test.com',
        whatsapp_number: '+447700000000',
      },
    };
    const res = mockRes();

    await registerTenant(req, res);

    expect(res._status).toBe(201);
    expect(res._body.success).toBe(true);
    expect(res._body).toHaveProperty('tenant_id');
    expect(res._body).toHaveProperty('slug');
    expect(res._body).toHaveProperty('setup_token');
  });

  it('returns 400 when required fields are missing', async () => {
    const { registerTenant } = await import('../controllers/tenants.js');
    const req = { body: { name: 'Acme', owner_email: '' } }; // missing whatsapp_number
    const res = mockRes();

    await registerTenant(req, res);

    expect(res._status).toBe(400);
    expect(res._body.success).toBe(false);
    expect(res._body.error).toMatch(/Missing required fields/);
  });

  it('returns 400 when email format is invalid', async () => {
    const { registerTenant } = await import('../controllers/tenants.js');
    const req = {
      body: {
        name: 'Acme',
        owner_email: 'not-an-email',
        whatsapp_number: '+447700000000',
      },
    };
    const res = mockRes();

    await registerTenant(req, res);

    expect(res._status).toBe(400);
    expect(res._body.error).toMatch(/Invalid email/i);
  });

  it('returns 409 when owner_email already exists', async () => {
    // Mock: duplicate check finds an existing tenant
    _mockChain = {
      tenants: {
        from() { return this; },
        select() { return this; },
        insert() { return this; },
        eq() { return this; },
        maybeSingle() {
          // First call = duplicate check — return existing tenant
          return Promise.resolve({ data: { id: 'existing-uuid' }, error: null });
        },
        single() {
          return Promise.resolve({ data: null, error: null });
        },
      },
    };

    const { registerTenant } = await import('../controllers/tenants.js');
    const req = {
      body: {
        name: 'Ahmed Fabrics',
        owner_email: 'existing@test.com',
        whatsapp_number: '+447700000000',
      },
    };
    const res = mockRes();

    await registerTenant(req, res);

    expect(res._status).toBe(409);
    expect(res._body.success).toBe(false);
    expect(res._body.error).toMatch(/already exists/i);
  });
});

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
