/**
 * tests/team.test.js
 * Rule #1 coverage for team membership: guard logic (pure) + controller paths
 * (mocked Supabase rpc + table ops).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { validateRole, canRemoveMember, canChangeRole, isMember } from '../lib/team.js';

const MEMBERS = [
  { user_id: 'u-owner', role: 'owner' },
  { user_id: 'u-admin', role: 'admin' },
  { user_id: 'u-member', role: 'member' },
];

describe('team guards (pure)', () => {
  it('validateRole', () => {
    expect(validateRole('owner')).toBe(true);
    expect(validateRole('superadmin')).toBe(false);
  });

  it('canRemoveMember blocks removing the last owner', () => {
    expect(canRemoveMember([{ user_id: 'u-owner', role: 'owner' }], 'u-owner').ok).toBe(false);
    expect(canRemoveMember(MEMBERS, 'u-member').ok).toBe(true);
  });

  it('canChangeRole blocks demoting the last owner and invalid roles', () => {
    // Only one owner in MEMBERS → demoting them is blocked.
    expect(canChangeRole(MEMBERS, 'u-owner', 'member').ok).toBe(false);
    // With a second owner present, demoting one is allowed.
    const twoOwners = [...MEMBERS, { user_id: 'u-owner2', role: 'owner' }];
    expect(canChangeRole(twoOwners, 'u-owner', 'member').ok).toBe(true);
    // Promoting a member to admin is fine.
    expect(canChangeRole(MEMBERS, 'u-member', 'admin').ok).toBe(true);
    // Invalid role rejected.
    expect(canChangeRole(MEMBERS, 'u-admin', 'banana').ok).toBe(false);
  });

  it('isMember', () => {
    expect(isMember(MEMBERS, 'u-admin')).toBe(true);
    expect(isMember(MEMBERS, 'u-ghost')).toBe(false);
  });
});

// ── controller (mocked req.supabase) ─────────────────────────────────────────
// Tenant identity comes from req.tenantId (set by requireAuth from a verified
// JWT — see lib/authMiddleware.js) and queries run on req.supabase (the
// per-request client), not the shared lib/supabase.js client. Tests build a
// mock req directly instead of module-mocking lib/supabase.js.

const mockRpc = vi.hoisted(() => vi.fn());
const mockFrom = vi.hoisted(() => vi.fn());
import { listMembers, addMember, updateMemberRole, removeMember } from '../controllers/team.js';

const TENANT_A = 'tenant-uuid-1';
const SPOOFED_TENANT_B = 'tenant-uuid-spoofed';

function mockRes() {
  return { _status: 200, _body: null, status(c) { this._status = c; return this; }, json(b) { this._body = b; return this; } };
}

// Builds a request carrying a mock req.supabase — mirrors what requireAuth
// attaches on a real request. `tenantId` defaults to TENANT_A, `userRole`
// defaults to 'owner'; pass `tenantId: null` / `userRole: 'member'` to
// exercise the tenant and role guards respectively.
function mockReq(overrides = {}) {
  return {
    tenantId: TENANT_A,
    userRole: 'owner',
    supabase: { rpc: mockRpc, from: mockFrom },
    headers: {},
    ...overrides,
  };
}

beforeEach(() => vi.clearAllMocks());

describe('tenant guard — applies across all team handlers', () => {
  it('listMembers returns 403 and never touches the DB when req.tenantId is null', async () => {
    const res = mockRes();
    await listMembers(mockReq({ tenantId: null }), res);
    expect(res._status).toBe(403);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('addMember returns 403 and never touches the DB when req.tenantId is null', async () => {
    const res = mockRes();
    await addMember(mockReq({ tenantId: null, body: { email: 'x@x.com' } }), res);
    expect(res._status).toBe(403);
    expect(mockRpc).not.toHaveBeenCalled();
  });
});

describe('role guard — owner/admin only on mutating routes', () => {
  it('addMember: member role gets 403, never touches the DB', async () => {
    const res = mockRes();
    await addMember(mockReq({ userRole: 'member', body: { email: 'x@x.com' } }), res);
    expect(res._status).toBe(403);
    expect(res._body.error).toMatch(/owners and admins/);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('updateMemberRole: member role gets 403, never touches the DB', async () => {
    const res = mockRes();
    await updateMemberRole(mockReq({ userRole: 'member', params: { userId: 'u-member' }, body: { role: 'admin' } }), res);
    expect(res._status).toBe(403);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('removeMember: member role gets 403, never touches the DB', async () => {
    const res = mockRes();
    await removeMember(mockReq({ userRole: 'member', params: { userId: 'u-member' } }), res);
    expect(res._status).toBe(403);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('addMember: admin role is allowed through to the DB call', async () => {
    mockRpc.mockImplementation((fn) => {
      if (fn === 'get_user_id_by_email') return Promise.resolve({ data: 'u-new', error: null });
      return Promise.resolve({ data: MEMBERS, error: null });
    });
    const insert = vi.fn().mockResolvedValue({ error: null });
    mockFrom.mockReturnValue({ insert });
    const res = mockRes();
    await addMember(mockReq({ userRole: 'admin', body: { email: 'new@x.com', role: 'member' } }), res);
    expect(res._status).toBe(201);
  });

  it('listMembers: member role is NOT gated — list stays open to any tenant member', async () => {
    mockRpc.mockResolvedValue({ data: MEMBERS, error: null });
    const res = mockRes();
    await listMembers(mockReq({ userRole: 'member' }), res);
    expect(res._status).toBe(200);
    expect(res._body.members).toEqual(MEMBERS);
  });
});

describe('listMembers', () => {
  it('filters by req.tenantId, ignoring any x-tenant-id header', async () => {
    mockRpc.mockResolvedValue({ data: MEMBERS, error: null });
    const res = mockRes();
    await listMembers(mockReq({ headers: { 'x-tenant-id': SPOOFED_TENANT_B } }), res);
    expect(mockRpc).toHaveBeenCalledWith('get_tenant_members', { p_tenant_id: TENANT_A });
    expect(res._status).toBe(200);
    expect(res._body.members).toEqual(MEMBERS);
  });
});

describe('addMember', () => {
  it('404s with NOT_REGISTERED when the email has no account', async () => {
    mockRpc.mockImplementation((fn) => {
      if (fn === 'get_user_id_by_email') return Promise.resolve({ data: null, error: null });
      return Promise.resolve({ data: [], error: null });
    });
    const res = mockRes();
    await addMember(mockReq({ body: { email: 'ghost@x.com' } }), res);
    expect(res._status).toBe(404);
    expect(res._body.code).toBe('NOT_REGISTERED');
  });

  it('links an existing user and returns 201, scoping the insert by req.tenantId', async () => {
    mockRpc.mockImplementation((fn) => {
      if (fn === 'get_user_id_by_email') return Promise.resolve({ data: 'u-new', error: null });
      return Promise.resolve({ data: MEMBERS, error: null }); // get_tenant_members
    });
    const insert = vi.fn().mockResolvedValue({ error: null });
    mockFrom.mockReturnValue({ insert });
    const res = mockRes();
    await addMember(mockReq({ body: { email: 'new@x.com', role: 'member' }, headers: { 'x-tenant-id': SPOOFED_TENANT_B } }), res);
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ user_id: 'u-new', role: 'member', tenant_id: TENANT_A }));
    expect(res._status).toBe(201);
  });

  it('409s when the user is already a member', async () => {
    mockRpc.mockImplementation((fn) => {
      if (fn === 'get_user_id_by_email') return Promise.resolve({ data: 'u-admin', error: null });
      return Promise.resolve({ data: MEMBERS, error: null });
    });
    const res = mockRes();
    await addMember(mockReq({ body: { email: 'admin@x.com' } }), res);
    expect(res._status).toBe(409);
  });
});

describe('updateMemberRole', () => {
  it('rejects an invalid role transition with 400', async () => {
    mockRpc.mockResolvedValue({ data: [{ user_id: 'u-owner', role: 'owner' }], error: null });
    const res = mockRes();
    await updateMemberRole(mockReq({ params: { userId: 'u-owner' }, body: { role: 'member' } }), res);
    expect(res._status).toBe(400);
    expect(res._body.error).toMatch(/last owner/);
  });

  it('updates the role, scoping the update by req.tenantId', async () => {
    mockRpc.mockResolvedValue({ data: MEMBERS, error: null });
    const eq2 = vi.fn().mockResolvedValue({ error: null });
    const eq1 = vi.fn(() => ({ eq: eq2 }));
    const update = vi.fn(() => ({ eq: eq1 }));
    mockFrom.mockReturnValue({ update });

    const res = mockRes();
    await updateMemberRole(mockReq({ params: { userId: 'u-member' }, body: { role: 'admin' } }), res);

    expect(eq1).toHaveBeenCalledWith('tenant_id', TENANT_A);
    expect(res._status).toBe(200);
    expect(res._body.success).toBe(true);
  });
});

describe('removeMember', () => {
  it('blocks removing the last owner with 400', async () => {
    mockRpc.mockResolvedValue({ data: [{ user_id: 'u-owner', role: 'owner' }], error: null });
    const res = mockRes();
    await removeMember(mockReq({ params: { userId: 'u-owner' } }), res);
    expect(res._status).toBe(400);
    expect(res._body.error).toMatch(/last owner/);
  });

  it('removes a regular member, scoping the delete by req.tenantId', async () => {
    mockRpc.mockResolvedValue({ data: MEMBERS, error: null });
    const del = { eq: () => ({ eq: vi.fn().mockResolvedValue({ error: null }) }) };
    mockFrom.mockReturnValue({ delete: () => del });
    const res = mockRes();
    await removeMember(mockReq({ params: { userId: 'u-member' } }), res);
    expect(res._status).toBe(200);
    expect(res._body.removed).toBe('u-member');
  });
});
