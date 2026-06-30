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

// ── controller ──────────────────────────────────────────────────────────────
const mockFrom = vi.hoisted(() => vi.fn());
vi.mock('../lib/supabase.js', () => ({ supabase: { from: mockFrom } }));
import { getAutoReplySettings, updateAutoReplySettings } from '../controllers/settings.js';

function mockRes() {
  return { _status: 200, _body: null, status(c) { this._status = c; return this; }, json(b) { this._body = b; return this; } };
}
beforeEach(() => vi.clearAllMocks());

describe('getAutoReplySettings', () => {
  it('returns defaults when tenant has no config', async () => {
    mockFrom.mockReturnValue({ select: () => ({ eq: () => ({ maybeSingle: vi.fn().mockResolvedValue({ data: { auto_reply: null }, error: null }) }) }) });
    const res = mockRes();
    await getAutoReplySettings({ headers: {} }, res);
    expect(res._body).toMatchObject({ success: true, auto_reply: DEFAULT_AUTO_REPLY });
  });
});

describe('updateAutoReplySettings', () => {
  it('rejects an invalid payload with 400 before writing', async () => {
    const res = mockRes();
    await updateAutoReplySettings({ headers: {}, body: { window_minutes: -5 } }, res);
    expect(res._status).toBe(400);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('persists a valid merged config', async () => {
    const single = vi.fn().mockResolvedValue({ data: { auto_reply: { enabled: true, priority_rules: DEFAULT_AUTO_REPLY.priority_rules, window_minutes: 30 } }, error: null });
    mockFrom.mockReturnValue({ update: () => ({ eq: () => ({ select: () => ({ single }) }) }) });
    const res = mockRes();
    await updateAutoReplySettings({ headers: {}, body: { enabled: true } }, res);
    expect(res._status).toBe(200);
    expect(res._body.auto_reply.enabled).toBe(true);
  });
});
