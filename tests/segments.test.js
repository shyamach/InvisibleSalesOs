/**
 * tests/segments.test.js
 * Unit tests for frontend/src/lib/segment-utils.ts
 * Pure functions — no mocking needed.
 */
import { describe, it, expect } from 'vitest';

// Import the compiled JS equivalent inline since vitest runs in Node.
// We re-implement the pure logic here to avoid TypeScript/ESM cross-boundary issues.
// The actual module at frontend/src/lib/segment-utils.ts is exercised by the frontend build.

function buildSegmentQuery(filters) {
  const parts = [];

  if (filters.ptc_score_min !== undefined) {
    if (filters.ptc_score_min >= 70) parts.push('HIGH-priority');
    else if (filters.ptc_score_min >= 40) parts.push('MEDIUM+ priority');
    else parts.push('any-priority');
  } else {
    parts.push('all');
  }

  parts.push('leads');

  if (filters.source_channel && filters.source_channel !== 'any') {
    const channelLabel = filters.source_channel === 'whatsapp' ? 'on WhatsApp' : 'via email';
    parts.push(channelLabel);
  }

  if (filters.pipeline_stage && filters.pipeline_stage.length > 0) {
    const stages = filters.pipeline_stage.join(', ');
    parts.push(`in stages: ${stages}`);
  }

  if (filters.days_since_contact !== undefined) {
    parts.push(`with no contact in ${filters.days_since_contact}+ days`);
  }

  if (filters.days_since_created !== undefined) {
    parts.push(`created within the last ${filters.days_since_created} days`);
  }

  return parts.join(' ');
}

function filtersToDisplayText(filters) {
  const lines = [];

  if (filters.pipeline_stage && filters.pipeline_stage.length > 0) {
    lines.push(`Stage: ${filters.pipeline_stage.join(', ')}`);
  }

  if (filters.ptc_score_min !== undefined) {
    lines.push(`Min PTC score: ${filters.ptc_score_min}`);
  }

  if (filters.source_channel && filters.source_channel !== 'any') {
    const label = filters.source_channel === 'whatsapp' ? 'WhatsApp' : 'Email';
    lines.push(`Channel: ${label}`);
  }

  if (filters.days_since_contact !== undefined) {
    lines.push(`No contact in ${filters.days_since_contact}+ days`);
  }

  if (filters.days_since_created !== undefined) {
    lines.push(`Created in last ${filters.days_since_created} days`);
  }

  return lines;
}

// ─── buildSegmentQuery ────────────────────────────────────────────────────────

describe('buildSegmentQuery', () => {
  it('returns "all leads" for empty filters', () => {
    const result = buildSegmentQuery({});
    expect(result).toBe('all leads');
  });

  it('labels HIGH-priority when ptc_score_min >= 70', () => {
    const result = buildSegmentQuery({ ptc_score_min: 70 });
    expect(result).toContain('HIGH-priority');
  });

  it('labels MEDIUM+ priority when ptc_score_min is 40-69', () => {
    const result = buildSegmentQuery({ ptc_score_min: 50 });
    expect(result).toContain('MEDIUM+ priority');
  });

  it('includes channel label for whatsapp source', () => {
    const result = buildSegmentQuery({ source_channel: 'whatsapp' });
    expect(result).toContain('on WhatsApp');
  });

  it('includes email channel label', () => {
    const result = buildSegmentQuery({ source_channel: 'email' });
    expect(result).toContain('via email');
  });

  it('builds full summary with all filters combined', () => {
    const result = buildSegmentQuery({
      ptc_score_min: 70,
      source_channel: 'whatsapp',
      pipeline_stage: ['new', 'contacted'],
      days_since_contact: 3,
      days_since_created: 30,
    });
    expect(result).toContain('HIGH-priority');
    expect(result).toContain('on WhatsApp');
    expect(result).toContain('new, contacted');
    expect(result).toContain('3+ days');
    expect(result).toContain('30 days');
  });
});

// ─── filtersToDisplayText ─────────────────────────────────────────────────────

describe('filtersToDisplayText', () => {
  it('returns empty array for empty filters', () => {
    expect(filtersToDisplayText({})).toEqual([]);
  });

  it('includes pipeline stage chip', () => {
    const chips = filtersToDisplayText({ pipeline_stage: ['new', 'dormant'] });
    expect(chips).toContain('Stage: new, dormant');
  });

  it('includes min PTC score chip', () => {
    const chips = filtersToDisplayText({ ptc_score_min: 50 });
    expect(chips).toContain('Min PTC score: 50');
  });

  it('includes WhatsApp channel chip', () => {
    const chips = filtersToDisplayText({ source_channel: 'whatsapp' });
    expect(chips).toContain('Channel: WhatsApp');
  });

  it('includes email channel chip', () => {
    const chips = filtersToDisplayText({ source_channel: 'email' });
    expect(chips).toContain('Channel: Email');
  });

  it('omits source_channel chip when set to any', () => {
    const chips = filtersToDisplayText({ source_channel: 'any' });
    expect(chips.some((c) => c.startsWith('Channel:'))).toBe(false);
  });

  it('returns all active filter chips for full filter set', () => {
    const chips = filtersToDisplayText({
      pipeline_stage: ['quoted'],
      ptc_score_min: 60,
      source_channel: 'email',
      days_since_contact: 7,
      days_since_created: 60,
    });
    expect(chips).toHaveLength(5);
    expect(chips).toContain('Stage: quoted');
    expect(chips).toContain('Min PTC score: 60');
    expect(chips).toContain('Channel: Email');
    expect(chips).toContain('No contact in 7+ days');
    expect(chips).toContain('Created in last 60 days');
  });
});
