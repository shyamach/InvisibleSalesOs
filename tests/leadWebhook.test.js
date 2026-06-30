/**
 * tests/leadWebhook.test.js
 * Rule #1 coverage for the generic form webhook.
 *  - validateFormLead / formLeadSchema (Zod)
 *  - processFormLead core with injected fake deps (no Express/DB/AI)
 */
import { describe, it, expect, vi } from 'vitest';
import { validateFormLead, formLeadSchema } from '../lib/webhookLeadSchema.js';
import { processFormLead } from '../lib/formLeadCore.js';

// ─── Schema ───────────────────────────────────────────────────────────────────

describe('formLeadSchema / validateFormLead', () => {
  const valid = { name: 'Priya', email: 'PRIYA@Acme.co.uk', message: 'Need 200 cases of basmati.' };

  it('accepts a valid payload and normalises email to lowercase', () => {
    const r = validateFormLead(valid);
    expect(r.ok).toBe(true);
    expect(r.data.email).toBe('priya@acme.co.uk');
  });

  it('rejects when message is missing', () => {
    const r = validateFormLead({ email: 'a@b.com' });
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.field === 'message')).toBe(true);
  });

  it('rejects when neither email nor phone is present', () => {
    const r = validateFormLead({ message: 'hello there' });
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.field === 'contact')).toBe(true);
  });

  it('accepts phone-only payloads', () => {
    const r = validateFormLead({ phone: '+44 7700 900123', message: 'call me' });
    expect(r.ok).toBe(true);
  });

  it('rejects a malformed email and an unsupported channel', () => {
    expect(validateFormLead({ email: 'not-an-email', message: 'hi' }).ok).toBe(false);
    expect(validateFormLead({ email: 'a@b.com', message: 'hi', channel: 'pigeon' }).ok).toBe(false);
  });
});

// ─── processFormLead core ───────────────────────────────────────────────────────

function makeDeps(overrides = {}) {
  return {
    rateLimiter: { check: vi.fn().mockReturnValue({ allowed: true, retryAfterMs: 0 }) },
    schema: formLeadSchema,
    upsertContact: vi.fn().mockResolvedValue({ id: 'contact-1' }),
    runEngine: vi.fn().mockResolvedValue({
      success: true,
      leadId: 'lead-1',
      profile: { priority: 'HIGH' },
      autoReply: { action: 'manual' },
      deliveryStatus: { dispatched: false, status: 'awaiting_approval' },
    }),
    linkLeadContact: vi.fn().mockResolvedValue(undefined),
    secret: null,
    defaultTenant: '00000000-0000-0000-0000-000000000001',
    ...overrides,
  };
}

const goodBody = { name: 'Sam', email: 'sam@buyer.com', message: 'Looking to order 500 units.' };

describe('processFormLead', () => {
  it('returns 202 on success and wires contact → engine → link', async () => {
    const deps = makeDeps();
    const res = await processFormLead({ body: goodBody, headers: {}, ip: '1.2.3.4', deps });

    expect(res.status).toBe(202);
    expect(res.body).toMatchObject({ success: true, trackingId: 'lead-1', contactId: 'contact-1', classification: 'HIGH', autoReply: 'manual' });
    expect(deps.upsertContact).toHaveBeenCalledOnce();
    expect(deps.runEngine).toHaveBeenCalledOnce();
    expect(deps.linkLeadContact).toHaveBeenCalledWith('lead-1', 'contact-1');
  });

  it('passes the x-tenant-id header through to deps', async () => {
    const deps = makeDeps();
    await processFormLead({ body: goodBody, headers: { 'x-tenant-id': 'tenant-xyz' }, ip: '1.2.3.4', deps });
    expect(deps.upsertContact).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 'tenant-xyz' }));
  });

  it('returns 400 and does not call the engine on invalid payload', async () => {
    const deps = makeDeps();
    const res = await processFormLead({ body: { message: 'no contact info' }, headers: {}, ip: '1.2.3.4', deps });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Validation failed');
    expect(deps.runEngine).not.toHaveBeenCalled();
  });

  it('returns 429 when rate limited (before validation/engine)', async () => {
    const deps = makeDeps({ rateLimiter: { check: vi.fn().mockReturnValue({ allowed: false, retryAfterMs: 4200 }) } });
    const res = await processFormLead({ body: goodBody, headers: {}, ip: '1.2.3.4', deps });
    expect(res.status).toBe(429);
    expect(res.body.retry_after_ms).toBe(4200);
    expect(deps.runEngine).not.toHaveBeenCalled();
  });

  it('returns 401 when a configured secret does not match', async () => {
    const deps = makeDeps({ secret: 'top-secret' });
    const res = await processFormLead({ body: goodBody, headers: { 'x-webhook-secret': 'wrong' }, ip: '1.2.3.4', deps });
    expect(res.status).toBe(401);
    expect(deps.rateLimiter.check).not.toHaveBeenCalled();
  });

  it('allows the request when the configured secret matches', async () => {
    const deps = makeDeps({ secret: 'top-secret' });
    const res = await processFormLead({ body: goodBody, headers: { 'x-webhook-secret': 'top-secret' }, ip: '1.2.3.4', deps });
    expect(res.status).toBe(202);
  });

  it('still succeeds (non-fatal) when contact upsert throws', async () => {
    const deps = makeDeps({ upsertContact: vi.fn().mockRejectedValue(new Error('db down')) });
    const res = await processFormLead({ body: goodBody, headers: {}, ip: '1.2.3.4', deps });
    expect(res.status).toBe(202);
    expect(res.body.contactId).toBeNull();
    expect(deps.runEngine).toHaveBeenCalledOnce();
  });

  it('returns 502 when the engine throws', async () => {
    const deps = makeDeps({ runEngine: vi.fn().mockRejectedValue(new Error('engine boom')) });
    const res = await processFormLead({ body: goodBody, headers: {}, ip: '1.2.3.4', deps });
    expect(res.status).toBe(502);
    expect(res.body.success).toBe(false);
  });
});
