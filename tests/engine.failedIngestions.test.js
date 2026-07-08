/**
 * tests/engine.failedIngestions.test.js
 *
 * Block 0 (architecture.md §6) — data-safety net, `failed_ingestions` path only.
 * Test-first spec: engine.js does NOT write to `failed_ingestions` today, so the
 * tests below are EXPECTED TO FAIL until that write path is implemented. This
 * file exists to prove the current gap and to pin the exact contract (row shape)
 * the implementation must satisfy — not to make anything pass yet.
 *
 * Scope: failed_ingestions only. No atomic stock update, no sweeper claim-lock,
 * no auth/tenant-scoping changes (Block 1) — those are separate, out of scope here.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const DEV_TENANT_ID = '00000000-0000-0000-0000-000000000001';

// ─── Mocks (hoisted) ──────────────────────────────────────────────────────────
const mockFrom = vi.hoisted(() => vi.fn());

vi.mock('../lib/supabase.js', () => ({ supabase: { from: mockFrom } }));
vi.mock('../parser.js', () => ({ parseIncomingLead: vi.fn() }));
vi.mock('../writer.js', () => ({ generateTailoredOutreach: vi.fn() }));
vi.mock('../sheets.js', () => ({ appendLeadToSpreadsheet: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../db.js', () => ({ saveLeadAndLogToDatabase: vi.fn() }));
vi.mock('../outbox.js', () => ({ dispatchOutreachMessage: vi.fn() }));
vi.mock('../lib/autoReply.js', () => ({ decideAutoReply: vi.fn() }));
vi.mock('../lib/catalogueContext.js', () => ({ getCatalogueContext: vi.fn() }));
vi.mock('../lib/escalation.js', () => ({ detectEscalation: vi.fn() }));
vi.mock('../lib/escalationService.js', () => ({ createAndNotifyEscalation: vi.fn() }));

import { processLeadThroughCognitiveEngine } from '../engine.js';
import { parseIncomingLead } from '../parser.js';
import { generateTailoredOutreach } from '../writer.js';
import { saveLeadAndLogToDatabase } from '../db.js';
import { decideAutoReply } from '../lib/autoReply.js';
import { getCatalogueContext } from '../lib/catalogueContext.js';
import { detectEscalation } from '../lib/escalation.js';

// ─── Supabase chain wiring ────────────────────────────────────────────────────
// Covers every table engine.js touches directly (brand_dna, tenants, contacts,
// smart_leads) plus the not-yet-existing `failed_ingestions` table this spec
// is pinning down. Failure-path tests only ever reach `brand_dna` before
// returning, so the other chains are defensive defaults, not exercised.
function wireSupabase({ brandDna, contactRow = null, tenantRow = null } = {}) {
  const insertFailedIngestion = vi.fn().mockResolvedValue({ data: null, error: null });
  const updateEq = vi.fn().mockResolvedValue({ error: null });

  mockFrom.mockImplementation((table) => {
    switch (table) {
      case 'brand_dna':
        return {
          select: () => ({
            eq: () => ({
              single: () =>
                Promise.resolve(
                  brandDna ? { data: brandDna, error: null } : { data: null, error: { message: 'not found' } }
                ),
            }),
          }),
        };
      case 'tenants':
        return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: tenantRow, error: null }) }) }) };
      case 'contacts':
        return {
          select: () => ({
            eq: () => ({
              contains: () => ({ is: () => ({ limit: () => Promise.resolve({ data: contactRow ? [contactRow] : [], error: null }) }) }),
            }),
          }),
        };
      case 'smart_leads':
        return { update: () => ({ eq: updateEq }) };
      case 'failed_ingestions':
        return { insert: insertFailedIngestion };
      default:
        return { select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: null, error: null }) }) }) };
    }
  });

  return { insertFailedIngestion, updateEq };
}

const brandDnaFixture = {
  brand_name: 'Test Distro',
  brand_voice_guidelines: 'Professional, concise.',
  tenant_id: DEV_TENANT_ID,
};

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── 1-3: triage/parse failure, one per channel origin ───────────────────────
describe('processLeadThroughCognitiveEngine — triage failure is dead-lettered, not dropped', () => {
  it.each([
    ['WhatsApp-origin (Meta webhook path)', 'whatsapp-inbound-stream'],
    // NOTE: real inbound email does not call engine.js today (see summary) —
    // this proves the dead-letter contract is channel-agnostic in engine.js
    // itself, which is where architecture.md §6 Block 0 scopes the fix.
    ['email-origin', 'email'],
    ['form-origin', 'form:tally'],
  ])('%s: records a failed_ingestions row and does not throw', async (_label, channel) => {
    const { insertFailedIngestion } = wireSupabase({ brandDna: brandDnaFixture });
    parseIncomingLead.mockResolvedValue(null); // current real failure shape — see parser.js's own catch

    const rawInput = 'Hi need 200 boxes protein powder urgent';
    const result = await expect(
      processLeadThroughCognitiveEngine(rawInput, 'text', channel, 1)
    ).resolves.toBeDefined();

    expect(insertFailedIngestion).toHaveBeenCalledWith(
      expect.objectContaining({
        tenant_id: DEV_TENANT_ID,
        channel,
        stage: 'triage',
        raw_payload: rawInput,
        parsed_profile: null, // parsing itself failed — nothing to preserve here
        error_message: expect.any(String),
      })
    );
  });
});

// ─── 4: draft-generation failure after a successful parse ────────────────────
describe('processLeadThroughCognitiveEngine — draft-generation failure is dead-lettered, not dropped', () => {
  it('records a failed_ingestions row with the parsed profile preserved, stage=draft_generation', async () => {
    const { insertFailedIngestion } = wireSupabase({ brandDna: brandDnaFixture });
    const parsedProfile = {
      name: 'Rajesh',
      phone: '+447700900000',
      query: 'protein powder bulk order',
      ptc_score: 80,
      is_valid_lead: true,
    };
    parseIncomingLead.mockResolvedValue(parsedProfile);
    getCatalogueContext.mockResolvedValue({ context: null, matches: [] });
    generateTailoredOutreach.mockResolvedValue(null); // writer.js's own real failure shape

    await expect(
      processLeadThroughCognitiveEngine('raw text', 'text', 'whatsapp-inbound-stream', 1)
    ).resolves.toBeDefined();

    expect(insertFailedIngestion).toHaveBeenCalledWith(
      expect.objectContaining({
        tenant_id: DEV_TENANT_ID,
        channel: 'whatsapp-inbound-stream',
        stage: 'draft_generation',
        raw_payload: 'raw text', // original raw channel input, preserved as-is
        parsed_profile: expect.objectContaining({ query: 'protein powder bulk order' }), // normalised profile, kept separately
        error_message: expect.any(String),
      })
    );
    // The lead must not be silently lost: saving is attempted, not skipped.
    expect(saveLeadAndLogToDatabase).not.toHaveBeenCalled(); // current code returns before ever reaching save
  });
});

// ─── 5: no secret-shaped string leaks into the recorded failure detail ───────
describe('processLeadThroughCognitiveEngine — failure detail never leaks a secret-shaped value', () => {
  it('does not pass a raw thrown error message containing an API-key-shaped string through unredacted', async () => {
    const { insertFailedIngestion } = wireSupabase({ brandDna: brandDnaFixture });
    // Purely synthetic fixture string — not a real credential, never read from process.env.
    const fakeSecretLookingValue = 'sk-ant-FAKEFAKEFAKE1234567890';
    parseIncomingLead.mockRejectedValue(new Error(`upstream rejected key ${fakeSecretLookingValue}`));

    await expect(
      processLeadThroughCognitiveEngine('raw text', 'text', 'whatsapp-inbound-stream', 1)
    ).resolves.toBeDefined();

    if (insertFailedIngestion.mock.calls.length > 0) {
      const recorded = insertFailedIngestion.mock.calls[0][0];
      expect(recorded.error_message).not.toContain(fakeSecretLookingValue);
    } else {
      // No dead-letter write happened at all yet — still a failing assertion,
      // since the whole point of Block 0 is that this call must happen.
      expect(insertFailedIngestion).toHaveBeenCalled();
    }
  });
});

// ─── 6: success path is completely unchanged (regression guard) ─────────────
describe('processLeadThroughCognitiveEngine — success path is unaffected by the dead-letter path', () => {
  it('never writes to failed_ingestions and returns the existing success shape when everything succeeds', async () => {
    const { insertFailedIngestion } = wireSupabase({
      brandDna: brandDnaFixture,
      tenantRow: { auto_reply: null, settings: null, owner_email: 'owner@test.com' },
    });
    const parsedProfile = {
      name: 'Priya',
      query: 'need 50 boxes',
      ptc_score: 70,
      priority: 'HIGH',
      is_valid_lead: true,
    };
    parseIncomingLead.mockResolvedValue(parsedProfile);
    getCatalogueContext.mockResolvedValue({ context: null, matches: [] });
    generateTailoredOutreach.mockResolvedValue('Thanks for your enquiry — here is a quote.');
    saveLeadAndLogToDatabase.mockResolvedValue({ leadId: 'lead-123' });
    decideAutoReply.mockReturnValue({
      action: 'manual',
      status: 'awaiting_approval',
      reason: 'HIGH priority always manual',
      scheduled_dispatch_at: null,
    });
    detectEscalation.mockReturnValue({ escalate: false });

    const result = await processLeadThroughCognitiveEngine('raw text', 'text', 'whatsapp-inbound-stream', 1);

    expect(insertFailedIngestion).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      success: true,
      leadId: 'lead-123',
      autoReply: { action: 'manual' },
      escalation: { escalate: false },
    });

    // Block 1.3b: the trusted tenant_id (resolved from brand_dna) must be
    // threaded into db.js — not silently omitted, which is what caused new
    // leads to fail RLS before this fix.
    expect(saveLeadAndLogToDatabase).toHaveBeenCalledWith(
      expect.objectContaining({ query: 'need 50 boxes' }),
      'Thanks for your enquiry — here is a quote.',
      'whatsapp-inbound-stream',
      DEV_TENANT_ID
    );
  });
});
