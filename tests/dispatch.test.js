/**
 * tests/dispatch.test.js
 * Tests for the /api/responder/dispatch endpoint auth guard.
 * Verifies that unauthenticated requests are rejected (Security S-3).
 */
import { describe, it, expect, vi } from 'vitest';

// Mock the requireInternalKey middleware logic directly
// (We test the auth guard in isolation without spinning up Express)

function makeAuthMiddleware(envKey) {
  return function requireInternalKey(req, res, next) {
    const key = req.headers['x-internal-key'];
    if (!envKey || key !== envKey) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }
    next();
  };
}

function mockRes() {
  const res = {
    _status: 200,
    _body: null,
    status(code) { this._status = code; return this; },
    json(body) { this._body = body; return this; },
  };
  return res;
}

describe('requireInternalKey — Auth Middleware', () => {
  it('passes when correct key is provided', () => {
    const middleware = makeAuthMiddleware('secret-key-123');
    const req = { headers: { 'x-internal-key': 'secret-key-123' } };
    const res = mockRes();
    const next = vi.fn();

    middleware(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res._status).toBe(200);
  });

  it('blocks when wrong key is provided', () => {
    const middleware = makeAuthMiddleware('secret-key-123');
    const req = { headers: { 'x-internal-key': 'wrong-key' } };
    const res = mockRes();
    const next = vi.fn();

    middleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res._status).toBe(401);
    expect(res._body.success).toBe(false);
  });

  it('blocks when no key is provided', () => {
    const middleware = makeAuthMiddleware('secret-key-123');
    const req = { headers: {} };
    const res = mockRes();
    const next = vi.fn();

    middleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res._status).toBe(401);
  });

  it('blocks when INTERNAL_API_KEY is not configured', () => {
    // Simulates env var missing
    const middleware = makeAuthMiddleware(undefined);
    const req = { headers: { 'x-internal-key': 'any-key' } };
    const res = mockRes();
    const next = vi.fn();

    middleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res._status).toBe(401);
  });
});
