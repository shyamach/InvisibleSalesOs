/**
 * lib/segment-utils.ts — Pure utility functions for segment builder.
 * No side effects, no API calls — safe to test without mocking.
 */

export interface SegmentFilters {
  pipeline_stage?: string[];
  ptc_score_min?: number;
  source_channel?: string;
  days_since_contact?: number;
  days_since_created?: number;
}

/**
 * Build a human-readable one-line summary of what a segment targets.
 * Example: "HIGH leads on WhatsApp with no contact in 3+ days"
 */
export function buildSegmentQuery(filters: SegmentFilters): string {
  const parts: string[] = [];

  // Score / priority label
  if (filters.ptc_score_min !== undefined) {
    if (filters.ptc_score_min >= 70) parts.push('HIGH-priority');
    else if (filters.ptc_score_min >= 40) parts.push('MEDIUM+ priority');
    else parts.push('any-priority');
  } else {
    parts.push('all');
  }

  parts.push('leads');

  // Channel
  if (filters.source_channel && filters.source_channel !== 'any') {
    const channelLabel = filters.source_channel === 'whatsapp' ? 'on WhatsApp' : 'via email';
    parts.push(channelLabel);
  }

  // Pipeline stage
  if (filters.pipeline_stage && filters.pipeline_stage.length > 0) {
    const stages = filters.pipeline_stage.join(', ');
    parts.push(`in stages: ${stages}`);
  }

  // Staleness
  if (filters.days_since_contact !== undefined) {
    parts.push(`with no contact in ${filters.days_since_contact}+ days`);
  }

  if (filters.days_since_created !== undefined) {
    parts.push(`created within the last ${filters.days_since_created} days`);
  }

  return parts.join(' ');
}

/**
 * Return an array of human-readable strings, one per active filter.
 * Used to render filter chips on segment cards.
 */
export function filtersToDisplayText(filters: SegmentFilters): string[] {
  const lines: string[] = [];

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
