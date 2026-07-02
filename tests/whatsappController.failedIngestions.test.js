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

vi.mock('../engine.js', () => ({ processLeadThroughCognitiveEngine: vi.fn() }));

import { processWhatsAppWebhook } from '../controllers/whatsapp.js';
import { processLeadThroughCognitiveEngine } from '../engine.js';

function makeReqRes(overrides = {}) {
  const req = {
    body: {
      object: 'whatsapp_business_account',
      entry: [
        {
          changes: [
            {
              value: {
                messages: [{ from: '447700900000', type: 'text', text: { body: 'need 50 boxes' } }],
                contacts: [{ profile: { name: 'Test Buyer' } }],
              },
            },
          ],
        },
      ],
      ...overrides.body,
    },
  };
  const res = { sendStatus: vi.fn() };
  return { req, res };
}

beforeEach(() => vi.clearAllMocks());

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
