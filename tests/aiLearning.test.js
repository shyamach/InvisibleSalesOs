/**
 * tests/aiLearning.test.js
 * Tests for pure signal-weight and edit-delta functions (Rule #1 compliance).
 * No mocks needed — these are pure functions with no I/O.
 */
import { describe, it, expect } from 'vitest';
import { calculateSignalWeight, extractEditDelta } from '../lib/learningSignals.js';

describe('calculateSignalWeight — feedback loop signals', () => {
  it('approved + replied = 1.0 (strongest positive signal)', () => {
    expect(calculateSignalWeight('approved', 'replied')).toBe(1.0);
  });

  it('approved + won = 1.0 (deal closed)', () => {
    expect(calculateSignalWeight('approved', 'won')).toBe(1.0);
  });

  it('approved + no_reply = 0.3 (sent but no engagement)', () => {
    expect(calculateSignalWeight('approved', 'no_reply')).toBe(0.3);
  });

  it('approved + null outcome = 0.3 (outcome not yet known)', () => {
    expect(calculateSignalWeight('approved', null)).toBe(0.3);
  });

  it('edited + replied = 0.8 (human improved draft, then got reply)', () => {
    expect(calculateSignalWeight('edited', 'replied')).toBe(0.8);
  });

  it('edited + won = 0.8 (human improved draft, deal closed)', () => {
    expect(calculateSignalWeight('edited', 'won')).toBe(0.8);
  });

  it('edited + no_reply = 0.1 (edited but still no engagement)', () => {
    expect(calculateSignalWeight('edited', 'no_reply')).toBe(0.1);
  });

  it('dismissed = -0.5 (draft was rejected outright)', () => {
    expect(calculateSignalWeight('dismissed', null)).toBe(-0.5);
  });

  it('escalated = -0.2 (draft was insufficient, needed human escalation)', () => {
    expect(calculateSignalWeight('escalated', null)).toBe(-0.2);
  });

  it('unknown action returns 0', () => {
    expect(calculateSignalWeight('pending', null)).toBe(0);
    expect(calculateSignalWeight('', '')).toBe(0);
  });
});

describe('extractEditDelta — edit analysis', () => {
  it('returns unchanged when original and edited are identical', () => {
    const result = extractEditDelta('Hello there friend', 'Hello there friend');
    expect(result.direction).toBe('unchanged');
    expect(result.wordCountDiff).toBe(0);
  });

  it('returns shortened when edited is fewer words', () => {
    const result = extractEditDelta('Hello there my dear friend how are you today', 'Hello friend');
    expect(result.direction).toBe('shortened');
    expect(result.wordCountDiff).toBeLessThan(0);
  });

  it('returns lengthened when edited has more words', () => {
    const result = extractEditDelta('Hi', 'Hi there, how can I help you today with your order?');
    expect(result.direction).toBe('lengthened');
    expect(result.wordCountDiff).toBeGreaterThan(0);
  });

  it('counts new words added in the edit', () => {
    const result = extractEditDelta('Send catalog now', 'Send our full catalog immediately with pricing');
    expect(result.changedWords).toBeGreaterThan(0);
  });

  it('handles empty original gracefully', () => {
    const result = extractEditDelta('', 'Some text');
    expect(result.direction).toBe('unchanged');
    expect(result.wordCountDiff).toBe(0);
  });

  it('handles empty edited gracefully', () => {
    const result = extractEditDelta('Some text', '');
    expect(result.direction).toBe('unchanged');
    expect(result.wordCountDiff).toBe(0);
  });

  it('handles null inputs gracefully', () => {
    const result = extractEditDelta(null, null);
    expect(result.direction).toBe('unchanged');
    expect(result.wordCountDiff).toBe(0);
    expect(result.changedWords).toBe(0);
  });
});
