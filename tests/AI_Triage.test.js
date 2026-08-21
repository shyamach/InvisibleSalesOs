/**
 * tests/AI_Triage.test.js
 * Tests for the AI Gatekeeper (Rule #1 compliance).
 * Anthropic SDK is mocked — no real API calls, no cost.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// vi.hoisted ensures mockCreate is available inside vi.mock factory (which is hoisted)
const mockCreate = vi.hoisted(() => vi.fn());

vi.mock('@anthropic-ai/sdk', () => ({
  default: class MockAnthropic {
    constructor() {
      this.messages = { create: mockCreate };
    }
  },
}));

// anthropicClient.js's recordFailure() calls logSystemEvent() (Phase F) when
// the breaker opens — reaches the real Supabase client if unmocked. Never
// let a unit test make a real network call / write real rows live.
vi.mock('../lib/systemLog.js', () => ({ logSystemEvent: vi.fn() }));

import { performAITriage } from '../AI_Triage.js';
import { resetCircuitBreaker } from '../lib/anthropicClient.js';

describe('performAITriage — Gatekeeper Logic', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetCircuitBreaker();
    process.env.ANTHROPIC_API_KEY = 'test-key';
  });

  it('returns success:true for a HIGH-priority business lead', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [
        {
          text: JSON.stringify({
            is_lead: true,
            priority: 'HIGH',
            score: 85,
            reason: 'Bulk protein powder order, urgent',
            lead_data: {
              customer_name: 'Rajesh',
              company_name: 'Gupta Supplements',
              product_interest: 'protein powder',
              language: 'English',
            },
          }),
        },
      ],
    });

    const result = await performAITriage([
      'I need 500 boxes of protein powder urgently. Bulk order for distribution.',
    ]);

    expect(result.success).toBe(true);
    expect(result.data.priority).toBe('HIGH');
    expect(result.data.score).toBeGreaterThanOrEqual(50);
    expect(result.data.lead_data.customer_name).toBe('Rajesh');
  });

  it('returns success:false for a casual greeting (noise)', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [
        {
          text: JSON.stringify({
            is_lead: false,
            score: 0,
            reason: 'casual greeting, no business intent',
          }),
        },
      ],
    });

    const result = await performAITriage(['Hey!']);

    expect(result.success).toBe(false);
    expect(result.reason).toBeTruthy();
  });

  it('returns success:false when score is below threshold (< 50)', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [
        {
          text: JSON.stringify({
            is_lead: true,
            priority: 'LOW',
            score: 30,
            reason: 'vague inquiry with no urgency',
          }),
        },
      ],
    });

    const result = await performAITriage(['Maybe I could be interested in something...']);
    expect(result.success).toBe(false);
  });

  it('returns success:false when response contains no JSON', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ text: 'I am Claude, I cannot help with this.' }],
    });

    const result = await performAITriage(['test message']);
    expect(result.success).toBe(false);
    expect(result.reason).toContain('Parsing Failed');
  });

  it('retries on API error and returns failure after exhausting retries', async () => {
    mockCreate.mockRejectedValue(new Error('Rate limited'));

    const result = await performAITriage(['test message']);

    expect(result.success).toBe(false);
    expect(mockCreate).toHaveBeenCalledTimes(3); // 3 retry attempts
  });
});
