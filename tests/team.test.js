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

// ── controller ──────────────────────────────────────────────────────────────
const mockRpc = vi.hoisted(() => vi.fn());
const mockFrom = vi.hoisted(() => vi.fn());
vi.mock('../lib/supabase.js', () => ({ supabase: { rpc: mockRpc, from: mockFrom } }));
import { addMember, removeMember } from '../controllers/team.js';

function mockRes() {
  return { _status: 200, _body: null, status(c) { this._status = c; return this; }, json(b) { this._body = b; return this; } };
}
beforeEach(() => vi.clearAllMocks());

describe('addMember', () => {
  it('404s with NOT_REGISTERED when the email has no account', async () => {
    mockRpc.mockImplementation((fn) => {
      if (fn === 'get_user_id_by_email') return Promise.resolve({ data: null, error: null });
      return Promise.resolve({ data: [], error: null });
    });
    const res = mockRes();
    await addMember({ headers: {}, body: { email: 'ghost@x.com' } }, res);
    expect(res._status).toBe(404);
    expect(res._body.code).toBe('NOT_REGISTERED');
  });

  it('links an existing user and returns 201', async () => {
    mockRpc.mockImplementation((fn) => {
      if (fn === 'get_user_id_by_email') return Promise.resolve({ data: 'u-new', error: null });
      return Promise.resolve({ data: MEMBERS, error: null }); // get_tenant_members
    });
    const insert = vi.fn().mockResolvedValue({ error: null });
    mockFrom.mockReturnValue({ insert });
    const res = mockRes();
    await addMember({ headers: {}, body: { email: 'new@x.com', role: 'member' } }, res);
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ user_id: 'u-new', role: 'member' }));
    expect(res._status).toBe(201);
  });

  it('409s when the user is already a member', async () => {
    mockRpc.mockImplementation((fn) => {
      if (fn === 'get_user_id_by_email') return Promise.resolve({ data: 'u-admin', error: null });
      return Promise.resolve({ data: MEMBERS, error: null });
    });
    const res = mockRes();
    await addMember({ headers: {}, body: { email: 'admin@x.com' } }, res);
    expect(res._status).toBe(409);
  });
});

describe('removeMember', () => {
  it('blocks removing the last owner with 400', async () => {
    mockRpc.mockResolvedValue({ data: [{ user_id: 'u-owner', role: 'owner' }], error: null });
    const res = mockRes();
    await removeMember({ headers: {}, params: { userId: 'u-owner' } }, res);
    expect(res._status).toBe(400);
    expect(res._body.error).toMatch(/last owner/);
  });

  it('removes a regular member', async () => {
    mockRpc.mockResolvedValue({ data: MEMBERS, error: null });
    const del = { eq: () => ({ eq: vi.fn().mockResolvedValue({ error: null }) }) };
    mockFrom.mockReturnValue({ delete: () => del });
    const res = mockRes();
    await removeMember({ headers: {}, params: { userId: 'u-member' } }, res);
    expect(res._status).toBe(200);
    expect(res._body.removed).toBe('u-member');
  });
});
