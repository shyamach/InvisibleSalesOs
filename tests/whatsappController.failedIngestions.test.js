/**
 * tests/whatsappController.failedIngestions.test.js
 *
 * Block 0 (architecture.md §6) — regression guard for the WhatsApp Meta-webhook
 * controller. Confirms the caller (Meta's webhook POST) never crashes and always
 * gets its immediate 200 ack, regardless of whether the engine underneath
 * succeeds or fails. This is CURRENT, already-correct behaviour — these tests
 * are expected to PASS today, proving Block 0's dead-letter write (once added
 * inside engine.js) has no reason to change this contract.
 *
 * Scope: failed_ingestions / caller-safety only. controllers/whatsapp.js has no
 * prior test coverage — this file mocks engine.js itself (not its internals,
 * which are covered by tests/engine.failedIngestions.test.js).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'crypto';

vi.mock('../engine.js', () => ({ processLeadThroughCognitiveEngine: vi.fn() }));
// resolveBrandIdForPhoneNumberId goes through a Supabase RPC now (tenant
// resolution moved off the hardcoded brand id — see phase_i_2 migration).
// Out of scope for this file (caller-safety/ack behavior only, per its own
// docstring) — mocked so these tests don't need a live/mocked DB.
vi.mock('../lib/supabase.js', () => ({
  createSystemClient: vi.fn(() => ({
    rpc: vi.fn().mockResolvedValue({ data: [{ brand_id: 1 }], error: null }),
  })),
}));

import { processWhatsAppWebhook } from '../controllers/whatsapp.js';
import { processLeadThroughCognitiveEngine } from '../engine.js';

const TEST_APP_SECRET = 'test-meta-app-secret';

function signBody(bodyObj) {
  const raw = Buffer.from(JSON.stringify(bodyObj));
  const hmac = crypto.createHmac('sha256', TEST_APP_SECRET).update(raw).digest('hex');
  return { raw, signature: `sha256=${hmac}` };
}

// Builds a req shaped like what server.js's express.json({ verify }) +
// isValidMetaSignature actually require — real signature, real rawBody —
// not just the parsed body, so these tests exercise the real code path
// (2026-08-23, added alongside webhook signature verification).
function makeReqRes(overrides = {}) {
  const body = {
    object: 'whatsapp_business_account',
    entry: [
      {
        changes: [
          {
            value: {
              metadata: { phone_number_id: '123456' },
              messages: [{ from: '447700900000', type: 'text', text: { body: 'need 50 boxes' } }],
              contacts: [{ profile: { name: 'Test Buyer' } }],
            },
          },
        ],
      },
    ],
    ...overrides.body,
  };
  const { raw, signature } = signBody(body);

  const req = {
    body,
    rawBody: raw,
    headers: { 'x-hub-signature-256': signature },
  };
  const res = { sendStatus: vi.fn() };
  return { req, res };
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.META_APP_SECRET = TEST_APP_SECRET;
});

describe('processWhatsAppWebhook — caller is always acked, never crashed', () => {
  it('sends 200 immediately and does not throw when the engine succeeds', async () => {
    processLeadThroughCognitiveEngine.mockResolvedValue({ success: true, leadId: 'lead-1' });
    const { req, res } = makeReqRes();

    await expect(processWhatsAppWebhook(req, res)).resolves.not.toThrow();

    expect(res.sendStatus).toHaveBeenCalledWith(200);
    expect(processLeadThroughCognitiveEngine).toHaveBeenCalledOnce();
  });

  it('sends 200 immediately and does not throw when the engine reports a failure', async () => {
    processLeadThroughCognitiveEngine.mockResolvedValue({ success: false, error: 'writer_failed' });
    const { req, res } = makeReqRes();

    await expect(processWhatsAppWebhook(req, res)).resolves.not.toThrow();

    expect(res.sendStatus).toHaveBeenCalledWith(200);
  });

  it('sends 200 immediately and does not throw when the engine call itself rejects', async () => {
    processLeadThroughCognitiveEngine.mockRejectedValue(new Error('unexpected engine crash'));
    const { req, res } = makeReqRes();

    await expect(processWhatsAppWebhook(req, res)).resolves.not.toThrow();

    expect(res.sendStatus).toHaveBeenCalledWith(200);
  });
});

describe('processWhatsAppWebhook — X-Hub-Signature-256 verification (2026-08-23)', () => {
  it('rejects with 401 and never touches the engine when the header is missing', async () => {
    const { req, res } = makeReqRes();
    delete req.headers['x-hub-signature-256'];

    await expect(processWhatsAppWebhook(req, res)).resolves.not.toThrow();

    expect(res.sendStatus).toHaveBeenCalledWith(401);
    expect(res.sendStatus).not.toHaveBeenCalledWith(200);
    expect(processLeadThroughCognitiveEngine).not.toHaveBeenCalled();
  });

  it('rejects with 401 when the signature does not match the body', async () => {
    const { req, res } = makeReqRes();
    req.headers['x-hub-signature-256'] = 'sha256=' + '0'.repeat(64);

    await expect(processWhatsAppWebhook(req, res)).resolves.not.toThrow();

    expect(res.sendStatus).toHaveBeenCalledWith(401);
    expect(processLeadThroughCognitiveEngine).not.toHaveBeenCalled();
  });

  it('fails closed with 401 when META_APP_SECRET is not configured, even with a header present', async () => {
    delete process.env.META_APP_SECRET;
    const { req, res } = makeReqRes();

    await expect(processWhatsAppWebhook(req, res)).resolves.not.toThrow();

    expect(res.sendStatus).toHaveBeenCalledWith(401);
    expect(processLeadThroughCognitiveEngine).not.toHaveBeenCalled();
  });

  it('does not throw when req.headers itself is missing (defensive access)', async () => {
    const { req, res } = makeReqRes();
    delete req.headers;

    await expect(processWhatsAppWebhook(req, res)).resolves.not.toThrow();

    expect(res.sendStatus).toHaveBeenCalledWith(401);
  });
});
