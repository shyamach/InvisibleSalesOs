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
 *  9. getMe — tenant is null → returns onboarding_required, never touches the DB
 * 10. getMe — DB error fetching tenant → 500
 * 11. getMe — queries req.supabase (the per-request client), not the shared
 *     module-level client
 * 12. getMe — does not select tenants.slug (column does not exist live)
 * 13. registerWithAuth — create branch calls req.supabase.rpc('bootstrap_tenant', ...) → 201
 * 14. registerWithAuth — idempotent: already has tenant → 200 already_registered,
 *     reading via req.supabase
 * 15. registerWithAuth — missing business_name → 400, never touches the DB
 * 16. registerWithAuth — create branch never touches the shared module-level
 *     client or req.supabase.from — only req.supabase.rpc
 * 17. registerWithAuth — does not send slug in the RPC call or the
 *     idempotent-path select
 * 18. registerWithAuth — RPC error → 500 with the RPC's error message
 * 19. registerWithAuth — RPC reports already_registered (race) → 200 with
 *     already_registered true, even on the create branch
 * 20. registerWithAuth — passes business_name through to the RPC untrimmed;
 *     the controller does not trim or validate it
 *
 * getMe/registerWithAuth are behind requireAuth (Block 1.12a) — tenant
 * identity comes from req.tenantId and reads run on req.supabase (the
 * per-request client), mirroring controllers/billing.js and
 * controllers/team.js. `tenants` has no `slug` column in the live schema, so
 * neither handler may select or insert it (Block 1.12 audit finding).
 *
 * Block 1.12c: registerWithAuth's create branch no longer inserts directly
 * into `tenants`/`user_tenants` on the shared client — `tenants` has no
 * INSERT policy at all, so that path was broken at the DB layer regardless
 * of client (see supabase/migrations/phase_1_12c_bootstrap_tenant_rpc.sql).
 * Both the create and idempotent branches now run on req.supabase; the
 * create branch calls the bootstrap_tenant() SECURITY DEFINER RPC instead of
 * writing to either table directly. Block 1.12c hardening patch: the RPC
 * itself validates/trims p_name (btrim, rejects blank/whitespace-only names
 * with SQLSTATE 22023) — the controller deliberately does not duplicate
 * that here, so p_name is passed through exactly as received in the
 * request body (see test 20).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─── Supabase mock ───────────────────────────────────────────────────────────

// Mutable state for each test to configure
let _authGetUser = vi.fn();
let _fromCalls = {}; // table -> { data, error } per chained call sequence
let _createRequestClient = vi.fn();

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

  const sharedSupabase = {
    auth: {
      getUser: (...args) => _authGetUser(...args),
    },
    // Wrapped in vi.fn so tests can assert the shared/anon client was never
    // touched by handlers that should be using req.supabase instead.
    from: vi.fn((table) => {
      const chain = _fromCalls[table];
      if (typeof chain === 'function') return chain();
      return buildChain(chain || {});
    }),
  };

  return {
    supabase: sharedSupabase,
    createRequestClient: (...args) => {
      _createRequestClient(...args);
      // Request-scoped client shares the same mock table data as the shared
      // client for test purposes — only the constructor call is asserted on.
      return {
        from(table) {
          const chain = _fromCalls[table];
          if (typeof chain === 'function') return chain();
          return buildChain(chain || {});
        },
      };
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

// Mirrors what lib/authMiddleware.js actually attaches to req for an
// authenticated request: a per-request req.supabase client (mockAuthedReq
// style, matching tests/billing.test.js / tests/team.test.js).
//
// `tenantsChain` handles the `tenants` table (select, chained through
// .eq()/.select()/.single()) — used by getMe and registerWithAuth's
// idempotent-read branch. registerWithAuth's create branch no longer inserts
// into `tenants`/`user_tenants` directly (Block 1.12c moved both writes into
// the bootstrap_tenant() RPC), so there is no insert-chain helper here
// anymore — RPC calls are mocked directly via `req.supabase.rpc`.
function makeTenantsChain({ data = null, error = null } = {}) {
  const chain = {
    select: vi.fn(() => chain),
    insert: vi.fn((payload) => { chain._insertedPayload = payload; return chain; }),
    eq: vi.fn(() => chain),
    single: vi.fn(() => Promise.resolve({ data, error })),
  };
  return chain;
}

function makeAuthedSupabase({ tenantsChain, userTenantsChain } = {}) {
  const from = vi.fn((table) => {
    if (table === 'tenants') return tenantsChain;
    if (table === 'user_tenants') return userTenantsChain;
    throw new Error(`Unexpected table in test: ${table}`);
  });
  return { from };
}

// ─── requireAuth tests ────────────────────────────────────────────────────────

describe('requireAuth', () => {
  let requireAuth;

  beforeEach(async () => {
    vi.resetModules();
    delete process.env.DEV_BYPASS_AUTH;
    _authGetUser = vi.fn();
    _fromCalls = {};
    _createRequestClient = vi.fn();
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
    expect(req.userId).toBe('dev-user');
    expect(req.tenantId).toBeTruthy();
    expect(_authGetUser).not.toHaveBeenCalled();
    expect(_createRequestClient).not.toHaveBeenCalled();
    // Dev bypass attaches the shared client, not a per-request one — no real
    // JWT exists to seed a request-scoped client with in this branch.
    const { supabase: sharedSupabase } = await import('../lib/supabase.js');
    expect(req.supabase).toBe(sharedSupabase);
  });

  it('5. valid token + existing tenant → sets req.user, req.userId, req.tenantId, req.userRole, req.supabase and calls next', async () => {
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
    expect(req.userId).toBe('user-uuid-1');
    expect(req.tenantId).toBe('tenant-uuid-1');
    expect(req.userRole).toBe('owner');
    expect(_createRequestClient).toHaveBeenCalledWith('valid.jwt.token');
    expect(req.supabase).toBeTruthy();
    expect(typeof req.supabase.from).toBe('function');
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
    expect(req.userId).toBe('new-user-uuid');
    expect(req.tenantId).toBeNull();
    expect(req.userRole).toBeNull();
    expect(req.supabase).toBeTruthy();
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

  // No `slug` — that column does not exist on `tenants` in the live schema.
  const fakeTenant = {
    id: 'tenant-uuid-1',
    name: 'Acme Fabrics',
    subscription_tier: 'trial',
    trial_started_at: '2024-01-01T00:00:00Z',
    owner_email: 'jane@example.com',
    settings: {},
  };

  it('8. returns user + tenant when both present on req', async () => {
    const tenantsChain = makeTenantsChain({ data: fakeTenant, error: null });
    const req = {
      user: { id: 'user-1', email: 'jane@example.com', user_metadata: { full_name: 'Jane Smith' } },
      tenantId: 'tenant-uuid-1',
      supabase: makeAuthedSupabase({ tenantsChain }),
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

  it('9. when tenantId is null → returns onboarding_required flag, no tenant, never touches the DB', async () => {
    const supabaseFrom = vi.fn();
    const req = {
      user: { id: 'user-2', email: 'new@example.com', user_metadata: {} },
      tenantId: null,
      supabase: { from: supabaseFrom },
    };
    const res = mockRes();

    await getMe(req, res);

    expect(res._status).toBe(200);
    expect(res._body.success).toBe(true);
    expect(res._body.tenant).toBeNull();
    expect(res._body.onboarding_required).toBe(true);
    expect(supabaseFrom).not.toHaveBeenCalled();
  });

  it('10. DB error fetching tenant → 500', async () => {
    const tenantsChain = makeTenantsChain({ data: null, error: { message: 'DB connection lost' } });
    const req = {
      user: { id: 'user-3', email: 'bob@example.com', user_metadata: {} },
      tenantId: 'tenant-uuid-3',
      supabase: makeAuthedSupabase({ tenantsChain }),
    };
    const res = mockRes();

    await getMe(req, res);

    expect(res._status).toBe(500);
    expect(res._body.success).toBe(false);
    expect(res._body.error).toMatch(/failed to fetch user/i);
  });

  it('11. queries req.supabase (the per-request client), not the shared module-level client', async () => {
    const tenantsChain = makeTenantsChain({ data: fakeTenant, error: null });
    const req = {
      user: { id: 'user-1', email: 'jane@example.com', user_metadata: {} },
      tenantId: 'tenant-uuid-1',
      supabase: makeAuthedSupabase({ tenantsChain }),
    };
    const res = mockRes();

    await getMe(req, res);

    expect(req.supabase.from).toHaveBeenCalledWith('tenants');
    const { supabase: sharedSupabase } = await import('../lib/supabase.js');
    expect(sharedSupabase.from).not.toHaveBeenCalled();
  });

  it('12. does not select tenants.slug (column does not exist live)', async () => {
    const tenantsChain = makeTenantsChain({ data: fakeTenant, error: null });
    const req = {
      user: { id: 'user-1', email: 'jane@example.com', user_metadata: {} },
      tenantId: 'tenant-uuid-1',
      supabase: makeAuthedSupabase({ tenantsChain }),
    };
    const res = mockRes();

    await getMe(req, res);

    expect(tenantsChain.select).toHaveBeenCalledTimes(1);
    const selectArg = tenantsChain.select.mock.calls[0][0];
    expect(selectArg).not.toMatch(/\bslug\b/);
  });
});

// ─── registerWithAuth tests ───────────────────────────────────────────────────

describe('registerWithAuth', () => {
  let registerWithAuth;

  // Block 1.12c: `tenants` has no INSERT policy at all, so a direct insert
  // was broken at the DB layer regardless of client (see the Block 1.12c
  // planning audit and supabase/migrations/phase_1_12c_bootstrap_tenant_rpc.sql).
  // The create branch now calls the bootstrap_tenant() SECURITY DEFINER RPC
  // via req.supabase.rpc(...) instead of inserting into `tenants`/
  // `user_tenants` directly, and the idempotent-read branch also moved from
  // the shared module-level `supabase` client to req.supabase. Neither
  // branch should touch the shared client at all anymore.

  beforeEach(async () => {
    vi.resetModules();
    _fromCalls = {};
    ({ registerWithAuth } = await import('../controllers/auth.js'));
    // The shared-client mock factory is only ever invoked once for this test
    // file (vi.resetModules() re-triggers the module registry, not the mock
    // factory's internal state), so `supabase.from`'s call history persists
    // across tests unless explicitly cleared here.
    const { supabase: sharedSupabase } = await import('../lib/supabase.js');
    sharedSupabase.from.mockClear();
  });

  it("13. create branch calls req.supabase.rpc('bootstrap_tenant', ...) and returns 201", async () => {
    // No `slug` — that column does not exist on `tenants` in the live schema.
    const newTenant = {
      id: 'new-tenant-uuid',
      name: 'Sunrise Wholesale',
      subscription_tier: 'trial',
      owner_email: 'owner@sunrise.com',
    };

    const rpc = vi.fn().mockResolvedValue({
      data: { tenant: newTenant, role: 'owner', already_registered: false },
      error: null,
    });

    const req = {
      user: { id: 'user-new', email: 'owner@sunrise.com', user_metadata: {} },
      tenantId: null,
      supabase: { from: vi.fn(), rpc },
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

    expect(rpc).toHaveBeenCalledWith('bootstrap_tenant', {
      p_name: 'Sunrise Wholesale',
      p_settings: {
        country: 'UK',
        business_type: 'Wholesale',
        owner_name: 'Ali Hassan',
      },
    });
  });

  it('14. idempotent: user already has a tenant → returns 200 with already_registered, reading via req.supabase', async () => {
    const existingTenant = { id: 'existing-tenant-uuid', name: 'Old Shop' };
    const tenantsChain = makeTenantsChain({ data: existingTenant, error: null });
    const reqSupabaseFrom = vi.fn((table) => {
      if (table === 'tenants') return tenantsChain;
      throw new Error(`Unexpected table in test: ${table}`);
    });

    const req = {
      user: { id: 'user-existing', email: 'old@shop.com', user_metadata: {} },
      tenantId: 'existing-tenant-uuid', // already has one
      supabase: { from: reqSupabaseFrom, rpc: vi.fn() },
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

    expect(reqSupabaseFrom).toHaveBeenCalledWith('tenants');
    const { supabase: sharedSupabase } = await import('../lib/supabase.js');
    expect(sharedSupabase.from).not.toHaveBeenCalled();
  });

  it('15. missing business_name → 400, never touches the DB', async () => {
    const req = {
      user: { id: 'user-bad', email: 'bad@test.com', user_metadata: {} },
      tenantId: null,
      supabase: { from: vi.fn(), rpc: vi.fn() },
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
    const { supabase: sharedSupabase } = await import('../lib/supabase.js');
    expect(sharedSupabase.from).not.toHaveBeenCalled();
    expect(req.supabase.from).not.toHaveBeenCalled();
    expect(req.supabase.rpc).not.toHaveBeenCalled();
  });

  it('16. create branch never touches the shared client or req.supabase.from — only req.supabase.rpc', async () => {
    const newTenant = { id: 'new-tenant-uuid-2', name: 'Northgate Textiles', subscription_tier: 'trial' };
    const rpc = vi.fn().mockResolvedValue({
      data: { tenant: newTenant, role: 'owner', already_registered: false },
      error: null,
    });
    const reqSupabaseFrom = vi.fn();

    const req = {
      user: { id: 'user-2', email: 'owner@northgate.com', user_metadata: {} },
      tenantId: null,
      supabase: { from: reqSupabaseFrom, rpc },
      body: { business_name: 'Northgate Textiles', owner_name: 'Priya Shah' },
    };
    const res = mockRes();

    await registerWithAuth(req, res);

    expect(res._status).toBe(201);
    expect(rpc).toHaveBeenCalledOnce();
    const { supabase: sharedSupabase } = await import('../lib/supabase.js');
    expect(sharedSupabase.from).not.toHaveBeenCalled();
    expect(reqSupabaseFrom).not.toHaveBeenCalled();
  });

  it('17. does not send slug in the RPC call or the idempotent-path select', async () => {
    const newTenant = { id: 'new-tenant-uuid-3', name: 'Delta Trading', subscription_tier: 'trial' };
    const rpc = vi.fn().mockResolvedValue({
      data: { tenant: newTenant, role: 'owner', already_registered: false },
      error: null,
    });

    const createReq = {
      user: { id: 'user-3', email: 'owner@delta.com', user_metadata: {} },
      tenantId: null,
      supabase: { from: vi.fn(), rpc },
      body: { business_name: 'Delta Trading', owner_name: 'Sam Lee' },
    };
    await registerWithAuth(createReq, mockRes());

    expect(rpc).toHaveBeenCalledTimes(1);
    const [, rpcArgs] = rpc.mock.calls[0];
    expect(rpcArgs).not.toHaveProperty('slug');
    expect(rpcArgs.p_settings).not.toHaveProperty('slug');

    // Idempotent path — `.select('*')` is fine (no explicit column list),
    // confirm it's not narrowing to a slug-bearing column set either.
    const tenantsChain = makeTenantsChain({ data: newTenant, error: null });
    const idempotentReq = {
      user: { id: 'user-3', email: 'owner@delta.com', user_metadata: {} },
      tenantId: 'new-tenant-uuid-3',
      supabase: { from: vi.fn((table) => (table === 'tenants' ? tenantsChain : null)), rpc: vi.fn() },
      body: {},
    };
    await registerWithAuth(idempotentReq, mockRes());

    expect(tenantsChain.select).toHaveBeenCalledTimes(1);
    const selectArg = tenantsChain.select.mock.calls[0][0];
    expect(selectArg).not.toMatch(/\bslug\b/);
  });

  it('18. RPC error → 500 with the RPC error message', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { message: 'permission denied for function bootstrap_tenant' },
    });

    const req = {
      user: { id: 'user-err', email: 'err@test.com', user_metadata: {} },
      tenantId: null,
      supabase: { from: vi.fn(), rpc },
      body: { business_name: 'Err Co', owner_name: 'Some Owner' },
    };
    const res = mockRes();

    await registerWithAuth(req, res);

    expect(res._status).toBe(500);
    expect(res._body.success).toBe(false);
    expect(res._body.error).toMatch(/permission denied/i);
  });

  it('19. create branch: RPC reports already_registered (race) → 200 with already_registered true', async () => {
    const tenant = { id: 'raced-tenant-uuid', name: 'Raced Co' };
    const rpc = vi.fn().mockResolvedValue({
      data: { tenant, role: 'owner', already_registered: true },
      error: null,
    });

    const req = {
      // requireAuth's earlier, separate read raced and saw no mapping yet —
      // the RPC's own post-lock re-check is what catches this, not the JS
      // layer, which is exactly what it's for.
      user: { id: 'user-race', email: 'race@test.com', user_metadata: {} },
      tenantId: null,
      supabase: { from: vi.fn(), rpc },
      body: { business_name: 'Raced Co', owner_name: 'Race Owner' },
    };
    const res = mockRes();

    await registerWithAuth(req, res);

    expect(res._status).toBe(200);
    expect(res._body.success).toBe(true);
    expect(res._body.already_registered).toBe(true);
    expect(res._body.tenant).toEqual(tenant);
  });

  it('20. passes business_name through to bootstrap_tenant untrimmed — trimming/validation is the RPC\'s job, not the controller\'s', async () => {
    const newTenant = { id: 'padded-tenant-uuid', name: 'Padded Co', subscription_tier: 'trial' };
    const rpc = vi.fn().mockResolvedValue({
      data: { tenant: newTenant, role: 'owner', already_registered: false },
      error: null,
    });

    const req = {
      user: { id: 'user-padded', email: 'padded@test.com', user_metadata: {} },
      tenantId: null,
      supabase: { from: vi.fn(), rpc },
      body: { business_name: '  Padded Co  ', owner_name: 'Pat Owner' },
    };
    const res = mockRes();

    await registerWithAuth(req, res);

    expect(res._status).toBe(201);
    // Controller does not trim or validate business_name — bootstrap_tenant()
    // does (btrim(p_name), rejecting blank/whitespace-only names with
    // SQLSTATE 22023 — Block 1.12c hardening patch). Duplicating that check
    // here would just be two places that can disagree about what's valid.
    const [, rpcArgs] = rpc.mock.calls[0];
    expect(rpcArgs.p_name).toBe('  Padded Co  ');
  });
});
