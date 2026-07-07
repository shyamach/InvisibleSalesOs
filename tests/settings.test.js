/**
 * tests/settings.test.js
 * Rule #1 coverage for auto-reply config validation + the settings controller.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { validateAutoReplyConfig, DEFAULT_AUTO_REPLY } from '../lib/autoReply.js';

describe('validateAutoReplyConfig', () => {
  it('accepts a full valid config', () => {
    const r = validateAutoReplyConfig({
      enabled: true,
      priority_rules: { HIGH: 'manual', MEDIUM: 'window', LOW: 'auto' },
      window_minutes: 45,
    });
    expect(r.ok).toBe(true);
    expect(r.data.window_minutes).toBe(45);
  });

  it('merges a partial patch onto defaults', () => {
    const r = validateAutoReplyConfig({ enabled: true });
    expect(r.ok).toBe(true);
    expect(r.data).toMatchObject({ enabled: true, priority_rules: DEFAULT_AUTO_REPLY.priority_rules, window_minutes: 30 });
  });

  it('rejects an invalid mode and an out-of-range window', () => {
    expect(validateAutoReplyConfig({ priority_rules: { LOW: 'explode' } }).ok).toBe(false);
    expect(validateAutoReplyConfig({ window_minutes: 0 }).ok).toBe(false);
    expect(validateAutoReplyConfig({ window_minutes: 99999 }).ok).toBe(false);
  });
});

// ── controller (mocked req.supabase) ─────────────────────────────────────────
// Tenant identity comes from req.tenantId (set by requireAuth from a verified
// JWT — see lib/authMiddleware.js) and queries run on req.supabase (the
// per-request client), not the shared lib/supabase.js client. Tests build a
// mock req directly instead of module-mocking lib/supabase.js.

const mockFrom = vi.hoisted(() => vi.fn());
import { getAutoReplySettings, updateAutoReplySettings } from '../controllers/settings.js';

const TENANT_A = 'tenant-uuid-1';
const SPOOFED_TENANT_B = 'tenant-uuid-spoofed';

function mockRes() {
  return { _status: 200, _body: null, status(c) { this._status = c; return this; }, json(b) { this._body = b; return this; } };
}

// Builds a request carrying a mock req.supabase — mirrors what requireAuth
// attaches on a real request. `tenantId` defaults to TENANT_A; pass
// `tenantId: null` to exercise the no-tenant guard.
function mockReq(overrides = {}) {
  return {
    tenantId: TENANT_A,
    supabase: { from: mockFrom },
    headers: {},
    ...overrides,
  };
}

beforeEach(() => vi.clearAllMocks());

describe('tenant guard — applies across both settings handlers', () => {
  it('getAutoReplySettings returns 403 and never touches the DB when req.tenantId is null', async () => {
    const res = mockRes();
    await getAutoReplySettings(mockReq({ tenantId: null }), res);
    expect(res._status).toBe(403);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('updateAutoReplySettings returns 403 and never touches the DB when req.tenantId is null', async () => {
    const res = mockRes();
    await updateAutoReplySettings(mockReq({ tenantId: null, body: { enabled: true } }), res);
    expect(res._status).toBe(403);
    expect(mockFrom).not.toHaveBeenCalled();
  });
});

describe('getAutoReplySettings', () => {
  it('returns defaults when tenant has no config', async () => {
    mockFrom.mockReturnValue({ select: () => ({ eq: () => ({ maybeSingle: vi.fn().mockResolvedValue({ data: { auto_reply: null }, error: null }) }) }) });
    const res = mockRes();
    await getAutoReplySettings(mockReq(), res);
    expect(res._body).toMatchObject({ success: true, auto_reply: DEFAULT_AUTO_REPLY });
  });

  it('filters by req.tenantId, ignoring any x-tenant-id header', async () => {
    const maybeSingle = vi.fn().mockResolvedValue({ data: { auto_reply: null }, error: null });
    const eq = vi.fn(() => ({ maybeSingle }));
    const select = vi.fn(() => ({ eq }));
    mockFrom.mockReturnValue({ select });

    const res = mockRes();
    await getAutoReplySettings(mockReq({ headers: { 'x-tenant-id': SPOOFED_TENANT_B } }), res);

    expect(eq).toHaveBeenCalledWith('id', TENANT_A);
    expect(res._status).toBe(200);
  });
});

describe('updateAutoReplySettings', () => {
  it('rejects an invalid payload with 400 before writing', async () => {
    const res = mockRes();
    await updateAutoReplySettings(mockReq({ body: { window_minutes: -5 } }), res);
    expect(res._status).toBe(400);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('persists a valid merged config', async () => {
    const single = vi.fn().mockResolvedValue({ data: { auto_reply: { enabled: true, priority_rules: DEFAULT_AUTO_REPLY.priority_rules, window_minutes: 30 } }, error: null });
    mockFrom.mockReturnValue({ update: () => ({ eq: () => ({ select: () => ({ single }) }) }) });
    const res = mockRes();
    await updateAutoReplySettings(mockReq({ body: { enabled: true } }), res);
    expect(res._status).toBe(200);
    expect(res._body.auto_reply.enabled).toBe(true);
  });

  it('a spoofed x-tenant-id header never reaches the update — filters by req.tenantId always', async () => {
    const single = vi.fn().mockResolvedValue({ data: { auto_reply: { enabled: true, priority_rules: DEFAULT_AUTO_REPLY.priority_rules, window_minutes: 30 } }, error: null });
    const select = vi.fn(() => ({ single }));
    const eq = vi.fn(() => ({ select }));
    const update = vi.fn(() => ({ eq }));
    mockFrom.mockReturnValue({ update });

    const res = mockRes();
    await updateAutoReplySettings(mockReq({ body: { enabled: true }, headers: { 'x-tenant-id': SPOOFED_TENANT_B } }), res);

    expect(eq).toHaveBeenCalledWith('id', TENANT_A);
    expect(res._status).toBe(200);
  });
});
