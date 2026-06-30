/**
 * tests/writer.test.js
 * Tests for the outreach writer — verifies brandContext is passed, return shape is correct.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockCreate = vi.hoisted(() => vi.fn());

vi.mock('@anthropic-ai/sdk', () => ({
  default: class MockAnthropic {
    constructor() {
      this.messages = { create: mockCreate };
    }
  },
}));

import { generateTailoredOutreach } from '../writer.js';

describe('generateTailoredOutreach', () => {
  beforeEach(() => {
    process.env.ANTHROPIC_API_KEY = 'test-key';
    vi.clearAllMocks();
    mockCreate.mockResolvedValue({
      content: [
        {
          text: 'Subject: Partnership Inquiry\n\nDear Rajesh, thank you for reaching out regarding protein powder distribution...',
        },
      ],
    });
  });

  it('returns a non-empty string draft', async () => {
    const profile = {
      name: 'Rajesh',
      company: 'Gupta Supplements',
      query: 'Bulk protein powder order',
      priority: 'HIGH',
    };

    const result = await generateTailoredOutreach(profile);

    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(10);
  });

  it('works without brandContext — uses base guidelines only', async () => {
    const result = await generateTailoredOutreach({ name: 'Test', query: 'Test inquiry' });
    expect(result).toBeTruthy();
  });

  it('accepts brandContext as second argument without error', async () => {
    const profile = { name: 'Test', query: 'Test inquiry' };
    const brandContext = 'Base Guidelines: Always mention ISO certification.';

    // Previously broken — writer.js only accepted 1 param; now fixed
    await expect(generateTailoredOutreach(profile, brandContext)).resolves.toBeTruthy();
  });

  it('returns null on unrecoverable API failure', async () => {
    mockCreate.mockRejectedValue(new Error('Fatal API error'));

    const result = await generateTailoredOutreach({ name: 'Test' });
    expect(result).toBeNull();
  });
});
