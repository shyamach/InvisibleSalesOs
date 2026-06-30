/**
 * tests/digest.test.js
 *
 * Unit tests for lib/weeklyDigest.js
 * All external calls (Supabase, Anthropic, Resend/emailSend) are mocked.
 *
 * Rule #1: No code without tests.
 * Rule #2: Lead triage returns structured JSON (stats object asserted below).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─── Mock emailSend BEFORE importing weeklyDigest ─────────────────────────────
vi.mock('../lib/emailSend.js', () => ({
  sendEmailReply: vi.fn().mockResolvedValue({ success: true, id: 're_mock123' }),
}));

// ─── Mock Anthropic SDK ───────────────────────────────────────────────────────
vi.mock('@anthropic-ai/sdk', () => {
  const MockAnthropic = vi.fn().mockImplementation(() => ({
    messages: {
      create: vi.fn().mockResolvedValue({
        content: [{ text: 'Strong week with 5 new leads. Chase the top 3 high-priority contacts before Friday.' }],
      }),
    },
  }));
  return { default: MockAnthropic };
});

import { generateWeeklyDigest, sendWeeklyDigest, buildEmailHtml, formatDateRange } from '../lib/weeklyDigest.js';
import { sendEmailReply } from '../lib/emailSend.js';

// ─── Supabase mock factory ────────────────────────────────────────────────────

function makeMockSupabase({
  tenantName = 'Test Traders Ltd',
  leadsThisWeek = 5,
  leadsPrevWeek = 3,
  highPriorityLeads = [],
  lastActivity = null,
  invoices = [],
  pendingDrafts = 2,
} = {}) {
  // Build a chainable query mock
  const makeChain = (resolveValue) => {
    const chain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      neq: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      lte: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      not: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue(resolveValue),
    };
    // Make the chain itself thenable (for `await supabase.from(...).select(...)`)
    chain.then = (resolve) => Promise.resolve(resolveValue).then(resolve);
    return chain;
  };

  // Per-table call counters — reset independently so tests don't bleed into each other
  const tableCallCount = {};

  const thisWeekData = Array.from({ length: leadsThisWeek }, (_, i) => ({
    id: `lead-${i}`,
    ptc_score: i < 2 ? 80 : i < 4 ? 55 : 30,
    pipeline_stage: i === 0 ? 'won' : 'active',
    created_at: new Date().toISOString(),
    customer_name: `Customer ${i}`,
    company_name: `Company ${i}`,
    product_interest: 'Rice',
  }));

  const prevLeadsData = Array.from({ length: leadsPrevWeek }, (_, i) => ({ id: `prev-${i}` }));

  const supabase = {
    from: vi.fn((table) => {
      tableCallCount[table] = (tableCallCount[table] || 0) + 1;
      const callN = tableCallCount[table];

      if (table === 'tenants') {
        return makeChain({ data: { name: tenantName }, error: null });
      }

      if (table === 'smart_leads') {
        // Call 1: this week's leads
        // Call 2: prev week leads
        // Call 3+: high priority leads for chase section
        if (callN === 1) return makeChain({ data: thisWeekData, error: null });
        if (callN === 2) return makeChain({ data: prevLeadsData, error: null });
        return makeChain({ data: highPriorityLeads, error: null });
      }

      if (table === 'lead_activities') {
        return makeChain({ data: lastActivity, error: lastActivity ? null : { code: 'PGRST116' } });
      }

      if (table === 'invoices') {
        return makeChain({ data: invoices, error: null });
      }

      if (table === 'smart_interactions') {
        return makeChain({ data: null, error: null, count: pendingDrafts });
      }

      return makeChain({ data: null, error: null });
    }),
  };

  return supabase;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('generateWeeklyDigest', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ANTHROPIC_API_KEY = 'test-anthropic-key';
    process.env.RESEND_API_KEY = 'test-resend-key';
    process.env.RESEND_FROM_EMAIL = 'digest@example.com';
  });

  afterEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
  });

  it('returns an object with subject (string), html (string), and stats (object)', async () => {
    const sb = makeMockSupabase();
    const result = await generateWeeklyDigest(sb, 'tenant-123');

    expect(result).toHaveProperty('subject');
    expect(result).toHaveProperty('html');
    expect(result).toHaveProperty('stats');
    expect(typeof result.subject).toBe('string');
    expect(typeof result.html).toBe('string');
    expect(typeof result.stats).toBe('object');
  });

  it('subject contains the week date range', async () => {
    const sb = makeMockSupabase();
    const { subject } = await generateWeeklyDigest(sb, 'tenant-123');
    // Subject format: "📊 Your Week in Sales — DD Mon – DD Mon"
    expect(subject).toMatch(/Your Week in Sales/);
    expect(subject).toMatch(/–/);
  });

  it('stats.leads_this_week is a number >= 0', async () => {
    const sb = makeMockSupabase({ leadsThisWeek: 5 });
    const { stats } = await generateWeeklyDigest(sb, 'tenant-123');
    expect(typeof stats.leads_this_week).toBe('number');
    expect(stats.leads_this_week).toBeGreaterThanOrEqual(0);
  });

  it('stats.leads_this_week matches the mocked lead count', async () => {
    const sb = makeMockSupabase({ leadsThisWeek: 7 });
    const { stats } = await generateWeeklyDigest(sb, 'tenant-123');
    expect(stats.leads_this_week).toBe(7);
  });

  it('stats.top_leads_to_chase is an array', async () => {
    const sb = makeMockSupabase();
    const { stats } = await generateWeeklyDigest(sb, 'tenant-123');
    expect(Array.isArray(stats.top_leads_to_chase)).toBe(true);
  });

  it('stats has all required fields with correct types', async () => {
    const sb = makeMockSupabase();
    const { stats } = await generateWeeklyDigest(sb, 'tenant-123');

    expect(typeof stats.tenant_name).toBe('string');
    expect(typeof stats.week_start).toBe('string');
    expect(typeof stats.week_end).toBe('string');
    expect(typeof stats.leads_this_week).toBe('number');
    expect(typeof stats.leads_last_week).toBe('number');
    expect(typeof stats.high_priority_count).toBe('number');
    expect(typeof stats.medium_priority_count).toBe('number');
    expect(typeof stats.leads_won).toBe('number');
    expect(typeof stats.pending_drafts).toBe('number');
    expect(typeof stats.invoices_sent).toBe('number');
    expect(typeof stats.invoice_value_gbp).toBe('number');
    expect(typeof stats.invoices_paid).toBe('number');
    expect(Array.isArray(stats.top_leads_to_chase)).toBe(true);
  });

  it('lead_trend_pct is null when leads_last_week is 0', async () => {
    const sb = makeMockSupabase({ leadsThisWeek: 3, leadsPrevWeek: 0 });
    const { stats } = await generateWeeklyDigest(sb, 'tenant-123');
    expect(stats.lead_trend_pct).toBeNull();
  });

  it('html includes the word "leads" or "draft"', async () => {
    const sb = makeMockSupabase({ pendingDrafts: 3 });
    const { html } = await generateWeeklyDigest(sb, 'tenant-123');
    const lower = html.toLowerCase();
    expect(lower.includes('leads') || lower.includes('draft')).toBe(true);
  });

  it('html contains the KPI section with invoice reference', async () => {
    const sb = makeMockSupabase({
      invoices: [{ total_amount: '500.00', status: 'sent' }],
    });
    const { html } = await generateWeeklyDigest(sb, 'tenant-123');
    expect(html).toContain('Invoiced');
    expect(html).toContain('Leads Won');
  });

  it('html is a valid HTML document with DOCTYPE', async () => {
    const sb = makeMockSupabase();
    const { html } = await generateWeeklyDigest(sb, 'tenant-123');
    expect(html.trim()).toMatch(/^<!DOCTYPE html>/i);
    expect(html).toContain('</html>');
  });

  it('html contains the tenant name when available', async () => {
    const sb = makeMockSupabase({ tenantName: 'Shah Brothers Wholesale' });
    const { html } = await generateWeeklyDigest(sb, 'tenant-123');
    expect(html).toContain('Shah Brothers Wholesale');
  });

  it('html shows pending drafts amber box when drafts > 0', async () => {
    const sb = makeMockSupabase({ pendingDrafts: 4 });
    const { html } = await generateWeeklyDigest(sb, 'tenant-123');
    expect(html).toContain('waiting for your approval');
    expect(html).toContain('/app/drafts');
  });

  it('html does NOT show drafts amber box when drafts = 0', async () => {
    const sb = makeMockSupabase({ pendingDrafts: 0 });
    const { html } = await generateWeeklyDigest(sb, 'tenant-123');
    expect(html).not.toContain('waiting for your approval');
  });
});

// ─── sendWeeklyDigest ─────────────────────────────────────────────────────────

describe('sendWeeklyDigest', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ANTHROPIC_API_KEY = 'test-anthropic-key';
    process.env.RESEND_API_KEY = 'test-resend-key';
    process.env.RESEND_FROM_EMAIL = 'digest@example.com';
    sendEmailReply.mockResolvedValue({ success: true, id: 're_mock_digest' });
  });

  it('calls sendEmailReply with to, subject, and html', async () => {
    const sb = makeMockSupabase();
    await sendWeeklyDigest(sb, 'tenant-123', 'owner@example.com');

    expect(sendEmailReply).toHaveBeenCalledOnce();
    const callArgs = sendEmailReply.mock.calls[0][0];
    expect(callArgs.to).toBe('owner@example.com');
    expect(typeof callArgs.subject).toBe('string');
    expect(typeof callArgs.html).toBe('string');
  });

  it('returns { success: true, stats } when email sends successfully', async () => {
    const sb = makeMockSupabase();
    const result = await sendWeeklyDigest(sb, 'tenant-123', 'owner@example.com');

    expect(result.success).toBe(true);
    expect(result).toHaveProperty('stats');
    expect(typeof result.stats).toBe('object');
  });

  it('returns { success: false, error } when emailSend fails', async () => {
    sendEmailReply.mockResolvedValueOnce({ success: false, error: 'Resend rate limit' });

    const sb = makeMockSupabase();
    const result = await sendWeeklyDigest(sb, 'tenant-123', 'owner@example.com');

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Resend rate limit/);
  });
});

// ─── buildEmailHtml (pure function) ──────────────────────────────────────────

describe('buildEmailHtml', () => {
  const baseStats = {
    tenant_name: 'Test Co',
    week_start: '2025-01-27T00:00:00.000Z',
    week_end: '2025-02-02T23:59:59.999Z',
    leads_this_week: 8,
    leads_last_week: 5,
    lead_trend_pct: 60,
    high_priority_count: 3,
    medium_priority_count: 2,
    leads_won: 1,
    pending_drafts: 0,
    invoices_sent: 4,
    invoice_value_gbp: 2500.50,
    invoices_paid: 2,
    top_leads_to_chase: [
      { customer_name: 'Ravi Patel', company_name: 'Patel Stores', product_interest: 'Basmati', ptc_score: 88, days_since_contact: 5 },
    ],
  };

  it('renders hero lead count', () => {
    const html = buildEmailHtml(baseStats, 'Great week overall.');
    expect(html).toContain('8');
  });

  it('renders invoice value with £ sign', () => {
    const html = buildEmailHtml(baseStats, 'Good performance.');
    expect(html).toContain('£');
  });

  it('renders lead name in chase section', () => {
    const html = buildEmailHtml(baseStats, 'Keep going.');
    expect(html).toContain('Ravi Patel');
  });

  it('renders the narrative text', () => {
    const html = buildEmailHtml(baseStats, 'Specific narrative text here.');
    expect(html).toContain('Specific narrative text here.');
  });

  it('escapes HTML in customer names to prevent XSS', () => {
    const xssStats = {
      ...baseStats,
      top_leads_to_chase: [
        { customer_name: '<script>alert(1)</script>', company_name: 'Co', product_interest: null, ptc_score: 75, days_since_contact: 4 },
      ],
    };
    const html = buildEmailHtml(xssStats, 'Test.');
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });
});

// ─── formatDateRange ──────────────────────────────────────────────────────────

describe('formatDateRange', () => {
  it('formats a date range into human-readable GB format', () => {
    const result = formatDateRange('2025-01-27T00:00:00.000Z', '2025-02-02T23:59:59.000Z');
    expect(result).toMatch(/Jan/);
    expect(result).toMatch(/Feb/);
    expect(result).toContain('–');
  });
});
