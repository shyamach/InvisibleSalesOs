/**
 * tests/db.test.js
 *
 * Block 1.3b — pins the tenant_id plumbing fix in db.js#saveLeadAndLogToDatabase.
 * Before this fix, tenant_id was never included in the smart_leads/smart_interactions
 * insert payloads, so every new-lead insert silently failed RLS (tenant_id IS NULL
 * satisfies neither current INSERT policy). This file proves the fix: tenant_id is
 * threaded into both inserts, and a missing tenantId fails fast before any Supabase
 * call is made, instead of attempting a NULL-tenant insert.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const TEST_TENANT_ID = '00000000-0000-0000-0000-000000000001';

// ─── Mocks (hoisted) ──────────────────────────────────────────────────────────
const mockFrom = vi.hoisted(() => vi.fn());

vi.mock('../lib/supabase.js', () => ({ supabase: { from: mockFrom } }));

import { saveLeadAndLogToDatabase } from '../db.js';

/**
 * Wires a minimal smart_leads/smart_interactions chain. Captures the payload
 * passed to each .insert() call so tests can assert on it directly.
 */
function wireSupabase({ existingLeadId = null, leadInsertId = 'new-lead-id' } = {}) {
  const smartLeadsInsert = vi.fn().mockReturnValue({
    select: () => ({
      single: () => Promise.resolve({ data: { id: leadInsertId }, error: null }),
    }),
  });
  const smartInteractionsInsert = vi.fn().mockResolvedValue({ error: null });

  mockFrom.mockImplementation((table) => {
    switch (table) {
      case 'smart_leads':
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: () =>
                  Promise.resolve({
                    data: existingLeadId ? { id: existingLeadId } : null,
                    error: null,
                  }),
              }),
            }),
          }),
          insert: smartLeadsInsert,
        };
      case 'smart_interactions':
        return { insert: smartInteractionsInsert };
      default:
        throw new Error(`Unexpected table in test: ${table}`);
    }
  });

  return { smartLeadsInsert, smartInteractionsInsert };
}

const profile = {
  name: 'Rajesh',
  phone: '+447700900000',
  query: 'protein powder bulk order',
  ptc_score: 80,
  priority: 'HIGH',
  brand_id: 1,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('saveLeadAndLogToDatabase — tenant_id plumbing', () => {
  it('includes tenant_id in the smart_leads insert payload', async () => {
    const { smartLeadsInsert } = wireSupabase();

    const result = await saveLeadAndLogToDatabase(profile, 'draft text', 'whatsapp-inbound-stream', TEST_TENANT_ID);

    expect(result).toEqual({ leadId: 'new-lead-id' });
    expect(smartLeadsInsert).toHaveBeenCalledWith(
      expect.objectContaining({ tenant_id: TEST_TENANT_ID })
    );
  });

  it('includes tenant_id in the smart_interactions insert payload', async () => {
    const { smartInteractionsInsert } = wireSupabase();

    await saveLeadAndLogToDatabase(profile, 'draft text', 'whatsapp-inbound-stream', TEST_TENANT_ID);

    expect(smartInteractionsInsert).toHaveBeenCalledWith(
      expect.objectContaining({ tenant_id: TEST_TENANT_ID, lead_id: 'new-lead-id' })
    );
  });

  it('includes tenant_id even on the existing-lead (upsert-by-phone) branch', async () => {
    const { smartInteractionsInsert } = wireSupabase({ existingLeadId: 'existing-lead-id' });

    const result = await saveLeadAndLogToDatabase(profile, 'draft text', 'whatsapp-inbound-stream', TEST_TENANT_ID);

    expect(result).toEqual({ leadId: 'existing-lead-id' });
    expect(smartInteractionsInsert).toHaveBeenCalledWith(
      expect.objectContaining({ tenant_id: TEST_TENANT_ID, lead_id: 'existing-lead-id' })
    );
  });

  it('rejects clearly when tenantId is missing, before making any Supabase call', async () => {
    wireSupabase();

    await expect(saveLeadAndLogToDatabase(profile, 'draft text', 'whatsapp-inbound-stream')).rejects.toThrow(
      /tenantId is required/i
    );
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('rejects clearly when tenantId is an empty string, before making any Supabase call', async () => {
    wireSupabase();

    await expect(saveLeadAndLogToDatabase(profile, 'draft text', 'whatsapp-inbound-stream', '')).rejects.toThrow(
      /tenantId is required/i
    );
    expect(mockFrom).not.toHaveBeenCalled();
  });
});
