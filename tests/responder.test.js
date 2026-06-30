/**
 * tests/responder.test.js
 * Covers generateSalesDraft, including the new catalogue-context injection
 * (Rule #1 for the live-WhatsApp engine wiring). Anthropic SDK is mocked.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockCreate = vi.hoisted(() => vi.fn());
vi.mock('@anthropic-ai/sdk', () => ({
  default: class MockAnthropic {
    constructor() { this.messages = { create: mockCreate }; }
  },
}));

import { generateSalesDraft } from '../responder.js';

beforeEach(() => {
  vi.clearAllMocks();
  process.env.ANTHROPIC_API_KEY = 'test-key';
  mockCreate.mockResolvedValue({ content: [{ text: 'Hi! We have that in stock — want a quote?' }] });
});

describe('generateSalesDraft', () => {
  it('returns a draft on success', async () => {
    const r = await generateSalesDraft({ customer_name: 'Sam', product_interest: 'rice' }, 'do you have rice?');
    expect(r.success).toBe(true);
    expect(r.draft).toMatch(/stock/i);
  });

  it('injects catalogue context into the prompt when provided', async () => {
    const ctx = 'Relevant catalogue items: - Basmati Rice 20kg: GBP 24.50 per bag — 40 bag(s) in stock';
    await generateSalesDraft({ product_interest: 'rice' }, 'rice?', 'en', [], ctx);
    const promptSent = mockCreate.mock.calls[0][0].messages[0].content;
    expect(promptSent).toContain('Basmati Rice 20kg');
    expect(promptSent).toContain('40 bag(s) in stock');
  });

  it('omits the catalogue block when no context is given (backward compatible)', async () => {
    await generateSalesDraft({ product_interest: 'rice' }, 'rice?');
    const promptSent = mockCreate.mock.calls[0][0].messages[0].content;
    expect(promptSent).not.toContain('Relevant catalogue items');
  });

  it('returns failure on API error', async () => {
    mockCreate.mockRejectedValue(new Error('boom'));
    const r = await generateSalesDraft({ product_interest: 'rice' }, 'rice?');
    expect(r.success).toBe(false);
  });
});
