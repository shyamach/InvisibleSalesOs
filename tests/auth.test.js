/**
 * tests/auth.test.js
 * Vitest tests for lib/authMiddleware.js and controllers/auth.js
 *
 * Covers:
 *  1. requireAuth — no Authorization header → 401
 *  2. requireAuth — malformed header (no Bearer prefix) → 401
 *  3. requireAuth — invalid/expired token → 401
 *  4. requireAuth — DEV_BYPASS_AUTH=true → sets default tenant and calls next
 *  5. requireAuth — valid token, user has tenant → sets req.user + req.tenantId
 *  6. requireAuth — valid token, no tenant yet → req.tenantId null, still calls next
 *  7. requireAuth — supabase throws → 500
 *  8. getMe — returns user + tenant when both present
 *  9. getMe — tenant is null → returns onboarding_required
 * 10. getMe — DB error fetching tenant → 500
 * 11. registerWithAuth — creates tenant + user_tenants row → 201
 * 12. registerWithAuth — idempotent: already has tenant → 200 already_registered
 * 13. registerWithAuth — missing business_name → 400
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─── Supabase mock ───────────────────────────────────────────────────────────

// Mutable state for each test to configure
let _authGetUser = vi.fn();
let _fromCalls = {}; // table -> { data, error } per chained call sequence

vi.mock('../lib/supabase.js', () => {
  const buildChain = ({ data = null, error = null } = {}) => ({
    _data: data,
    _error: error,
    select() { return this; },
    insert(d) { this._inserted = d; return this; },
    eq() { return this; },
    single() { return Promise.resolve({ data: this._data, error: this._error }); },
    maybeSingle() { return Promise.resolve({ data: this._data, error: this._error }); },
  });

  return {
    supabase: {
      auth: {
        getUser: (...args) => _authGetUser(...args),
      },
      from(table) {
        // Return the mock chain registered for this table, or a default empty one
        const chain = _fromCalls[table];
        if (typeof chain === 'function') return chain();
        return buildChain(chain || {});
      },
    },
  };
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

function mockRes() {
  const res = {
    _status: 200,
    _body: null,
    status(code) { this._status = code; return this; },
    json(body) { this._body = body; return this; },
  };
  return res;
}

function mockNext() {
  const next = vi.fn();
  return next;
}

// ─── requireAuth tests ────────────────────────────────────────────────────────

describe('requireAuth', () => {
  let requireAuth;

  beforeEach(async () => {
    vi.resetModules();
    delete process.env.DEV_BYPASS_AUTH;
    _authGetUser = vi.fn();
    _fromCalls = {};
    ({ requireAuth } = await import('../lib/authMiddleware.js'));
  });

  afterEach(() => {
    delete process.env.DEV_BYPASS_AUTH;
  });

  it('1. returns 401 when no Authorization header is present', async () => {
    const req = { headers: {} };
    const res = mockRes();
    const next = mockNext();

    await requireAuth(req, res, next);

    expect(res._status).toBe(401);
    expect(res._body.success).toBe(false);
    expect(res._body.error).toMatch(/missing or invalid/i);
    expect(next).not.toHaveBeenCalled();
  });

  it('2. returns 401 when header exists but has no Bearer prefix', async () => {
    const req = { headers: { authorization: 'Token abc123' } };
    const res = mockRes();
    const next = mockNext();

    await requireAuth(req, res, next);

    expect(res._status).toBe(401);
    expect(res._body.success).toBe(false);
    expect(res._body.error).toMatch(/missing or invalid/i);
    expect(next).not.toHaveBeenCalled();
  });

  it('3. returns 401 when supabase rejects the token', async () => {
    _authGetUser.mockResolvedValue({
      data: { user: null },
      error: { message: 'JWT expired' },
    });

    const req = { headers: { authorization: 'Bearer bad.token.here' } };
    const res = mockRes();
    const next = mockNext();

    await requireAuth(req, res, next);

    expect(res._status).toBe(401);
    expect(res._body.success).toBe(false);
    expect(res._body.error).toMatch(/invalid or expired/i);
    expect(next).not.toHaveBeenCalled();
  });

  it('4. DEV_BYPASS_AUTH=true sets default tenant and calls next without touching supabase', async () => {
    process.env.DEV_BYPASS_AUTH = 'true';
    vi.resetModules();
    ({ requireAuth } = await import('../lib/authMiddleware.js'));

    const req = { headers: {} };
    const res = mockRes();
    const next = mockNext();

    await requireAuth(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(req.user).toEqual({ id: 'dev-user', email: 'dev@localhost' });
    expect(req.tenantId).toBeTruthy();
    expect(_authGetUser).not.toHaveBeenCalled();
  });

  it('5. valid token + existing tenant → sets req.user, req.tenantId, req.userRole and calls next', async () => {
    const fakeUser = { id: 'user-uuid-1', email: 'jane@example.com', user_metadata: {} };
    _authGetUser.mockResolvedValue({ data: { user: fakeUser }, error: null });

    _fromCalls['user_tenants'] = () => ({
      select() { return this; },
      eq() { return this; },
      single() {
        return Promise.resolve({ data: { tenant_id: 'tenant-uuid-1', role: 'owner' }, error: null });
      },
    });

    const req = { headers: { authorization: 'Bearer valid.jwt.token' } };
    const res = mockRes();
    const next = mockNext();

    await requireAuth(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(req.user).toEqual(fakeUser);
    expect(req.tenantId).toBe('tenant-uuid-1');
    expect(req.userRole).toBe('owner');
  });

  it('6. valid token but no user_tenants row → req.tenantId is null, still calls next', async () => {
    const fakeUser = { id: 'new-user-uuid', email: 'new@example.com', user_metadata: {} };
    _authGetUser.mockResolvedValue({ data: { user: fakeUser }, error: null });

    _fromCalls['user_tenants'] = () => ({
      select() { return this; },
      eq() { return this; },
      single() {
        return Promise.resolve({ data: null, error: { code: 'PGRST116', message: 'No rows' } });
      },
    });

    const req = { headers: { authorization: 'Bearer valid.jwt.token' } };
    const res = mockRes();
    const next = mockNext();

    await requireAuth(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(req.user).toEqual(fakeUser);
    expect(req.tenantId).toBeNull();
    expect(req.userRole).toBeNull();
  });

  it('7. supabase.auth.getUser throws → returns 500', async () => {
    _authGetUser.mockRejectedValue(new Error('Network failure'));

    const req = { headers: { authorization: 'Bearer some.token' } };
    const res = mockRes();
    const next = mockNext();

    await requireAuth(req, res, next);

    expect(res._status).toBe(500);
    expect(res._body.success).toBe(false);
    expect(res._body.error).toMatch(/auth service error/i);
    expect(next).not.toHaveBeenCalled();
  });
});

// ─── getMe tests ──────────────────────────────────────────────────────────────

describe('getMe', () => {
  let getMe;

  beforeEach(async () => {
    vi.resetModules();
    _fromCalls = {};
    ({ getMe } = await import('../controllers/auth.js'));
  });

  it('8. returns user + tenant when both present on req', async () => {
    const fakeTenant = {
      id: 'tenant-uuid-1',
      name: 'Acme Fabrics',
      slug: 'acme-fabrics',
      subscription_tier: 'trial',
      trial_started_at: '2024-01-01T00:00:00Z',
      owner_email: 'jane@example.com',
      settings: {},
    };

    _fromCalls['tenants'] = () => ({
      select() { return this; },
      eq() { return this; },
      single() { return Promise.resolve({ data: fakeTenant, error: null }); },
    });

    const req = {
      user: { id: 'user-1', email: 'jane@example.com', user_metadata: { full_name: 'Jane Smith' } },
      tenantId: 'tenant-uuid-1',
    };
    const res = mockRes();

    await getMe(req, res);

    expect(res._status).toBe(200);
    expect(res._body.success).toBe(true);
    expect(res._body.user.id).toBe('user-1');
    expect(res._body.user.name).toBe('Jane Smith');
    expect(res._body.tenant).toEqual(fakeTenant);
    expect(res._body.onboarding_required).toBeUndefined();
  });

  it('9. when tenantId is null → returns onboarding_required flag, no tenant', async () => {
    const req = {
      user: { id: 'user-2', email: 'new@example.com', user_metadata: {} },
      tenantId: null,
    };
    const res = mockRes();

    await getMe(req, res);

    expect(res._status).toBe(200);
    expect(res._body.success).toBe(true);
    expect(res._body.tenant).toBeNull();
    expect(res._body.onboarding_required).toBe(true);
  });

  it('10. DB error fetching tenant → 500', async () => {
    _fromCalls['tenants'] = () => ({
      select() { return this; },
      eq() { return this; },
      single() { return Promise.resolve({ data: null, error: { message: 'DB connection lost' } }); },
    });

    const req = {
      user: { id: 'user-3', email: 'bob@example.com', user_metadata: {} },
      tenantId: 'tenant-uuid-3',
    };
    const res = mockRes();

    await getMe(req, res);

    expect(res._status).toBe(500);
    expect(res._body.success).toBe(false);
    expect(res._body.error).toMatch(/failed to fetch user/i);
  });
});

// ─── registerWithAuth tests ───────────────────────────────────────────────────

describe('registerWithAuth', () => {
  let registerWithAuth;

  beforeEach(async () => {
    vi.resetModules();
    _fromCalls = {};
    ({ registerWithAuth } = await import('../controllers/auth.js'));
  });

  it('11. creates tenant + user_tenants row and returns 201', async () => {
    const newTenant = {
      id: 'new-tenant-uuid',
      name: 'Sunrise Wholesale',
      slug: 'sunrise-wholesale-xyz',
      subscription_tier: 'trial',
      owner_email: 'owner@sunrise.com',
    };

    // tenants.insert().select().single() → return newTenant
    _fromCalls['tenants'] = () => ({
      select() { return this; },
      insert() { return this; },
      eq() { return this; },
      single() { return Promise.resolve({ data: newTenant, error: null }); },
    });

    // user_tenants.insert() → no error
    _fromCalls['user_tenants'] = () => ({
      select() { return this; },
      insert() { return Promise.resolve({ data: null, error: null }); },
      eq() { return this; },
      single() { return Promise.resolve({ data: null, error: null }); },
    });

    const req = {
      user: { id: 'user-new', email: 'owner@sunrise.com', user_metadata: {} },
      tenantId: null,
      body: {
        business_name: 'Sunrise Wholesale',
        owner_name: 'Ali Hassan',
        whatsapp_number: '+447700123456',
        country: 'UK',
        business_type: 'Wholesale',
      },
    };
    const res = mockRes();

    await registerWithAuth(req, res);

    expect(res._status).toBe(201);
    expect(res._body.success).toBe(true);
    expect(res._body.tenant).toEqual(newTenant);
    expect(res._body.already_registered).toBeUndefined();
  });

  it('12. idempotent: user already has a tenant → returns 200 with already_registered', async () => {
    const existingTenant = { id: 'existing-tenant-uuid', name: 'Old Shop' };

    _fromCalls['tenants'] = () => ({
      select() { return this; },
      insert() { return this; },
      eq() { return this; },
      single() { return Promise.resolve({ data: existingTenant, error: null }); },
    });

    const req = {
      user: { id: 'user-existing', email: 'old@shop.com', user_metadata: {} },
      tenantId: 'existing-tenant-uuid', // already has one
      body: {
        business_name: 'Old Shop',
        owner_name: 'Old Owner',
      },
    };
    const res = mockRes();

    await registerWithAuth(req, res);

    expect(res._status).toBe(200);
    expect(res._body.success).toBe(true);
    expect(res._body.already_registered).toBe(true);
    expect(res._body.tenant).toEqual(existingTenant);
  });

  it('13. missing business_name → 400', async () => {
    const req = {
      user: { id: 'user-bad', email: 'bad@test.com', user_metadata: {} },
      tenantId: null,
      body: {
        owner_name: 'No Business',
        // business_name intentionally omitted
      },
    };
    const res = mockRes();

    await registerWithAuth(req, res);

    expect(res._status).toBe(400);
    expect(res._body.success).toBe(false);
    expect(res._body.error).toMatch(/business_name.*owner_name/i);
  });
});
